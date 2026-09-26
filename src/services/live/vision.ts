/**
 * Gemini Live as LEVEL 2 + LEVEL 3 providers for the IdentificationPipeline.
 * One report_identification answer backs both (features + candidates), so the
 * call is memoised per request.
 */
import type { IdentityCandidate, VisualFeature } from '../../core/types';
import type { IdentificationProvider, IdentifyRequest, ImageUnderstandingProvider } from '../contracts';
import type { LiveAgent } from './agent';
import type { LiveIdentification } from './tools';

export class LiveVision {
  private memo = new WeakMap<IdentifyRequest, Promise<LiveIdentification>>();
  private ids = new Map<string, string>();

  constructor(private readonly agent: LiveAgent) {}

  /** Short, speakable target ids ("T3") the model echoes back. */
  targetId(trackId: string): string {
    let t = this.ids.get(trackId);
    if (!t) {
      t = `T${this.ids.size + 1}`;
      this.ids.set(trackId, t);
      if (this.ids.size > 500) this.ids.delete(this.ids.keys().next().value!);
    }
    return t;
  }

  private call(req: IdentifyRequest): Promise<LiveIdentification> {
    let p = this.memo.get(req);
    if (!p) {
      const d = req.detection;
      p = this.agent.identify(this.targetId(d.id), req.crop, d.displayName, d.bbox).then((r) => {
        if (!r) throw new Error('Gemini Live: no answer');
        return r;
      });
      this.memo.set(req, p);
    }
    return p;
  }

  readonly understanding: ImageUnderstandingProvider = {
    where: 'cloud',
    analyze: async (req): Promise<VisualFeature[]> => {
      const r = await this.call(req);
      return [...r.features, ...r.text.map((t) => ({ key: 'text' as const, label: '文字（Gemini）', value: t, source: 'ocr' as const }))];
    },
  };

  readonly identification: IdentificationProvider = {
    where: 'cloud',
    candidates: async (req): Promise<IdentityCandidate[]> => {
      const r = await this.call(req);
      if (r.person) return []; // never an identity for people
      return r.candidates.map((c) => ({ ...c, evidence: [...(c.evidence ?? []), 'Gemini Live'] }));
    },
  };
}
