import { frameReady, meanLuma, toJpegDataUrl } from '../../camera/frame';
import { apiBase } from '../../core/config';
import type { Detection, Identification, OcrResult, SceneAnalysis } from '../../core/types';
import { clamp, timeOfDayFor, uid } from '../../core/util';
import type { FrameSource, IdentifyRequest, VisionCapabilities, VisionContext, VisionFrame, VisionProvider } from '../contracts';
import { postJson } from '../http';
import { detectLang, kindFor, sanitize, statusFor } from './perception';
import type { FromWorker, ToWorker } from './worker/protocol';

/**
 * Main-thread client for the vision worker (MediaPipe detection + on-device
 * text detection). Holds at most ONE detection frame in flight — the sampler
 * never queues, so results always describe (almost) the current view.
 */
abstract class WorkerVisionBase implements VisionProvider {
  abstract readonly mode: 'ondevice' | 'real';
  abstract readonly capabilities: VisionCapabilities;
  readonly inputSize = 384;
  /** Last init failure (model download, WASM, …). While set, no frames are sent. */
  failed: string | null = null;
  lastInferMs = 0;
  delegate = '';
  textSupported = false;
  private retryAt = 0;
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (d: unknown) => void; reject: (e: Error) => void }>();

  get needsPixels() {
    return !this.failed;
  }

  init(): Promise<void> {
    if (this.failed && performance.now() > this.retryAt) {
      this.dispose();
      this.failed = null;
    }
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL('./worker/vision.worker.ts', import.meta.url), { type: 'module', name: 'friday-vision' });
    this.ready = new Promise<void>((resolve, reject) => {
      this.worker!.onmessage = (e: MessageEvent<FromWorker>) => {
        const m = e.data;
        if (m.type === 'ready') {
          this.delegate = m.delegate ?? '';
          this.textSupported = m.textSupported;
          this.onReady();
          resolve();
        } else if (m.type === 'result') {
          this.lastInferMs = m.inferMs;
          this.settle(m.id, m.detections);
        } else if (m.type === 'text') {
          this.settle(m.id, m.blocks);
        } else if (m.type === 'error') {
          if (m.id == null) reject(new Error(m.message));
          else {
            this.pending.get(m.id)?.reject(new Error(m.message));
            this.pending.delete(m.id);
          }
        }
      };
      this.worker!.onerror = (e) => reject(new Error(e.message));
      // Real-time detection always runs on-device; the cloud tier adds identification.
      this.send({ type: 'init', engine: 'mediapipe', apiBase: new URL(apiBase(), location.href).href.replace(/\/$/, '') });
    }).catch((err: Error) => {
      this.failed = err.message;
      this.retryAt = performance.now() + 15000;
      throw err;
    });
    return this.ready;
  }

  protected onReady() {}

  private settle(id: number, value: unknown) {
    this.pending.get(id)?.resolve(value);
    this.pending.delete(id);
  }

  private send(m: ToWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(m, transfer);
  }

  private request<T>(m: ToWorker, transfer: Transferable[]): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.set((m as { id: number }).id, { resolve: resolve as (d: unknown) => void, reject });
      this.send(m, transfer);
    });
  }

  async detect(frame: VisionFrame, ctx: VisionContext): Promise<Detection[]> {
    if (!frame.bitmap) {
      if (this.failed) void this.init().catch(() => undefined); // schedules the retry
      return [];
    }
    await this.init();
    const dets = await this.request<Detection[]>(
      { type: 'frame', id: ++this.seq, bitmap: frame.bitmap, capturedAt: frame.capturedAt, geo: ctx.geo, heading: ctx.heading },
      [frame.bitmap],
    );
    return dets.map((d) => ({ ...d, timestamp: frame.capturedAt, source: 'local' as const }));
  }

  /** On-device OCR (Shape Detection API), when the platform supports it. */
  protected async localText(frame: FrameSource): Promise<OcrResult> {
    await this.init();
    if (!this.textSupported || !frameReady(frame)) return { blocks: [], fullText: '', language: 'und' };
    const w = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
    const h = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
    const k = Math.min(1, 1280 / Math.max(w, h));
    const bitmap = await createImageBitmap(frame, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k) });
    const found = await this.request<{ text: string; bbox: { x: number; y: number; w: number; h: number } }[]>({ type: 'text', id: ++this.seq, bitmap }, [bitmap]);
    const blocks = found.map((b) => ({ id: uid('txt'), text: b.text, bbox: b.bbox, lang: detectLang(b.text) }));
    return { blocks, fullText: blocks.map((b) => b.text).join('\n'), language: blocks[0]?.lang ?? 'und' };
  }

  /** Scene heuristics that need no network: luminance, counts, GPS. */
  protected localScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): SceneAnalysis {
    const luma = frameReady(frame) ? meanLuma(frame) : 0.5;
    const tod = luma < 0.18 ? 'night' : timeOfDayFor(ctx.now);
    const counts = new Map<string, number>();
    detections.forEach((d) => counts.set(d.displayName, (counts.get(d.displayName) ?? 0) + 1));
    const items = [...counts.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k));
    const people = detections.filter((d) => d.category === 'person').length;
    const vehicles = detections.filter((d) => d.category === 'vehicle').length;
    const where = ctx.geo?.area ?? ctx.geo?.placeName;
    const urban = vehicles + people >= 3;
    return {
      summary: items.length
        ? `${where ? `${where}付近。` : ''}${items.slice(0, 3).join('・')}を検出しています`
        : `${where ? `${where}付近を` : '周囲を'}スキャンしています`,
      tags: [...counts.keys()].slice(0, 4),
      location: where,
      timeOfDay: tod,
      crowd: people > 5 ? 'high' : people > 1 ? 'moderate' : 'low',
      environment: [urban ? 'URBAN AREA' : undefined, luma < 0.18 ? '低照度' : undefined].filter(Boolean).join(' / ') || undefined,
      confidence: 0.6,
    };
  }

  abstract identify(req: IdentifyRequest): Promise<Identification>;
  abstract analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis>;
  abstract ocr(frame: FrameSource, ctx: VisionContext): Promise<OcrResult>;

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.pending.forEach((p) => p.reject(new Error('disposed')));
    this.pending.clear();
  }
}

/**
 * LocalVisionProvider — fully on-device. Detection: MediaPipe
 * EfficientDet-Lite0 (80 COCO classes) in a worker. Identification is
 * class-level only (animals are named, dishes are "possible", products and
 * vehicles stay at their class) — specific models / buildings need the cloud.
 * No frames leave the device.
 */
export class OnDeviceVisionService extends WorkerVisionBase {
  readonly mode = 'ondevice' as const;
  capabilities: VisionCapabilities = { detect: 'local', identify: 'local', scene: 'local', text: 'none', identifyNeedsCrop: false, maxInflightIdentify: 4 };

  protected onReady() {
    this.capabilities = { ...this.capabilities, text: this.textSupported ? 'local' : 'none' };
  }

  async identify({ detection: d }: IdentifyRequest): Promise<Identification> {
    const kind = kindFor(d.category);
    const at = performance.now();
    if (kind === 'animal') return { status: statusFor(d.confidence), kind, name: d.displayName, confidence: d.confidence, source: 'local', at };
    if (kind === 'food') {
      const c = Math.min(0.7, d.confidence);
      return { status: statusFor(c), kind, name: d.displayName, confidence: c, detail: 'クラウド接続で料理名を詳細識別', source: 'local', at };
    }
    // Class known, specific identity not available on-device.
    return { status: 'detected', kind, name: '', confidence: d.confidence, detail: '詳細識別にはクラウド接続が必要', source: 'local', at };
  }

  async analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    return this.localScene(frame, detections, ctx);
  }

  ocr(frame: FrameSource): Promise<OcrResult> {
    return this.localText(frame);
  }
}

async function bitmapToDataUrl(b: ImageBitmap): Promise<string> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(b.width, b.height);
    c.getContext('2d')!.drawImage(b, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.readAsDataURL(blob);
    });
  }
  const c = document.createElement('canvas');
  c.width = b.width;
  c.height = b.height;
  c.getContext('2d')!.drawImage(b, 0, 0);
  return c.toDataURL('image/jpeg', 0.8);
}

/**
 * CloudVisionProvider — hybrid. Real-time detection + tracking stay
 * on-device (latency, cost, privacy); only *stable targets* are sent once,
 * as a small crop, for tier-2 identification by a vision LLM behind the
 * gateway. Scene understanding and OCR run every few seconds.
 *
 *   POST /vision/identify { image(crop), label, category, bbox, geo, heading, nearby, scene } → Identification
 *   POST /vision/scene    { image, detections, geo, heading, now } → SceneAnalysis (+ regions)
 *   POST /vision/ocr      { image } → OcrResult
 *
 * Server answers are re-validated here: status is recomputed from the
 * confidence thresholds and people are stripped of any identity.
 */
export class RemoteVisionService extends WorkerVisionBase {
  readonly mode = 'real' as const;
  readonly capabilities: VisionCapabilities = { detect: 'local', identify: 'cloud', scene: 'cloud', text: 'cloud', identifyNeedsCrop: true, maxInflightIdentify: 2 };

  async identify(req: IdentifyRequest): Promise<Identification> {
    const d = req.detection;
    const image = req.crop ? await bitmapToDataUrl(req.crop) : null;
    req.crop?.close();
    const res = await postJson<Partial<Identification>>('/vision/identify', {
      image,
      label: d.label,
      category: d.category,
      bbox: d.bbox,
      text: d.text,
      geo: req.ctx.geo,
      heading: req.ctx.heading,
      nearby: req.nearby?.slice(0, 8).map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
      scene: req.scene?.summary,
    });
    const confidence = clamp(Number(res.confidence ?? 0), 0, 1);
    const status = statusFor(confidence);
    const id: Identification = {
      status,
      kind: res.kind ?? kindFor(d.category),
      name: status === 'unknown' ? '' : String(res.name ?? ''),
      nameEn: res.nameEn,
      detail: res.detail,
      confidence,
      entityId: res.entityId,
      officialUrl: res.officialUrl,
      attributes: res.attributes,
      candidates: res.candidates,
      source: 'cloud',
      at: performance.now(),
    };
    return sanitize({ ...d, identity: id }).identity!;
  }

  async analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    try {
      const s = await postJson<SceneAnalysis>('/vision/scene', {
        image: toJpegDataUrl(frame, 768),
        detections: detections.map(({ label, displayName, confidence, bbox }) => ({ label, displayName, confidence, bbox })),
        geo: ctx.geo,
        heading: ctx.heading,
        now: ctx.now.toISOString(),
      });
      return { ...s, regions: s.regions?.map((r) => sanitize({ ...r, source: 'cloud' })) };
    } catch {
      return this.localScene(frame, detections, ctx);
    }
  }

  async ocr(frame: FrameSource): Promise<OcrResult> {
    try {
      return await postJson<OcrResult>('/vision/ocr', { image: toJpegDataUrl(frame, 1280, 0.85) });
    } catch {
      return this.localText(frame);
    }
  }
}

export { OnDeviceVisionService as LocalVisionProvider, RemoteVisionService as CloudVisionProvider };
