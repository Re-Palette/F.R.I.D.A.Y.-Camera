/**
 * Perception logic shared by every VisionProvider — pure functions, no DOM,
 * no network, fully unit-tested. The HUD and orchestrator only consume the
 * results.
 */
import type {
  BBox,
  Detection,
  IdentityCandidate,
  Verification,
  GeoFix,
  Identification,
  IdentityKind,
  IdentityStatus,
  LocationEstimate,
  NavTarget,
  ObjectCategory,
} from '../../core/types';
import { angleDelta, boxCenter, iou } from '../../core/util';

// ─── Confidence policy ─────────────────────────────────────────────────────

/** ≥ 0.80 → IDENTIFIED, ≥ 0.40 → POSSIBLE MATCH (named only as specifically as justified), otherwise UNKNOWN. */
export const IDENTIFIED_AT = 0.8;
export const POSSIBLE_AT = 0.4;

export function statusFor(confidence: number): Exclude<IdentityStatus, 'detected' | 'identifying'> {
  if (confidence >= IDENTIFIED_AT) return 'identified';
  if (confidence >= POSSIBLE_AT) return 'possible';
  return 'unknown';
}

export function kindFor(category: ObjectCategory): IdentityKind {
  switch (category) {
    case 'landmark':
      return 'landmark';
    case 'building':
    case 'store':
      return 'building';
    case 'vehicle':
    case 'train':
    case 'boat':
      return 'vehicle';
    case 'food':
      return 'food';
    case 'plant':
      return 'plant';
    case 'animal':
      return 'animal';
    case 'person':
      return 'person';
    case 'sign':
    case 'text':
      return 'text';
    case 'product':
    case 'computer':
    case 'phone':
    case 'appliance':
    case 'cosmetics':
      return 'product';
    default:
      return 'generic';
  }
}

const KIND_WORD: Record<IdentityKind, string> = {
  landmark: 'LANDMARK',
  building: 'BUILDING',
  product: 'PRODUCT',
  vehicle: 'VEHICLE',
  food: 'DISH',
  plant: 'PLANT',
  animal: 'ANIMAL',
  person: 'PERSON',
  text: 'TEXT',
  place: 'LOCATION',
  generic: 'OBJECT',
};

/** The HUD headline for a detection's recognition state. */
export function headline(d: Pick<Detection, 'category' | 'identity' | 'source'>): string {
  const id = d.identity;
  const kind = id?.kind ?? kindFor(d.category);
  if (kind === 'person') return 'PERSON DETECTED';
  if (kind === 'text') return 'TEXT DETECTED';
  if (!id || id.status === 'detected') return 'TARGET DETECTED';
  if (id.status === 'identifying') return 'IDENTIFYING…';
  if (id.status === 'unknown') return d.category === 'other' ? 'UNKNOWN OBJECT' : 'TARGET DETECTED';
  if (id.status === 'possible') return kind === 'food' ? 'POSSIBLE DISH' : d.source === 'geo' ? `${KIND_WORD[kind]} · 推定` : 'POSSIBLE MATCH';
  if (kind === 'animal') return 'ANIMAL DETECTED';
  return `${KIND_WORD[kind]} IDENTIFIED`;
}

/** Name to show: the specific identity when we have one, else the generic class. */
export function shownName(d: Pick<Detection, 'displayName' | 'identity' | 'category'>): string {
  const id = d.identity;
  if (id && (id.status === 'identified' || id.status === 'possible') && id.name) return id.name;
  if (id?.status === 'unknown') return d.category === 'other' ? '不明な物体' : d.displayName;
  return d.displayName;
}

export function shownConfidence(d: Pick<Detection, 'confidence' | 'identity'>): number {
  const id = d.identity;
  if (id && id.status !== 'detected' && id.status !== 'identifying') return id.confidence;
  return d.confidence;
}

/** People are only ever "detected": strip anything identity-like a provider might return. */
export function sanitize(d: Detection): Detection {
  if (d.category !== 'person') return d;
  return {
    ...d,
    displayName: '人物',
    subtitle: '人物',
    attributes: undefined,
    identity: { status: 'detected', kind: 'person', name: '', confidence: d.confidence, source: d.identity?.source ?? d.source ?? 'local', at: d.identity?.at ?? 0 },
  };
}

// ─── Salience: what deserves HUD space ─────────────────────────────────────

const KIND_WEIGHT: Partial<Record<IdentityKind, number>> = { landmark: 1.25, building: 1.15, product: 1.1, vehicle: 1.05, person: 0.95, text: 0.9 };

export function salience(d: Detection, primaryId?: string | null): number {
  if (d.id === primaryId) return 10;
  const c = boxCenter(d.bbox);
  const centre = 1 - Math.min(1, Math.hypot(c.x - 0.5, c.y - 0.5) * 1.6);
  const area = Math.min(1, Math.sqrt(d.bbox.w * d.bbox.h) * 2);
  const identified = d.identity?.status === 'identified' ? 1.2 : d.identity?.status === 'possible' ? 1.05 : 1;
  return d.confidence * (0.4 + 0.35 * centre + 0.25 * area) * (KIND_WEIGHT[d.identity?.kind ?? kindFor(d.category)] ?? 1) * identified;
}

/** Top-N objects get full labels; the rest are shown as quiet markers. */
export function rankForHud(dets: Detection[], primaryId: string | null | undefined, full: number): { labelled: Set<string>; order: Detection[] } {
  const order = [...dets].sort((a, b) => salience(b, primaryId) - salience(a, primaryId));
  return { labelled: new Set(order.slice(0, full).map((d) => d.id)), order };
}

/** "PERSON ×4 · CAR ×3 · BICYCLE ×1" */
const COUNT_WORD: Partial<Record<ObjectCategory, string>> = {
  person: 'PERSON',
  vehicle: 'VEHICLE',
  train: 'TRAIN',
  boat: 'BOAT',
  building: 'BUILDING',
  landmark: 'LANDMARK',
  sign: 'SIGN',
  store: 'STORE',
  road: 'ROAD',
  animal: 'ANIMAL',
  plant: 'PLANT',
  food: 'FOOD',
  product: 'PRODUCT',
  computer: 'PC',
  phone: 'PHONE',
  appliance: 'DEVICE',
  text: 'TEXT',
};

export function countObjects(dets: Detection[]): { key: string; label: string; n: number }[] {
  const m = new Map<string, number>();
  for (const d of dets) {
    const key = d.label === 'car' || d.label === 'truck' || d.label === 'bus' ? d.label.toUpperCase() : d.label === 'bicycle' || d.label === 'motorcycle' ? d.label.toUpperCase() : COUNT_WORD[d.category] ?? 'OBJECT';
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m.entries()].map(([key, n]) => ({ key, label: key, n })).sort((a, b) => b.n - a.n);
}

// ─── Identification scheduling ─────────────────────────────────────────────

export interface TrackMeta {
  firstSeen: number;
  lastSeen: number;
  identity?: Identification;
  requested?: number;
  bbox: BBox;
  category: ObjectCategory;
  /** Current pipeline stage while identifying. */
  stage?: Identification['stage'];
  /** Box at the time of the last identification (to detect a changed target). */
  identifiedBox?: BBox;
  /** Target changed → re-identify, while still showing the previous identity. */
  stale?: boolean;
}

/**
 * Re-analyse only when the target really changed: much bigger/smaller (moved
 * closer / farther — new detail visible) or a different shape.
 */
export function targetChanged(before: BBox, now: BBox): boolean {
  const a0 = before.w * before.h;
  const a1 = now.w * now.h;
  if (!a0 || !a1) return false;
  const areaRatio = a1 / a0;
  const ar0 = before.w / before.h;
  const ar1 = now.w / now.h;
  return areaRatio > 2.2 || areaRatio < 0.45 || Math.abs(ar1 - ar0) / ar0 > 0.35;
}

/**
 * Which tracks should be identified next. Stable (seen ≥ `stableMs`),
 * confident enough, not yet identified or in flight; locked > primary >
 * salience. People are never sent for identification.
 */
export function pickToIdentify(
  dets: Detection[],
  meta: Map<string, TrackMeta>,
  opts: { now: number; inflight: number; maxInflight: number; stableMs: number; lockedId?: string | null; primaryId?: string | null },
): Detection[] {
  const free = opts.maxInflight - opts.inflight;
  if (free <= 0) return [];
  const eligible = dets.filter((d) => {
    if (d.category === 'person' || d.source === 'ocr' || d.source === 'geo') return false;
    const m = meta.get(d.id);
    if (!m || m.requested || (m.identity && !m.stale)) return false;
    const urgent = d.id === opts.lockedId;
    return urgent || (opts.now - m.firstSeen >= opts.stableMs && d.confidence >= 0.45);
  });
  const rank = (d: Detection) => (d.id === opts.lockedId ? 100 : d.id === opts.primaryId ? 50 : 0) + salience(d, null);
  return eligible.sort((a, b) => rank(b) - rank(a)).slice(0, free);
}

/**
 * Trackers sometimes re-issue ids after a brief occlusion. Carry a finished
 * identity over to a new track of the same category in the same place,
 * instead of paying for identification again.
 */
export function reassociate(d: Detection, lost: { id: string; meta: TrackMeta; lostAt: number }[], now: number): TrackMeta | null {
  let best: { m: TrackMeta; score: number } | null = null;
  for (const l of lost) {
    if (now - l.lostAt > 2500 || l.meta.category !== d.category || !l.meta.identity) continue;
    const ov = iou(l.meta.bbox, d.bbox);
    const a = boxCenter(l.meta.bbox);
    const b = boxCenter(d.bbox);
    const near = Math.hypot(a.x - b.x, a.y - b.y) < 0.12;
    const score = ov + (near ? 0.3 : 0);
    if (score > 0.3 && (!best || score > best.score)) best = { m: l.meta, score };
  }
  return best?.m ?? null;
}

// ─── Geo anchors: buildings the detector can't see ─────────────────────────

/**
 * Projects nearby buildings / landmarks into the camera view from GPS +
 * compass. They're always *estimates* (source 'geo', status 'possible' at
 * best) until an image-based identification confirms them.
 */
export function geoAnchors(pois: NavTarget[], geo: GeoFix | null, heading: number, opts: { hfov: number; now: number; max?: number }): Detection[] {
  if (!geo) return [];
  const acc = geo.accuracy ?? 30;
  const out: Detection[] = [];
  for (const p of pois) {
    if (p.kind !== 'landmark' && p.kind !== 'building' && p.kind !== 'station') continue;
    if (p.distanceM > 2000 || p.distanceM < 15) continue;
    const rel = angleDelta(heading, p.bearingDeg);
    if (Math.abs(rel) > opts.hfov * 0.42) continue;
    const alignment = 1 - Math.abs(rel) / (opts.hfov / 2);
    const gpsTrust = Math.max(0.3, 1 - acc / 120);
    const distTrust = p.distanceM < 800 ? 1 : 0.8;
    const confidence = Math.min(0.78, 0.45 + 0.35 * alignment * gpsTrust * distTrust);
    const w = Math.max(0.08, Math.min(0.5, 60 / p.distanceM));
    const h = w * 1.1;
    const cx = 0.5 + rel / opts.hfov;
    const bbox: BBox = { x: cx - w / 2, y: 0.42 - h, w, h };
    out.push({
      id: `geo:${p.id}`,
      label: 'building',
      displayName: p.name,
      subtitle: '建物 · GPS/方角から推定',
      category: p.kind === 'landmark' ? 'landmark' : 'building',
      confidence,
      bbox,
      entityId: p.id,
      timestamp: opts.now,
      source: 'geo',
      attributes: { 距離: `${Math.round(p.distanceM)} m` },
      identity: { status: statusFor(confidence), kind: p.kind === 'landmark' ? 'landmark' : 'building', name: p.name, confidence, entityId: p.id, source: 'geo', at: opts.now },
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, opts.max ?? 2);
}

// ─── Location estimate ─────────────────────────────────────────────────────

/**
 * Fuses GPS, recognised landmarks and sign text into "where are we".
 * Only confirmed (not 推定) when an image-based landmark agrees with GPS.
 */
export function estimateLocation(input: {
  geo: GeoFix | null;
  landmark?: { name: string; area?: string; confidence: number; source?: string } | null;
  signText?: string | null;
  sceneLocation?: string | null;
}): LocationEstimate | null {
  const { geo, landmark } = input;
  const basis: LocationEstimate['basis'] = [];
  let confidence = 0;
  let name = '';
  let area: string | undefined;
  if (geo) {
    basis.push('gps');
    const acc = geo.accuracy ?? 50;
    confidence = acc <= 20 ? 0.72 : acc <= 60 ? 0.6 : 0.45;
    name = geo.area ?? geo.placeName ?? `${geo.lat.toFixed(3)}, ${geo.lon.toFixed(3)}`;
    area = geo.placeName;
  }
  if (landmark && landmark.confidence >= POSSIBLE_AT) {
    basis.push('landmark');
    const imageBased = landmark.source !== 'geo';
    confidence = Math.min(0.97, Math.max(confidence, 0.5) + (imageBased ? 0.3 : 0.1) * landmark.confidence);
    // A landmark recognised *in the image* pins the area better than GPS alone.
    if (imageBased && landmark.confidence >= IDENTIFIED_AT && (landmark.area || input.sceneLocation)) name = (landmark.area ?? input.sceneLocation)!;
    if (!name) name = landmark.area ?? landmark.name;
    area = area ?? landmark.area;
  }
  if (input.signText) {
    basis.push('sign');
    confidence = Math.min(0.97, confidence + 0.05);
  }
  if (!name && input.sceneLocation) {
    basis.push('image');
    name = input.sceneLocation;
    confidence = Math.max(confidence, 0.4);
  }
  if (!name) return null;
  const confirmed = basis.includes('gps') && basis.includes('landmark') && confidence >= 0.85 && landmark?.source !== 'geo';
  return { name, area, confidence, basis, estimated: !confirmed };
}

// ─── OCR ↔ objects ─────────────────────────────────────────────────────────

/** Attaches OCR text to the sign/store detection that contains it; returns unattached blocks. */
export function attachText<T extends { text: string; bbox: BBox }>(dets: Detection[], blocks: T[]): { byId: Map<string, string>; free: T[] } {
  const byId = new Map<string, string>();
  const free: T[] = [];
  for (const b of blocks) {
    const c = boxCenter(b.bbox);
    const host = dets.find(
      (d) => (d.category === 'sign' || d.category === 'store' || d.category === 'text' || d.category === 'building') && c.x >= d.bbox.x && c.x <= d.bbox.x + d.bbox.w && c.y >= d.bbox.y && c.y <= d.bbox.y + d.bbox.h,
    );
    if (host) byId.set(host.id, [byId.get(host.id), b.text].filter(Boolean).join(' / '));
    else free.push(b);
  }
  return { byId, free };
}

/** Rough script detection for OCR text (ja / zh / ko / en). */
export function detectLang(text: string): string {
  if (/[぀-ヿ]/.test(text)) return 'ja';
  if (/[가-힯]/.test(text)) return 'ko';
  if (/[一-鿿]/.test(text)) return 'zh';
  if (/[A-Za-zÀ-ÿ]/.test(text)) return /[À-ÿ]/.test(text) ? 'fr' : 'en';
  return 'und';
}

export function isUncertain(id?: Identification | null): boolean {
  return !id || id.status === 'possible' || id.status === 'unknown';
}

// ─── LEVEL 3: graded naming from compared candidates ─────────────────────────

const LEVEL_WORD: Partial<Record<IdentityKind, string>> = {
  product: 'モデル',
  vehicle: 'モデル',
  plant: '種',
  animal: '品種',
  food: 'メニュー',
  building: '施設',
  landmark: '施設',
};

export interface GradedIdentity {
  status: 'identified' | 'possible' | 'unknown';
  name: string;
  note?: string;
  confidence: number;
  hierarchy: { brand?: string; family?: string; model?: string; variant?: string };
}

/**
 * Picks the most specific name the evidence supports.
 *   ≥ 0.90  "Apple MacBook Air 13-inch"
 *   ≥ 0.80  "Apple MacBook Air 13-inch" + "M3の可能性"
 *   ≥ 0.60  "Apple MacBook Air"          + "モデル：13-inch / M2・M3系の可能性"
 *   ≥ 0.40  "MacBook系ノートPC"           + "正確なモデルは判別できません"
 *   else    unknown                      + "詳細モデルを特定できません"
 * Two near-equal candidates can never be IDENTIFIED at model level.
 */
export function gradeIdentity(candidates: IdentityCandidate[], kind: IdentityKind, genericJa: string): GradedIdentity {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const top = sorted[0];
  if (!top) return { status: 'unknown', name: '', note: '詳細モデルを特定できません', confidence: 0, hierarchy: {} };
  const second = sorted[1];
  const gap = top.confidence - (second?.confidence ?? 0);
  let c = top.confidence;
  if (second && gap < 0.1) c = Math.min(c, 0.75);
  const hierarchy = { brand: top.brand, family: top.family, model: top.model, variant: top.variant };
  const word = LEVEL_WORD[kind] ?? 'モデル';
  const coarse = [top.brand, top.family].filter(Boolean).join(' ');
  // Generation / trim is rarely provable from an image — always a possibility, never a fact.
  if (c >= 0.9) return { status: 'identified', name: top.name, note: top.variant ? `${top.variant}の可能性` : undefined, confidence: c, hierarchy };
  if (c >= IDENTIFIED_AT) return { status: 'identified', name: top.name, note: top.variant ? `${top.variant}の可能性` : undefined, confidence: c, hierarchy };
  if (c >= 0.6) {
    const finer = [top.model, top.variant].filter(Boolean).join(' / ');
    if (coarse && coarse !== top.name) return { status: 'possible', name: coarse, note: finer ? `${word}：${finer}の可能性` : undefined, confidence: c, hierarchy };
    return { status: 'possible', name: top.name, note: second ? `候補：${second.name}` : undefined, confidence: c, hierarchy };
  }
  if (c >= POSSIBLE_AT) {
    const base = top.family ?? top.brand;
    return { status: 'possible', name: base ? `${base}系${genericJa}` : genericJa, note: `正確な${word}は判別できません`, confidence: c, hierarchy: { brand: top.brand, family: top.family } };
  }
  return { status: 'unknown', name: '', note: `詳細${word}を特定できません`, confidence: c, hierarchy: {} };
}

/** Web evidence moves confidence — but never above 0.98, and contradictions hurt. */
export function applyVerification(confidence: number, v?: Verification | null): number {
  if (!v) return confidence;
  switch (v.status) {
    case 'verified':
      return Math.min(0.98, confidence + 0.06);
    case 'partial':
      return Math.min(0.95, confidence + 0.02);
    case 'contradicted':
      return Math.max(0, confidence - 0.25);
    default:
      return confidence;
  }
}

/** Search only when it can change the answer: ambiguous or not-quite-certain, but plausible. */
export function needsVerification(candidates: IdentityCandidate[], kind: IdentityKind): boolean {
  if (!['product', 'vehicle', 'building', 'landmark', 'food'].includes(kind)) return false;
  const [top, second] = [...candidates].sort((a, b) => b.confidence - a.confidence);
  if (!top || top.confidence < POSSIBLE_AT) return false;
  return top.confidence < 0.9 || (!!second && top.confidence - second.confidence < 0.2);
}

/** Properties an image can't reveal — shown as UNKNOWN instead of guessed. */
export function unknownFields(kind: IdentityKind, label: string): string[] {
  if (label === 'laptop' || label === 'computer') return ['CPU / SoC', 'メモリ', 'ストレージ'];
  if (label === 'cell phone' || label === 'phone') return ['ストレージ容量', 'SIM / キャリア'];
  if (kind === 'vehicle') return ['グレード', '正確な年式'];
  if (kind === 'product') return ['購入時期', '個体の状態'];
  if (kind === 'food') return ['店舗（確定）', 'カロリー（正確）'];
  return [];
}

/** Local brand / model extraction from OCR text (runs on-device, no network). */
export const BRAND_PATTERNS: { re: RegExp; brand: string; kinds?: IdentityKind[]; model?: (m: RegExpMatchArray) => { family?: string; model?: string; name: string } }[] = [
  { re: /\bWH-?1000XM(\d)\b/i, brand: 'Sony', model: (m) => ({ family: 'WH-1000X', model: `WH-1000XM${m[1]}`, name: `Sony WH-1000XM${m[1]}` }) },
  { re: /\bWF-?1000XM(\d)\b/i, brand: 'Sony', model: (m) => ({ family: 'WF-1000X', model: `WF-1000XM${m[1]}`, name: `Sony WF-1000XM${m[1]}` }) },
  { re: /\bSONY\b/i, brand: 'Sony' },
  { re: /\bEOS\s?(R\d+|R)\b/i, brand: 'Canon', model: (m) => ({ family: 'EOS', model: `EOS ${m[1].toUpperCase()}`, name: `Canon EOS ${m[1].toUpperCase()}` }) },
  { re: /\bCanon\b/i, brand: 'Canon' },
  { re: /\bRTX\s?(\d{4})(\s?Ti)?\b/i, brand: 'NVIDIA', model: (m) => ({ family: 'GeForce RTX', model: `RTX ${m[1]}${m[2] ? ' Ti' : ''}`, name: `NVIDIA GeForce RTX ${m[1]}${m[2] ? ' Ti' : ''}` }) },
  { re: /\bMacBook\s?(Air|Pro)\b/i, brand: 'Apple', model: (m) => ({ family: `MacBook ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`, name: `Apple MacBook ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}` }) },
  { re: /\biPhone\s?(\d{2})\s?(Pro Max|Pro|Plus|mini)?\b/i, brand: 'Apple', model: (m) => ({ family: 'iPhone', model: `iPhone ${m[1]}${m[2] ? ` ${m[2]}` : ''}`, name: `Apple iPhone ${m[1]}${m[2] ? ` ${m[2]}` : ''}` }) },
  { re: /\bGalaxy\s?S(\d{2})(\s?Ultra|\+)?\b/i, brand: 'Samsung', model: (m) => ({ family: 'Galaxy S', model: `Galaxy S${m[1]}${m[2] ?? ''}`, name: `Samsung Galaxy S${m[1]}${m[2] ?? ''}` }) },
  { re: /\bCoca-?Cola\b/i, brand: 'Coca-Cola', model: () => ({ family: 'Coca-Cola', name: 'Coca-Cola' }) },
  { re: /\bNIKE\b/i, brand: 'Nike' },
  { re: /\bAir\s?Force\s?1\b/i, brand: 'Nike', model: () => ({ family: 'Air Force 1', name: 'Nike Air Force 1' }) },
  { re: /\bPRIUS\b/i, brand: 'Toyota', model: () => ({ family: 'Prius', name: 'Toyota Prius' }) },
  { re: /\bTESLA\b/i, brand: 'Tesla' },
];

/** OCR text → candidate hints with evidence. Text alone is never taken as final (it's merged with visual evidence). */
export function candidatesFromText(texts: string[]): IdentityCandidate[] {
  const joined = texts.join(' ');
  const out: IdentityCandidate[] = [];
  for (const p of BRAND_PATTERNS) {
    const m = joined.match(p.re);
    if (!m) continue;
    const spec = p.model?.(m);
    const size = joined.match(/(\d{3,4})\s?ml\b/i);
    const name = spec ? `${spec.name}${p.brand === 'Coca-Cola' && size ? ` ${size[1]}ml` : ''}` : p.brand;
    if (out.some((c) => c.name === name)) continue;
    out.push({ name, brand: p.brand, family: spec?.family, model: spec?.model ?? (size ? `${size[1]}ml` : undefined), confidence: spec?.model ? 0.72 : spec ? 0.6 : 0.45, evidence: [`OCR: ${m[0]}`] });
  }
  return out;
}

/**
 * Merges hypotheses from different evidence (vision model, OCR, catalogue):
 * agreeing sources reinforce each other, the best evidence per name wins.
 */
export function mergeCandidates(...lists: IdentityCandidate[][]): IdentityCandidate[] {
  const byName = new Map<string, IdentityCandidate>();
  const key = (c: IdentityCandidate) => c.name.toLowerCase().replace(/\s+/g, ' ');
  for (const list of lists) {
    for (const c of list) {
      const k = key(c);
      // Same thing named at different specificity ("Coca-Cola 500ml" ⊂ "Coca-Cola Original Taste 500ml").
      const tokens = (x: string) => x.split(/[\s/]+/).filter(Boolean);
      const within = (a: string, b: string) => tokens(a).every((t) => tokens(b).includes(t));
      const prev = byName.get(k) ?? [...byName.values()].find((p) => within(k, key(p)) || within(key(p), k));
      if (!prev) {
        byName.set(k, { ...c, evidence: [...(c.evidence ?? [])] });
        continue;
      }
      // Independent agreement: 1 - (1-a)(1-b), capped.
      const merged = Math.min(0.97, 1 - (1 - prev.confidence) * (1 - c.confidence * 0.6));
      const richer = (c.model ? 1 : 0) + (c.variant ? 1 : 0) > (prev.model ? 1 : 0) + (prev.variant ? 1 : 0) ? c : prev;
      byName.delete(key(prev));
      byName.set(key(richer), { ...prev, ...richer, confidence: Math.max(prev.confidence, merged), evidence: [...new Set([...(prev.evidence ?? []), ...(c.evidence ?? [])])] });
    }
  }
  return [...byName.values()].sort((a, b) => b.confidence - a.confidence);
}

/** Dominant colour of a crop → product colour words (local visual feature). */
export function colorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  if (s < 0.18) {
    if (l > 0.82) return 'ホワイト';
    if (l > 0.6) return 'シルバー';
    if (l > 0.35) return 'グレー（スペースグレイ系）';
    return b > r + 6 && l > 0.12 ? 'ミッドナイト（濃紺）' : 'ブラック';
  }
  const h = (() => {
    const d = max - min;
    let x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    x *= 60;
    return x < 0 ? x + 360 : x;
  })();
  if (h < 15 || h >= 345) return 'レッド';
  if (h < 45) return l < 0.35 ? 'ブラウン' : 'オレンジ';
  if (h < 70) return 'イエロー';
  if (h < 170) return 'グリーン';
  if (h < 200) return 'シアン';
  if (h < 255) return l < 0.3 ? 'ミッドナイト（濃紺）' : 'ブルー';
  if (h < 290) return 'パープル';
  return 'ピンク';
}
