/**
 * IdentificationPipeline — "見る → 理解する → 調べる" for one tracked target.
 *
 *   crop ─▶ OCR (text on the object) ─▶ VISION ANALYSIS (LEVEL 2 features)
 *        ─▶ IDENTIFICATION (LEVEL 3 candidates, merged with OCR evidence)
 *        ─▶ CONFIDENCE CHECK ─▶ WEB VERIFICATION if it can change the answer
 *        ─▶ graded, provenance-separated Identification
 *
 * Runs once per stable track (the manager caches by tracking id); web
 * verification is cached by candidate name so the same model seen again is
 * never re-searched.
 */
import type { Identification, IdentityCandidate, Verification, VisualFeature } from '../../../core/types';
import type { IdentificationProvider, IdentifyRequest, ImageUnderstandingProvider, OCRProvider, WebVerificationProvider } from '../../contracts';
import { applyVerification, candidatesFromText, gradeIdentity, kindFor, levelWord, mergeCandidates, needsVerification, unknownFields } from '../perception';

function withVerification(candidates: IdentityCandidate[], v?: Verification): IdentityCandidate[] {
  if (!v || !candidates[0]) return candidates;
  return [{ ...candidates[0], confidence: applyVerification(candidates[0].confidence, v) }, ...candidates.slice(1)].sort((a, b) => b.confidence - a.confidence);
}

/** Kinds whose next level is a maker / model rather than a species or dish. */
const BRANDED = new Set<Identification['kind']>(['product', 'vehicle']);

export interface PipelineProviders {
  /** Optional instant on-device hypothesis shown while `identification` runs. */
  fast?: IdentificationProvider;
  ocr: OCRProvider;
  understanding: ImageUnderstandingProvider;
  identification: IdentificationProvider;
  verification: WebVerificationProvider;
}

export class IdentificationPipeline {
  private verifyCache = new Map<string, Promise<Verification>>();

  constructor(private readonly p: PipelineProviders) {}

  get where() {
    return { ocr: this.p.ocr.where, understanding: this.p.understanding.where, identification: this.p.identification.where, verification: this.p.verification.where };
  }

  async run(req: IdentifyRequest): Promise<Identification> {
    try {
      return await this.runStages(req);
    } finally {
      req.crop?.close();
    }
  }

  private async runStages(req: IdentifyRequest): Promise<Identification> {
    let settled = false;
    const d = req.detection;
    const kind = kindFor(d.category);
    const stage = req.onStage ?? (() => undefined);

    // A provider that throws (gateway unreachable, model download failed…) must
    // not turn into "unknown object": the answer falls back to the detector's class.
    let failed = false;
    const fail = <T,>(v: T) => () => {
      failed = true;
      return v;
    };

    stage('reading');
    const ocr = (await this.p.ocr.readCrop(req).catch(() => [])).filter((t) => t.trim());
    const fromText = candidatesFromText(ocr);

    // Fast, on-device hypothesis first (≈100 ms) so the HUD shows something at
    // once; the slower model (cloud / Gemini Live) then refines it in place.
    const fastP = this.p.fast ? this.p.fast.candidates(req, [], ocr).catch(() => [] as IdentityCandidate[]) : null;
    if (fastP && req.onUpdate) {
      void fastP.then((fast) => {
        if (settled || !fast.length) return;
        req.onUpdate!({ ...this.finish(req, kind, mergeCandidates(fast, fromText), [], ocr), stage: 'matching', provisional: true });
      });
    }

    stage('analyzing');
    // LEVEL 2 and LEVEL 3 run side by side (a vision model answers both in one call).
    const [features, fromModel] = await Promise.all([
      this.p.understanding.analyze(req, ocr).catch(fail([] as VisualFeature[])),
      this.p.identification.candidates(req, [], ocr).catch(fail([] as IdentityCandidate[])),
    ]);
    stage('matching');
    const main = mergeCandidates(fromModel, fromText);
    // The fine model wins; the on-device guess only stands in when it has nothing.
    const candidates = main.length ? main : mergeCandidates(fastP ? await fastP : [], fromText);
    settled = true;

    const verifyWorthIt = !!candidates[0] && !candidates[0].classLevel && (req.forceVerify || needsVerification(candidates, kind));
    if (!verifyWorthIt) return this.finish(req, kind, candidates, features, ocr, undefined, failed);
    if (req.forceVerify || !req.onUpdate) {
      stage('verifying');
      const v = await this.verify(candidates[0], features, req).catch(() => undefined);
      return this.finish(req, kind, withVerification(candidates, v), features, ocr, v, failed);
    }
    // Show the answer now; the web check refines it in the background (never blocks the HUD).
    const v = this.verify(candidates[0], features, req).catch(() => undefined);
    void v.then((ver) => req.onUpdate!(this.finish(req, kind, withVerification(candidates, ver), features, ocr, ver, failed)));
    return { ...this.finish(req, kind, candidates, features, ocr, undefined, failed), stage: 'verifying' };
  }

  /** Web verification only (e.g. the user locked an already-identified target). */
  async verifyIdentity(req: IdentifyRequest, current: Identification): Promise<Identification> {
    const top = current.candidates?.[0];
    if (!top || current.verification) return current;
    req.onStage?.('verifying');
    const cand: IdentityCandidate = { ...top, ...current.hierarchy, name: top.name, confidence: top.confidence, entityId: current.entityId, officialUrl: current.officialUrl };
    const v = await this.verify(cand, current.features ?? [], req).catch(() => undefined);
    if (!v) return current;
    const candidates = [{ ...cand, confidence: applyVerification(cand.confidence, v) }, ...(current.candidates ?? []).slice(1)];
    return this.finish(req, current.kind, candidates, current.features ?? [], current.ocrText ?? [], v);
  }

  private verify(c: IdentityCandidate, features: VisualFeature[], req: IdentifyRequest): Promise<Verification> {
    const key = c.name.toLowerCase();
    let v = this.verifyCache.get(key);
    if (!v) {
      // A slow search must not leave the HUD on "WEB VERIFY…" forever.
      v = Promise.race([
        this.p.verification.verify(c, features, req.ctx),
        new Promise<Verification>((_, reject) => setTimeout(() => reject(new Error('verification timeout')), 8000)),
      ]);
      this.verifyCache.set(key, v);
      v.catch(() => this.verifyCache.delete(key));
    }
    return v;
  }

  private finish(req: IdentifyRequest, kind: Identification['kind'], candidates: IdentityCandidate[], features: VisualFeature[], ocr: string[], verification?: Verification, failed = false): Identification {
    const d = req.detection;
    const g = gradeIdentity(candidates, kind, d.displayName);
    const top = candidates[0];
    const word = levelWord(kind);
    if (g.status === 'unknown' && d.category !== 'other') {
      // LEVEL 1 still holds: the detector knows *what kind* of thing this is.
      g.status = 'detected';
      g.name = d.displayName;
      g.confidence = d.confidence;
      g.hierarchy = {};
      g.note = failed ? '詳細識別サービスに接続できません（カテゴリーのみ）' : BRANDED.has(kind) ? `メーカー・${word}は判別できません` : `詳細な${word}は判別できません`;
    } else if (top?.classLevel && g.status !== 'unknown' && !g.note && BRANDED.has(kind)) {
      // e.g. "スポーツカー" / "マグカップ": a type, not a make or model.
      g.note = `メーカー・${word}は判別できません`;
    }
    const color = features.find((f) => f.key === 'color')?.value;
    const attributes: Record<string, string> = {};
    if (g.hierarchy.brand) attributes['ブランド'] = g.hierarchy.brand;
    attributes['カテゴリー'] = d.displayName;
    if ((g.status === 'identified' || g.status === 'possible') && (g.hierarchy.family || g.hierarchy.model)) attributes['モデル'] = [g.hierarchy.family, g.status === 'identified' ? g.hierarchy.model : undefined].filter(Boolean).join(' ');
    if (color) attributes['カラー'] = color;
    const official = verification?.sources.find((s) => s.tier === 'official')?.url ?? top?.officialUrl;
    return {
      status: g.status,
      kind,
      name: g.name,
      note: g.note,
      detail: [g.hierarchy.brand, d.displayName, color].filter(Boolean).join(' / '),
      confidence: g.confidence,
      entityId: g.status === 'identified' || g.status === 'possible' ? top?.entityId : undefined,
      officialUrl: g.status === 'identified' || g.status === 'possible' ? official : undefined,
      attributes,
      candidates: candidates.slice(0, 4).map((c) => ({ name: c.name, confidence: c.confidence, evidence: c.evidence })),
      hierarchy: { ...g.hierarchy, category: d.displayName },
      features: [...features, ...ocr.map((t) => ({ key: 'text' as const, label: '文字', value: t, source: 'ocr' as const }))],
      ocrText: ocr,
      verification,
      unknown: unknownFields(kind, d.label),
      source: this.p.identification.where === 'cloud' ? 'cloud' : this.p.identification.where === 'mock' ? 'mock' : 'local',
      at: performance.now(),
    };
  }
}
