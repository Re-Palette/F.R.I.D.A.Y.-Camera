import type { ObjectDetector } from '@mediapipe/tasks-vision';
import { frameReady, frameSize, meanLuma } from '../../camera/frame';
import type { Detection, OcrResult, SceneAnalysis } from '../../core/types';
import { timeOfDayFor } from '../../core/util';
import type { FrameSource, VisionContext, VisionService } from '../contracts';
import { mapLabel } from './labels';
import { IouTracker } from './tracker';

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

/**
 * In-browser object detection (MediaPipe EfficientDet-Lite0, 80 COCO classes).
 * Runs fully on-device — no frames leave the phone. Landmark / product
 * identification, scene captioning and OCR need a VLM, so those delegate to an
 * optional `fallback` (usually the remote service) when provided.
 */
export class OnDeviceVisionService implements VisionService {
  readonly mode = 'ondevice' as const;
  private detector: ObjectDetector | null = null;
  private loading: Promise<void> | null = null;
  private tracker = new IouTracker();
  private lastTs = 0;

  constructor(private readonly fallback?: VisionService) {}

  init(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const make = (delegate: 'GPU' | 'CPU') =>
        ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO',
          scoreThreshold: 0.42,
          maxResults: 8,
        });
      this.detector = await make('GPU').catch(() => make('CPU'));
    })();
    return this.loading;
  }

  async detect(frame: FrameSource, _ctx: VisionContext): Promise<Detection[]> {
    if (!this.detector || !frameReady(frame)) return [];
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const { w, h } = frameSize(frame);
    const res = this.detector.detectForVideo(frame, ts);
    const raw = res.detections
      .filter((d) => d.boundingBox && d.categories[0])
      .map((d) => ({
        label: d.categories[0].categoryName,
        score: d.categories[0].score,
        bbox: {
          x: d.boundingBox!.originX / w,
          y: d.boundingBox!.originY / h,
          w: d.boundingBox!.width / w,
          h: d.boundingBox!.height / h,
        },
      }));
    return this.tracker.update(raw, ts).map((t) => {
      const m = mapLabel(t.label);
      return {
        id: t.id,
        label: t.label,
        displayName: m.ja,
        subtitle: m.sub,
        category: m.category,
        confidence: t.score,
        bbox: t.bbox,
      };
    });
  }

  async analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    if (this.fallback) {
      try {
        return await this.fallback.analyzeScene(frame, detections, ctx);
      } catch {
        /* fall through to heuristic */
      }
    }
    const luma = frameReady(frame) ? meanLuma(frame) : 0.5;
    const tod = luma < 0.18 ? 'night' : timeOfDayFor(ctx.now);
    const counts = new Map<string, number>();
    detections.forEach((d) => counts.set(d.displayName, (counts.get(d.displayName) ?? 0) + 1));
    const items = [...counts.entries()].map(([k, n]) => (n > 1 ? `${k}×${n}` : k));
    const people = detections.filter((d) => d.category === 'person').length;
    const where = ctx.geo?.area ?? ctx.geo?.placeName;
    const summary = items.length
      ? `${where ? `${where}付近。` : ''}${items.slice(0, 3).join('・')}を検出しています`
      : `${where ? `${where}付近を` : '周囲を'}スキャンしています`;
    return {
      summary,
      tags: [...counts.keys()].slice(0, 4),
      location: where,
      timeOfDay: tod,
      crowd: people > 5 ? 'high' : people > 1 ? 'moderate' : 'low',
      environment: luma < 0.18 ? '低照度' : undefined,
      confidence: 0.6,
    };
  }

  async ocr(frame: FrameSource, ctx: VisionContext): Promise<OcrResult> {
    if (this.fallback) return this.fallback.ocr(frame, ctx);
    return { blocks: [], fullText: '', language: 'und' };
  }

  dispose() {
    this.detector?.close();
    this.detector = null;
    this.loading = null;
    this.tracker.reset();
  }
}
