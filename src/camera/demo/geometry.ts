/**
 * Shared geometry for the procedural demo feed.
 *
 * The demo renderer draws objects at these normalised positions and the mock
 * vision service reports detections at the same positions, so the HUD's boxes
 * line up with what is on screen. A slow "hand-held" sway is applied to both.
 */
import type { BBox } from '../../core/types';
import type { DemoScene } from '../../services/contracts';

export interface DemoObject {
  key: string;
  bbox: BBox;
  /** Seconds after scene start before the mock detector "acquires" it. */
  acquireAt: number;
}

export const DEMO_OBJECTS: Record<DemoScene, DemoObject[]> = {
  odaiba: [
    { key: 'rainbow-bridge', bbox: { x: 0.04, y: 0.395, w: 0.6, h: 0.215 }, acquireAt: 1.6 },
    { key: 'tokyo-tower', bbox: { x: 0.735, y: 0.3, w: 0.09, h: 0.265 }, acquireAt: 3.2 },
    { key: 'yakatabune', bbox: { x: 0.55, y: 0.655, w: 0.16, h: 0.05 }, acquireAt: 4.4 },
  ],
  desk: [
    { key: 'laptop', bbox: { x: 0.14, y: 0.38, w: 0.66, h: 0.3 }, acquireAt: 1.2 },
    { key: 'smartphone', bbox: { x: 0.68, y: 0.71, w: 0.2, h: 0.14 }, acquireAt: 2.4 },
    { key: 'coffee', bbox: { x: 0.08, y: 0.68, w: 0.15, h: 0.12 }, acquireAt: 3.4 },
  ],
  menu: [{ key: 'menu', bbox: { x: 0.12, y: 0.22, w: 0.76, h: 0.56 }, acquireAt: 1.0 }],
  street: [
    { key: 'car', bbox: { x: 0.33, y: 0.5, w: 0.3, h: 0.17 }, acquireAt: 1.0 },
    { key: 'cone', bbox: { x: 0.72, y: 0.67, w: 0.08, h: 0.12 }, acquireAt: 1.8 },
    { key: 'cafe-lumen', bbox: { x: 0.04, y: 0.2, w: 0.32, h: 0.12 }, acquireAt: 2.6 },
    { key: 'pedestrian', bbox: { x: 0.84, y: 0.44, w: 0.08, h: 0.26 }, acquireAt: 3.2 },
  ],
};

/** Menu lines rendered on the demo menu card; the mock OCR reads them back. */
export const DEMO_MENU_LINES: { text: string; y: number; size: 'title' | 'item' | 'note' }[] = [
  { text: 'CAFÉ DU PONT', y: 0.29, size: 'title' },
  { text: 'Croissant au beurre — 3,50 €', y: 0.4, size: 'item' },
  { text: 'Soupe à l’oignon gratinée — 9,00 €', y: 0.47, size: 'item' },
  { text: 'Quiche lorraine & salade — 12,50 €', y: 0.54, size: 'item' },
  { text: 'Tarte Tatin maison — 6,00 €', y: 0.61, size: 'item' },
  { text: 'Café crème — 4,20 €', y: 0.68, size: 'item' },
  { text: 'Service compris. Merci !', y: 0.745, size: 'note' },
];

export interface SwayTransform {
  dx: number;
  dy: number;
  s: number;
}

/** Hand-held camera sway, deterministic in time. */
export function sway(t: number): SwayTransform {
  return {
    dx: Math.sin(t * 0.21) * 0.018 + Math.sin(t * 0.9) * 0.002,
    dy: Math.cos(t * 0.17) * 0.01 + Math.sin(t * 1.3) * 0.0015,
    s: 1.06,
  };
}

export function applySway(b: BBox, tr: SwayTransform): BBox {
  return {
    x: (b.x - 0.5) * tr.s + 0.5 + tr.dx,
    y: (b.y - 0.5) * tr.s + 0.5 + tr.dy,
    w: b.w * tr.s,
    h: b.h * tr.s,
  };
}

/** The street scene's car approaches over time — its box grows (hazard demo). */
export function streetCarBox(t: number): BBox {
  const k = (Math.sin(t * 0.35) + 1) / 2; // 0‥1
  const w = 0.22 + k * 0.2;
  const h = w * 0.56;
  return { x: 0.48 - w / 2, y: 0.6 - h / 2 + k * 0.04, w, h };
}
