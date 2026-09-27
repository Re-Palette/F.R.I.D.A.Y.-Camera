/**
 * Gemini identification for the IdentificationPipeline (LEVEL 2 + LEVEL 3).
 *
 * Uses a fast vision model (gemini-3.8-flash, via our server's
 * /vision/analyze) rather than the Live voice model: it sees a high-resolution
 * crop, answers in structured JSON, and several targets can be identified in
 * parallel. One answer backs both features and candidates (memoised).
 * The Live session is kept for the spoken conversation.
 */
import type { IdentityCandidate, VisualFeature } from '../../core/types';
import type { IdentificationProvider, IdentifyRequest, ImageUnderstandingProvider } from '../contracts';
import { postJson } from '../http';
import { bitmapToDataUrl } from '../vision/identify/encode';
import { parseIdentification, type LiveIdentification } from './tools';

export class LiveVision {
  private memo = new WeakMap<IdentifyRequest, Promise<LiveIdentification>>();
  private ids = new Map<string, string>();

  /** Short, speakable target ids ("T3") used as conversation context. */
  targetId(trackId: string): string {
    let t = this.ids.get(trackId);
    if (!t) {
      t = `T${this.ids.size + 1}`;
      this.ids.set(trackId, t);
      if (this.ids.size > 500) this.ids.delete(this.ids.keys().next().value!);
    }
    return t;
  }

  private call(req: IdentifyRequest, ocr: string[]): Promise<LiveIdentification> {
    let p = this.memo.get(req);
    if (!p) {
      p = (async () => {
        if (!req.crop) throw new Error('no crop');
        const d = req.detection;
        const geo = req.ctx.geo;
        const res = await postJson<{ result?: Record<string, unknown> }>('/vision/analyze', {
          image: await bitmapToDataUrl(req.crop, 0.86),
          label: d.label,
          category: d.displayName,
          ocr,
          area: geo ? [geo.area, geo.placeName].filter(Boolean).join(' ') || undefined : undefined,
          nearby: req.nearby?.slice(0, 6).map((x) => ({ name: x.name })),
          scene: req.scene?.summary,
        });
        const r = res.result ? parseIdentification({ ...res.result, target_id: this.targetId(d.id) }) : null;
        if (!r) throw new Error('Gemini: no answer');
        return r;
      })();
      this.memo.set(req, p);
    }
    return p;
  }

  readonly understanding: ImageUnderstandingProvider = {
    where: 'cloud',
    analyze: async (req, ocr): Promise<VisualFeature[]> => {
      const r = await this.call(req, ocr);
      return [...r.features, ...r.text.map((t) => ({ key: 'text' as const, label: '文字（Gemini）', value: t, source: 'ocr' as const }))];
    },
  };

  readonly identification: IdentificationProvider = {
    where: 'cloud',
    candidates: async (req, _features, ocr): Promise<IdentityCandidate[]> => {
      const r = await this.call(req, ocr);
      if (r.person) return []; // never an identity for people
      return r.candidates.map((c) => ({ ...c, evidence: [...(c.evidence ?? []), 'Gemini'] }));
    },
  };
}
