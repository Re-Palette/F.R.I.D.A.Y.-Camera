/**
 * Identification sub-providers. Swap any of them independently:
 *   OCR · ImageUnderstanding · Identification · WebVerification
 * × Mock (demo) · Local (on-device) · Cloud (gateway: Claude / Gemini / OpenAI Vision…)
 */
import type { IdentityCandidate, Verification, VisualFeature } from '../../../core/types';
import { clamp, sleep } from '../../../core/util';
import type {
  IdentificationProvider,
  IdentifyRequest,
  ImageUnderstandingProvider,
  OCRProvider,
  SearchService,
  VisionContext,
  WebVerificationProvider,
} from '../../contracts';
import { postJson } from '../../http';
import { MOCK_IDENTITY } from '../../mock/knowledgeBase';
import { refinable, refine } from '../finelabels';
import { candidatesFromText, colorName, kindFor } from '../perception';
import { bitmapToDataUrl, centralColor } from './encode';

// ─── Mock (scripted demo analysis with realistic stage latency) ─────────────

const specFor = (req: IdentifyRequest) => MOCK_IDENTITY[req.detection.entityId ?? ''];
const part = (req: IdentifyRequest, k: number) => sleep(Math.round((specFor(req)?.delayMs ?? 900) * k));

export const mockOCR: OCRProvider = {
  where: 'mock',
  async readCrop(req) {
    await part(req, 0.25);
    return specFor(req)?.ocr ?? [];
  },
};

export const mockUnderstanding: ImageUnderstandingProvider = {
  where: 'mock',
  async analyze(req) {
    await part(req, 0.35);
    return specFor(req)?.features ?? [{ key: 'category', label: 'カテゴリー', value: req.detection.displayName, source: 'visual' }];
  },
};

export const mockIdentification: IdentificationProvider = {
  where: 'mock',
  async candidates(req) {
    await part(req, 0.3);
    const s = specFor(req);
    if (!s) return [];
    if (s.candidates) return s.candidates.map((c) => ({ entityId: req.detection.entityId, ...c }));
    return s.name ? [{ name: s.name, confidence: s.confidence, entityId: req.detection.entityId, evidence: ['外観'] }] : [];
  },
};

export const mockVerification: WebVerificationProvider = {
  where: 'mock',
  async verify(c) {
    await sleep(700);
    const s = Object.values(MOCK_IDENTITY).find((x) => x.verification && (x.candidates?.[0]?.name === c.name || x.name === c.name));
    if (s?.verification) return { ...s.verification, at: performance.now() };
    return { status: 'unverified', matched: [], sources: [], facts: [], at: performance.now() };
  },
};

// ─── Local (on-device) ──────────────────────────────────────────────────────

/** Crop OCR on-device (Shape Detection API in the vision worker), when supported. */
export class LocalOCR implements OCRProvider {
  constructor(private readonly read: (b: ImageBitmap) => Promise<string[]>, private readonly supported: () => boolean) {}
  get where() {
    return this.supported() ? ('local' as const) : ('none' as const);
  }
  async readCrop(req: IdentifyRequest): Promise<string[]> {
    if (!req.crop || !this.supported()) return [];
    // The worker takes ownership of what it's sent — give it a copy.
    return this.read(await createImageBitmap(req.crop));
  }
}

/** Appearance features that need no model: colour, proportions, OCR-derived brand. */
export const localUnderstanding: ImageUnderstandingProvider = {
  where: 'local',
  async analyze(req, ocr) {
    const d = req.detection;
    const f: VisualFeature[] = [{ key: 'category', label: 'カテゴリー', value: d.displayName, source: 'visual', confidence: d.confidence }];
    const rgb = req.crop ? centralColor(req.crop) : null;
    if (rgb) f.push({ key: 'color', label: 'カラー', value: colorName(...rgb), source: 'visual' });
    const ar = d.bbox.w / Math.max(0.001, d.bbox.h);
    f.push({ key: 'shape', label: '形状', value: ar > 1.4 ? '横長' : ar < 0.7 ? '縦長' : '正方形に近い', source: 'visual' });
    for (const c of candidatesFromText(ocr)) {
      f.push({ key: 'brand', label: 'ブランド（文字）', value: c.brand ?? c.name, source: 'ocr' });
      if (c.model) f.push({ key: 'model-hint', label: '型番らしき文字', value: c.model, source: 'ocr' });
    }
    return f;
  },
};

/**
 * On-device hypotheses. The crop is classified once (ImageNet-1k,
 * EfficientNet-Lite0 in the worker) and only refinements consistent with the
 * detector's class are kept (breed, body type, dish, bottle type…). Brand and
 * model need text (OCR, merged by the pipeline) or the cloud tier.
 */
export class LocalIdentification implements IdentificationProvider {
  readonly where = 'local' as const;
  constructor(private readonly classify: (b: ImageBitmap) => Promise<{ label: string; score: number }[]>) {}

  async candidates(req: IdentifyRequest): Promise<IdentityCandidate[]> {
    const d = req.detection;
    const kind = kindFor(d.category);
    const out: IdentityCandidate[] = [];
    if (req.crop && refinable(d.label)) {
      // The worker takes ownership of what it's sent — give it a copy.
      const classes = await this.classify(await createImageBitmap(req.crop)).catch(() => []);
      for (const f of refine(d.label, classes).slice(0, 3)) {
        out.push({
          name: f.ja,
          confidence: fineConfidence(f.score, d.confidence),
          evidence: [`端末内の画像分類: ${f.en} ${Math.round(f.score * 100)}%`, `${f.level}の推定`],
          classLevel: true,
        });
      }
    }
    if (!out.length && kind === 'animal') out.push({ name: d.displayName, confidence: d.confidence * 0.95, evidence: ['物体検出の分類'], classLevel: true });
    if (!out.length && kind === 'food') out.push({ name: d.displayName, confidence: Math.min(0.6, d.confidence), evidence: ['物体検出の分類'], classLevel: true });
    return mergeSameName(out);
  }
}

/** A 1000-way softmax score is compressed (√) and tempered by the detector's own confidence. */
export function fineConfidence(score: number, detConfidence: number): number {
  return clamp(Math.sqrt(score) * (0.7 + 0.3 * detConfidence), 0, 0.95);
}

function mergeSameName(cs: IdentityCandidate[]): IdentityCandidate[] {
  const m = new Map<string, IdentityCandidate>();
  for (const c of cs) {
    const had = m.get(c.name);
    if (!had) m.set(c.name, c);
    else m.set(c.name, { ...had, confidence: Math.min(0.95, Math.max(had.confidence, c.confidence) + 0.03), evidence: [...(had.evidence ?? []), ...(c.evidence ?? [])] });
  }
  return [...m.values()].sort((a, b) => b.confidence - a.confidence);
}

// ─── Web verification through the Search service ───────────────────────────

/**
 * Looks for the candidate on official / trusted pages via the configured
 * SearchService. Never claims verification when search is a mock, and never
 * copies facts unless an official page names the model.
 */
export class SearchVerification implements WebVerificationProvider {
  readonly where = 'cloud' as const;
  constructor(private readonly search: () => SearchService) {}
  async verify(c: IdentityCandidate, _f: VisualFeature[], ctx: VisionContext): Promise<Verification> {
    const s = this.search();
    if (s.mode === 'mock') return { status: 'skipped', matched: ['検索 API 未接続（モック）のため未照合'], sources: [], facts: [], at: performance.now() };
    const ans = await s.search(`${c.name} 公式`, { detections: [], now: ctx.now, geo: ctx.geo }, () => undefined);
    const trusted = ans.sources.filter((x) => x.tier === 'official' || x.tier === 'corporate' || x.tier === 'government');
    const hit = (t?: string) => !!t && trusted.some((x) => `${x.title} ${x.snippet}`.toLowerCase().includes(t.toLowerCase()));
    const modelHit = hit(c.model ?? c.family);
    const brandHit = hit(c.brand);
    const status: Verification['status'] = modelHit ? 'verified' : brandHit ? 'partial' : trusted.length ? 'unverified' : 'unverified';
    return {
      status,
      matched: [modelHit ? '公式・信頼できるページに同名の製品を確認' : brandHit ? 'メーカー公式ページを確認（モデル未確定）' : '一致する公式ページが見つかりません'],
      sources: trusted.slice(0, 3).map(({ title, url, publisher, tier }) => ({ title, url, publisher, tier })),
      facts: modelHit ? ans.keyPoints.slice(0, 4).map((v, i) => ({ key: `web${i}`, label: '公式情報', value: v })) : [],
      at: performance.now(),
    };
  }
}

// ─── Cloud (gateway → vision LLM) ───────────────────────────────────────────

interface AnalyzeResponse {
  features: VisualFeature[];
  candidates: IdentityCandidate[];
}

/**
 * One gateway call backs both LEVEL 2 and LEVEL 3 for a request (a vision
 * LLM returns features + ranked candidates together); memoised per request.
 *   POST /vision/analyze { image, label, category, ocr, geo, heading, nearby, scene } → { features, candidates }
 */
export class CloudVision {
  private memo = new WeakMap<IdentifyRequest, Promise<AnalyzeResponse>>();

  private call(req: IdentifyRequest, ocr: string[]): Promise<AnalyzeResponse> {
    let p = this.memo.get(req);
    if (!p) {
      p = (async () => {
        const d = req.detection;
        const res = await postJson<Partial<AnalyzeResponse>>('/vision/analyze', {
          image: req.crop ? await bitmapToDataUrl(req.crop) : null,
          label: d.label,
          category: d.category,
          ocr,
          geo: req.ctx.geo,
          heading: req.ctx.heading,
          nearby: req.nearby?.slice(0, 8).map((x) => ({ id: x.id, name: x.name, kind: x.kind })),
          scene: req.scene?.summary,
        });
        return {
          // Re-validate: sources labelled, confidences clamped.
          features: (res.features ?? []).map((f) => ({ ...f, source: f.source === 'ocr' ? 'ocr' : 'visual' })),
          candidates: (res.candidates ?? []).filter((c) => c.name).map((c) => ({ ...c, confidence: clamp(Number(c.confidence) || 0, 0, 0.97) })),
        };
      })();
      this.memo.set(req, p);
    }
    return p;
  }

  readonly understanding: ImageUnderstandingProvider = { where: 'cloud', analyze: async (req, ocr) => (await this.call(req, ocr)).features };
  readonly identification: IdentificationProvider = { where: 'cloud', candidates: async (req, _f, ocr) => (await this.call(req, ocr)).candidates };

  /** POST /vision/ocr { image } → OcrResult (crop-level, JP/EN/ZH/KO). */
  readonly ocr: OCRProvider = {
    where: 'cloud',
    readCrop: async (req) => {
      if (!req.crop) return [];
      const r = await postJson<{ blocks?: { text: string }[] }>('/vision/ocr', { image: await bitmapToDataUrl(req.crop, 0.9) });
      return (r.blocks ?? []).map((b) => b.text);
    },
  };

  /** POST /vision/verify { candidate, features } → Verification (gateway searches + fetches official pages). */
  readonly verification: WebVerificationProvider = {
    where: 'cloud',
    verify: async (candidate, features) => {
      const v = await postJson<Partial<Verification>>('/vision/verify', { candidate, features });
      return { status: v.status ?? 'unverified', matched: v.matched ?? [], sources: v.sources ?? [], facts: v.facts ?? [], at: performance.now() };
    },
  };
}
