import type { BBox } from './types';

let seq = 0;
export function uid(prefix = 'id'): string {
  seq = (seq + 1) % 1e9;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    });
  });

export function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

export function lerpBox(a: BBox, b: BBox, t: number): BBox {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) };
}

export function boxContains(b: BBox, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

export function boxCenter(b: BBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * Maps a normalised box in source-frame space into normalised viewport space,
 * accounting for `object-fit: cover` cropping (and optional horizontal mirroring
 * for the selfie camera).
 */
export function frameToView(
  b: BBox,
  src: { w: number; h: number },
  view: { w: number; h: number },
  mirror = false,
): BBox {
  if (!src.w || !src.h || !view.w || !view.h) return b;
  const scale = Math.max(view.w / src.w, view.h / src.h);
  const dw = src.w * scale;
  const dh = src.h * scale;
  const ox = (dw - view.w) / 2;
  const oy = (dh - view.h) / 2;
  let x = (b.x * dw - ox) / view.w;
  const y = (b.y * dh - oy) / view.h;
  const w = (b.w * dw) / view.w;
  const h = (b.h * dh) / view.h;
  if (mirror) x = 1 - x - w;
  return { x, y, w, h };
}

/** Inverse of {@link frameToView} for a point (used for tap-to-lock). */
export function viewToFrame(
  p: { x: number; y: number },
  src: { w: number; h: number },
  view: { w: number; h: number },
  mirror = false,
): { x: number; y: number } {
  if (!src.w || !src.h || !view.w || !view.h) return p;
  const scale = Math.max(view.w / src.w, view.h / src.h);
  const dw = src.w * scale;
  const dh = src.h * scale;
  const ox = (dw - view.w) / 2;
  const oy = (dh - view.h) / 2;
  const vx = mirror ? 1 - p.x : p.x;
  return { x: (vx * view.w + ox) / dw, y: (p.y * view.h + oy) / dh };
}

// ─── Geo ────────────────────────────────────────────────────────────────────

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Signed smallest difference a→b in degrees (-180‥180). */
export function angleDelta(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

export function cardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function fmtCoord(v: number, pos: string, neg: string): string {
  return `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateJa(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${fmtTime(d)}`;
}

export function relativeJa(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.round(diff / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}日前`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}ヶ月前`;
  return `${Math.round(mo / 12)}年前`;
}

export function timeOfDayFor(d: Date): import('./types').TimeOfDay {
  const h = d.getHours();
  if (h < 5) return 'night';
  if (h < 7) return 'dawn';
  if (h < 11) return 'morning';
  if (h < 16) return 'day';
  if (h < 19) return 'dusk';
  return 'night';
}
