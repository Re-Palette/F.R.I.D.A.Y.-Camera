import { frameReady, meanLuma, toJpegDataUrl } from '../../camera/frame';
import { apiBase } from '../../core/config';
import type { Detection, OcrResult, SceneAnalysis } from '../../core/types';
import { timeOfDayFor } from '../../core/util';
import type { FrameSource, VisionContext, VisionFrame, VisionService } from '../contracts';
import { postJson } from '../http';
import type { EngineKind, FromWorker, ToWorker } from './worker/protocol';

/**
 * Main-thread client for the vision worker. Holds at most ONE frame in
 * flight — the sampler never queues, so results always describe (almost)
 * the current view.
 */
abstract class WorkerVisionBase implements VisionService {
  abstract readonly mode: 'ondevice' | 'real';
  /** Last init failure (model download, WASM, …). While set, no frames are sent. */
  failed: string | null = null;
  private retryAt = 0;
  get needsPixels() {
    return !this.failed;
  }
  abstract readonly inputSize: number;
  protected abstract readonly engine: EngineKind;
  lastInferMs = 0;
  delegate = '';
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (d: Detection[]) => void; reject: (e: Error) => void }>();

  init(): Promise<void> {
    if (this.failed && performance.now() > this.retryAt) {
      // Retry a failed engine periodically (e.g. the network came back).
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
          resolve();
        } else if (m.type === 'result') {
          this.lastInferMs = m.inferMs;
          this.pending.get(m.id)?.resolve(m.detections);
          this.pending.delete(m.id);
        } else if (m.type === 'error') {
          if (m.id == null) reject(new Error(m.message));
          else {
            this.pending.get(m.id)?.reject(new Error(m.message));
            this.pending.delete(m.id);
          }
        }
      };
      this.worker!.onerror = (e) => reject(new Error(e.message));
      this.send({ type: 'init', engine: this.engine, apiBase: new URL(apiBase(), location.href).href.replace(/\/$/, '') });
    }).catch((err: Error) => {
      this.failed = err.message;
      this.retryAt = performance.now() + 15000;
      throw err;
    });
    return this.ready;
  }

  private send(m: ToWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(m, transfer);
  }

  async detect(frame: VisionFrame, ctx: VisionContext): Promise<Detection[]> {
    if (!frame.bitmap) {
      if (this.failed) void this.init().catch(() => undefined); // schedules the retry
      return [];
    }
    await this.init();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ type: 'frame', id, bitmap: frame.bitmap!, capturedAt: frame.capturedAt, geo: ctx.geo, heading: ctx.heading }, [frame.bitmap!]);
    });
  }

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
 * In-browser detection (MediaPipe EfficientDet-Lite0, 80 COCO classes) in a
 * Web Worker. No frames leave the device. Scene text is a local heuristic;
 * landmark / product identity and OCR need the remote gateway.
 */
export class OnDeviceVisionService extends WorkerVisionBase {
  readonly mode = 'ondevice' as const;
  readonly inputSize = 384;
  protected readonly engine = 'mediapipe' as const;

  async analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    const luma = frameReady(frame) ? meanLuma(frame) : 0.5;
    const tod = luma < 0.18 ? 'night' : timeOfDayFor(ctx.now);
    const counts = new Map<string, number>();
    detections.forEach((d) => counts.set(d.displayName, (counts.get(d.displayName) ?? 0) + 1));
    const items = [...counts.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k));
    const people = detections.filter((d) => d.category === 'person').length;
    const where = ctx.geo?.area ?? ctx.geo?.placeName;
    return {
      summary: items.length
        ? `${where ? `${where}付近。` : ''}${items.slice(0, 3).join('・')}を検出しています`
        : `${where ? `${where}付近を` : '周囲を'}スキャンしています`,
      tags: [...counts.keys()].slice(0, 4),
      location: where,
      timeOfDay: tod,
      crowd: people > 5 ? 'high' : people > 1 ? 'moderate' : 'low',
      environment: luma < 0.18 ? '低照度' : undefined,
      confidence: 0.6,
    };
  }

  async ocr(): Promise<OcrResult> {
    return { blocks: [], fullText: '', language: 'und' };
  }
}

/**
 * Cloud vision via the gateway. Detection frames are JPEG-encoded and sent
 * from the worker; the slower scene / OCR calls run every few seconds.
 *   POST /vision/detect { image, geo, heading } → { detections }
 *   POST /vision/scene  { image, detections, geo, now } → SceneAnalysis
 *   POST /vision/ocr    { image } → OcrResult
 */
export class RemoteVisionService extends WorkerVisionBase {
  readonly mode = 'real' as const;
  readonly inputSize = 640;
  protected readonly engine = 'remote' as const;

  analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    return postJson<SceneAnalysis>('/vision/scene', {
      image: toJpegDataUrl(frame, 768),
      detections: detections.map(({ label, displayName, confidence, bbox }) => ({ label, displayName, confidence, bbox })),
      geo: ctx.geo,
      heading: ctx.heading,
      now: ctx.now.toISOString(),
    });
  }

  ocr(frame: FrameSource): Promise<OcrResult> {
    return postJson<OcrResult>('/vision/ocr', { image: toJpegDataUrl(frame, 1280, 0.85) });
  }
}
