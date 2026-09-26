import { toJpegDataUrl } from '../../camera/frame';
import type { Detection, OcrResult, SceneAnalysis } from '../../core/types';
import type { FrameSource, VisionContext, VisionService } from '../contracts';
import { postJson } from '../http';
import { IouTracker } from './tracker';

/**
 * Cloud vision via the gateway (e.g. a VLM such as Claude for scene / landmark /
 * product understanding, plus a detector for boxes).
 *
 *   POST /vision/detect   { image, geo, heading }            → { detections: RawDetection+meta[] }
 *   POST /vision/scene    { image, detections, geo, now }    → SceneAnalysis
 *   POST /vision/ocr      { image }                          → OcrResult
 */
export class RemoteVisionService implements VisionService {
  readonly mode = 'real' as const;
  private tracker = new IouTracker({ iouThreshold: 0.25, maxAgeMs: 2500, smoothing: 0.5, minHits: 1 });
  private meta = new Map<string, Omit<Detection, 'id' | 'bbox' | 'confidence'>>();

  async init() {}

  async detect(frame: FrameSource, ctx: VisionContext): Promise<Detection[]> {
    const res = await postJson<{ detections: (Omit<Detection, 'id'> & { label: string })[] }>('/vision/detect', {
      image: toJpegDataUrl(frame, 640),
      geo: ctx.geo,
      heading: ctx.heading,
    });
    const now = performance.now();
    const tracks = this.tracker.update(
      res.detections.map((d) => ({ label: d.label, score: d.confidence, bbox: d.bbox })),
      now,
    );
    for (const d of res.detections) {
      const t = tracks.find((tr) => tr.label === d.label && Math.abs(tr.bbox.x - d.bbox.x) < 0.1);
      if (t) this.meta.set(t.id, { label: d.label, displayName: d.displayName, subtitle: d.subtitle, category: d.category, entityId: d.entityId });
    }
    return tracks.map((t) => ({
      id: t.id,
      bbox: t.bbox,
      confidence: t.score,
      ...(this.meta.get(t.id) ?? { label: t.label, displayName: t.label, category: 'other' as const }),
    }));
  }

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

  dispose() {
    this.tracker.reset();
    this.meta.clear();
  }
}
