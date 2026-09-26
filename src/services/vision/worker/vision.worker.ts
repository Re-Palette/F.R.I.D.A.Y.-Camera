/// <reference lib="webworker" />
/**
 * Vision worker — pipeline 2 runs entirely here.
 *
 * The main thread transfers a small, GPU-downscaled ImageBitmap; this worker
 * runs inference (MediaPipe on-device, or JPEG-encode + HTTP for the remote
 * gateway), tracks objects to stable ids, and posts back only lightweight
 * results { label, confidence, bbox }. Nothing here can stall the preview
 * or the HUD's frame loop.
 */
import type { ObjectDetector } from '@mediapipe/tasks-vision';
import type { Detection } from '../../../core/types';
import { mapLabel } from '../labels';
import { IouTracker, type RawDetection } from '../tracker';
import type { EngineKind, FromWorker, ToWorker } from './protocol';

/** Self-hosted by the build (see vite.config.ts `mediapipeRuntime`). */
const WASM_BASE = `${self.location.origin}${import.meta.env.BASE_URL}mediapipe`;
/** EfficientDet-Lite0 (Apache-2.0). Override with VITE_VISION_MODEL_URL to self-host. */
const MODEL_URL =
  import.meta.env.VITE_VISION_MODEL_URL ||
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker) => ctx.postMessage(m);

interface Engine {
  run(msg: Extract<ToWorker, { type: 'frame' }>): Promise<Detection[]>;
  reset(): void;
}

// ─── MediaPipe (on-device) ──────────────────────────────────────────────────

async function mediapipe(): Promise<{ engine: Engine; delegate: string }> {
  const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE, true);
  const make = (delegate: 'GPU' | 'CPU') =>
    ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      scoreThreshold: 0.42,
      maxResults: 8,
    });
  // A software WebGL (SwiftShader / llvmpipe) "GPU" is far slower than the
  // SIMD CPU path (XNNPACK) — prefer CPU there.
  let delegate: 'GPU' | 'CPU' = softwareGl() ? 'CPU' : 'GPU';
  let detector: ObjectDetector;
  try {
    detector = await make(delegate);
  } catch {
    delegate = 'CPU';
    detector = await make('CPU');
  }
  const tracker = new IouTracker();
  let lastTs = 0;
  return {
    delegate,
    engine: {
      async run({ bitmap, capturedAt }) {
        const ts = Math.max(capturedAt, lastTs + 1);
        lastTs = ts;
        const { width: w, height: h } = bitmap;
        const res = detector.detectForVideo(bitmap, ts);
        const raw: RawDetection[] = res.detections
          .filter((d) => d.boundingBox && d.categories[0])
          .map((d) => ({
            label: d.categories[0].categoryName,
            score: d.categories[0].score,
            bbox: { x: d.boundingBox!.originX / w, y: d.boundingBox!.originY / h, w: d.boundingBox!.width / w, h: d.boundingBox!.height / h },
          }));
        return tracker.update(raw, ts).map((t) => {
          const m = mapLabel(t.label);
          return { id: t.id, label: t.label, displayName: m.ja, subtitle: m.sub, category: m.category, confidence: t.score, bbox: t.bbox };
        });
      },
      reset: () => tracker.reset(),
    },
  };
}

function softwareGl(): boolean {
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /swiftshader|llvmpipe|software|basic render/i.test(r);
  } catch {
    return true;
  }
}

// ─── Remote gateway ─────────────────────────────────────────────────────────

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function remote(apiBase: string): Engine {
  const tracker = new IouTracker({ iouThreshold: 0.25, maxAgeMs: 2500, smoothing: 0.5, minHits: 1 });
  const meta = new Map<string, Omit<Detection, 'id' | 'bbox' | 'confidence'>>();
  let canvas: OffscreenCanvas | null = null;
  return {
    async run({ bitmap, capturedAt, geo, heading }) {
      canvas = canvas && canvas.width === bitmap.width && canvas.height === bitmap.height ? canvas : new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
      const image = `data:image/jpeg;base64,${toBase64(await blob.arrayBuffer())}`;
      const res = await fetch(`${apiBase}/vision/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, geo, heading }),
      });
      if (!res.ok) throw new Error(`/vision/detect → HTTP ${res.status}`);
      const json = (await res.json()) as { detections: (Omit<Detection, 'id'> & { label: string })[] };
      const tracks = tracker.update(json.detections.map((d) => ({ label: d.label, score: d.confidence, bbox: d.bbox })), capturedAt);
      for (const d of json.detections) {
        const t = tracks.find((tr) => tr.label === d.label && Math.abs(tr.bbox.x - d.bbox.x) < 0.1);
        if (t) meta.set(t.id, { label: d.label, displayName: d.displayName, subtitle: d.subtitle, category: d.category, entityId: d.entityId });
      }
      return tracks.map((t) => ({
        id: t.id,
        bbox: t.bbox,
        confidence: t.score,
        ...(meta.get(t.id) ?? { label: t.label, displayName: t.label, category: 'other' as const }),
      }));
    },
    reset() {
      tracker.reset();
      meta.clear();
    },
  };
}

// ─── Message loop ───────────────────────────────────────────────────────────

let engine: Engine | null = null;
let kind: EngineKind | null = null;

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      kind = msg.engine;
      if (msg.engine === 'mediapipe') {
        const m = await mediapipe();
        engine = m.engine;
        post({ type: 'ready', engine: msg.engine, delegate: m.delegate });
      } else {
        engine = remote(msg.apiBase);
        post({ type: 'ready', engine: msg.engine });
      }
    } catch (err) {
      post({ type: 'error', message: `init ${kind}: ${(err as Error).message}` });
    }
    return;
  }
  if (msg.type === 'reset') {
    engine?.reset();
    return;
  }
  // frame
  try {
    if (!engine) throw new Error('engine not ready');
    const t0 = performance.now();
    const detections = await engine.run(msg);
    post({ type: 'result', id: msg.id, detections, inferMs: performance.now() - t0 });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: (err as Error).message });
  } finally {
    msg.bitmap.close();
  }
};
