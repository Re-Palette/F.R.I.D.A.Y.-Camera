/**
 * Perception logic shared by every VisionProvider — pure functions, no DOM,
 * no network, fully unit-tested. The HUD and orchestrator only consume the
 * results.
 */
import type {
  BBox,
  Detection,
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

/** ≥ 0.80 → IDENTIFIED, ≥ 0.50 → POSSIBLE MATCH, otherwise UNKNOWN. Never overstate. */
export const IDENTIFIED_AT = 0.8;
export const POSSIBLE_AT = 0.5;

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
  if (id.status === 'unknown') return 'UNKNOWN OBJECT';
  if (id.status === 'possible') return kind === 'food' ? 'POSSIBLE DISH' : d.source === 'geo' ? `${KIND_WORD[kind]} · 推定` : 'POSSIBLE MATCH';
  if (kind === 'animal') return 'ANIMAL DETECTED';
  return `${KIND_WORD[kind]} IDENTIFIED`;
}

/** Name to show: the specific identity when we have one, else the generic class. */
export function shownName(d: Pick<Detection, 'displayName' | 'identity'>): string {
  const id = d.identity;
  if (id && (id.status === 'identified' || id.status === 'possible') && id.name) return id.name;
  if (id?.status === 'unknown') return '不明な物体';
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
    if (!m || m.identity || m.requested) return false;
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
