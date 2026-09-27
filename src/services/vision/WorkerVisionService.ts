import { frameReady, meanLuma, toJpegDataUrl } from '../../camera/frame';
import { apiBase } from '../../core/config';
import type { Detection, Identification, OcrResult, SceneAnalysis } from '../../core/types';
import { timeOfDayFor, uid } from '../../core/util';
import type { FrameSource, IdentifyRequest, SearchService, VisionCapabilities, VisionContext, VisionFrame, VisionProvider } from '../contracts';
import { IdentificationPipeline } from './identify/pipeline';
import { CloudVision, LocalIdentification, LocalOCR, SearchVerification, localUnderstanding } from './identify/providers';
import { postJson } from '../http';
import { LiveAgent } from '../live/agent';
import { LiveVision } from '../live/vision';
import { detectLang, sanitize } from './perception';
import type { FromWorker, ToWorker } from './worker/protocol';

/**
 * Main-thread client for the vision worker (MediaPipe detection + on-device
 * text detection). Holds at most ONE detection frame in flight — the sampler
 * never queues, so results always describe (almost) the current view.
 */
abstract class WorkerVisionBase implements VisionProvider {
  abstract readonly mode: 'ondevice' | 'real' | 'live';
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
        } else if (m.type === 'classes') {
          this.settle(m.id, m.classes);
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

  /** On-device OCR of a bitmap in the worker (Shape Detection API), when supported. The bitmap is consumed. */
  async readBitmapText(bitmap: ImageBitmap): Promise<{ text: string; bbox: { x: number; y: number; w: number; h: number } }[]> {
    await this.init();
    if (!this.textSupported) {
      bitmap.close();
      return [];
    }
    return this.request({ type: 'text', id: ++this.seq, bitmap }, [bitmap]);
  }

  /** On-device ImageNet classification of a crop (loaded on first use). The bitmap is consumed. */
  async classifyBitmap(bitmap: ImageBitmap): Promise<{ label: string; score: number }[]> {
    await this.init();
    return this.request({ type: 'classify', id: ++this.seq, bitmap }, [bitmap]);
  }

  /** Load the classifier in the background so the first identification is instant. */
  protected warmClassifier() {
    const run = () =>
      void createImageBitmap(new ImageData(8, 8))
        .then((b) => this.classifyBitmap(b))
        .catch(() => undefined);
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 1500);
  }

  /** On-device OCR of the whole frame (sign scan). */
  protected async localText(frame: FrameSource): Promise<OcrResult> {
    await this.init();
    if (!this.textSupported || !frameReady(frame)) return { blocks: [], fullText: '', language: 'und' };
    const w = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width;
    const h = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height;
    const k = Math.min(1, 1280 / Math.max(w, h));
    const found = await this.readBitmapText(await createImageBitmap(frame, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k) }));
    const blocks = found.map((b) => ({ id: uid('txt'), text: b.text, bbox: b.bbox, lang: detectLang(b.text) }));
    return { blocks, fullText: blocks.map((b) => b.text).join('\n'), language: blocks[0]?.lang ?? 'und' };
  }

  protected abstract readonly pipe: IdentificationPipeline;

  get pipeline() {
    return this.pipe.where;
  }

  identify(req: IdentifyRequest): Promise<Identification> {
    return this.pipe.run(req);
  }

  verifyIdentity(req: IdentifyRequest, current: Identification): Promise<Identification> {
    return this.pipe.verifyIdentity(req, current);
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
  protected readonly pipe: IdentificationPipeline;

  constructor(search: () => SearchService) {
    super();
    this.pipe = new IdentificationPipeline({
      ocr: new LocalOCR(async (b) => (await this.readBitmapText(b)).map((x) => x.text), () => this.textSupported),
      understanding: localUnderstanding,
      identification: new LocalIdentification(async (b) => this.classifyBitmap(b)),
      verification: new SearchVerification(search),
    });
  }
  capabilities: VisionCapabilities = { detect: 'local', identify: 'local', scene: 'local', text: 'none', identifyNeedsCrop: false, maxInflightIdentify: 4 };

  protected onReady() {
    this.capabilities = { ...this.capabilities, text: this.textSupported ? 'local' : 'none' };
    this.warmClassifier();
  }

  async analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    return this.localScene(frame, detections, ctx);
  }

  ocr(frame: FrameSource): Promise<OcrResult> {
    return this.localText(frame);
  }
}

/**
 * CloudVisionProvider — hybrid. Real-time detection + tracking stay
 * on-device (latency, cost, privacy); only *stable targets* are sent once,
 * as a small crop, for tier-2 identification by a vision LLM behind the
 * gateway. Scene understanding and OCR run every few seconds.
 *
 *   POST /vision/ocr      { image(crop) } → text on the target
 *   POST /vision/analyze  { image(crop), label, category, ocr, geo, heading, nearby, scene } → { features, candidates }
 *   POST /vision/verify   { candidate, features } → Verification (official sources)
 *   POST /vision/scene    { image, detections, geo, heading, now } → SceneAnalysis (+ regions)
 *   POST /vision/ocr      { image } → OcrResult
 *
 * Server answers are re-validated here: status and name are graded from the
 * candidates (gradeIdentity) and people are stripped of any identity.
 */
export class RemoteVisionService extends WorkerVisionBase {
  readonly mode = 'real' as const;
  private readonly cloud = new CloudVision();
  protected readonly pipe = new IdentificationPipeline({
    ocr: this.cloud.ocr,
    understanding: this.cloud.understanding,
    identification: this.cloud.identification,
    verification: this.cloud.verification,
  });
  readonly capabilities: VisionCapabilities = { detect: 'local', identify: 'cloud', scene: 'cloud', text: 'cloud', identifyNeedsCrop: true, maxInflightIdentify: 2 };

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

/**
 * LiveVisionProvider (`vision=live`) — detection and tracking stay on-device
 * (60 fps HUD, no network per frame); each stable target is shown at once
 * with the on-device guess, then refined by Gemini Live, which also sees the
 * scene (1 frame / 1–2 s) and talks with the user.
 */
export class LiveVisionService extends WorkerVisionBase {
  readonly mode = 'live' as const;
  readonly agent: LiveAgent;
  private readonly live: LiveVision;
  protected readonly pipe: IdentificationPipeline;
  private frameGetter: () => { frame: FrameSource; w: number; h: number } | null = () => null;
  capabilities: VisionCapabilities = { detect: 'local', identify: 'cloud', scene: 'local', text: 'none', identifyNeedsCrop: true, maxInflightIdentify: 3, cropSize: 768 };

  constructor(search: () => SearchService) {
    super();
    this.agent = new LiveAgent(() => this.frameGetter());
    this.live = new LiveVision();
    this.pipe = new IdentificationPipeline({
      fast: new LocalIdentification(async (b) => this.classifyBitmap(b)),
      ocr: new LocalOCR(async (b) => (await this.readBitmapText(b)).map((x) => x.text), () => this.textSupported),
      understanding: this.live.understanding,
      identification: this.live.identification,
      verification: new SearchVerification(search),
    });
  }

  /** The orchestrator hands over the camera so frames can stream to the model. */
  setFrameSource(get: () => { frame: FrameSource; w: number; h: number } | null) {
    this.frameGetter = get;
  }

  targetId(trackId: string) {
    return this.live.targetId(trackId);
  }

  protected onReady() {
    this.capabilities = { ...this.capabilities, text: this.textSupported ? 'local' : 'none' };
    this.warmClassifier();
  }

  async init() {
    await super.init();
    void this.agent.start().catch(() => undefined); // status is reported through agent events
  }

  async analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    return this.localScene(frame, detections, ctx);
  }

  ocr(frame: FrameSource): Promise<OcrResult> {
    return this.localText(frame);
  }

  dispose() {
    this.agent.stop();
    super.dispose();
  }
}
