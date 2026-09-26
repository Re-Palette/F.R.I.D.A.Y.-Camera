import type { BBox } from '../../core/types';
import { iou, lerpBox, uid } from '../../core/util';

export interface RawDetection {
  label: string;
  score: number;
  bbox: BBox;
}

export interface Track extends RawDetection {
  id: string;
  firstSeen: number;
  lastSeen: number;
  hits: number;
}

/**
 * Greedy IoU tracker. Assigns stable ids to per-frame detections from models
 * that have no native tracking (e.g. MediaPipe / most REST detectors), and
 * smooths boxes so the HUD does not jitter.
 */
export class IouTracker {
  private tracks: Track[] = [];

  constructor(
    private readonly opts = { iouThreshold: 0.3, maxAgeMs: 900, smoothing: 0.55, minHits: 2 },
  ) {}

  update(dets: RawDetection[], now: number): Track[] {
    const unmatched = new Set(this.tracks);
    const sorted = [...dets].sort((a, b) => b.score - a.score);
    for (const d of sorted) {
      let best: Track | null = null;
      let bestIou = this.opts.iouThreshold;
      for (const t of unmatched) {
        if (t.label !== d.label) continue;
        const v = iou(t.bbox, d.bbox);
        if (v > bestIou) {
          bestIou = v;
          best = t;
        }
      }
      if (best) {
        unmatched.delete(best);
        best.bbox = lerpBox(best.bbox, d.bbox, this.opts.smoothing);
        best.score = best.score * 0.6 + d.score * 0.4;
        best.lastSeen = now;
        best.hits += 1;
      } else {
        this.tracks.push({ ...d, id: uid('trk'), firstSeen: now, lastSeen: now, hits: 1 });
      }
    }
    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.opts.maxAgeMs);
    return this.tracks.filter((t) => t.hits >= this.opts.minHits);
  }

  reset() {
    this.tracks = [];
  }
}
