/**
 * TrackRenderer — makes AI results (5–15 Hz, ~50–150 ms old) look glued to
 * the 60 fps preview.
 *
 * For every tracked object we keep the last observation in *world* space:
 * the box with the camera's own rotation (gyroscope) removed. Each display
 * frame we
 *   1. extrapolate the object's own motion (velocity × age since capture),
 *   2. re-apply the camera rotation measured *now* (gyro → instant response
 *      when the phone moves, even between AI results),
 *   3. map frame → screen (cover crop, mirror, digital zoom),
 *   4. critically-damped smoothing to remove detector jitter,
 *   5. write only `transform` (and textContent when values change).
 *
 * No React renders, no layout: the DOM nodes are created by React once per
 * track and then driven here from the shared frame loop.
 */
import { live, motionAt } from '../../core/live';
import type { BBox, Detection } from '../../core/types';
import { onFrame } from '../../perf/frameLoop';
import { getState } from '../../store/useFriday';
import { boxToScreen } from '../geometry';

/** Approximate phone main-camera field of view (deg) along the frame's long / short side. */
const FOV_LONG = 68;
const FOV_SHORT = 53;
const MAX_EXTRAPOLATE_MS = 220;
const MAX_SPEED = 0.004; // normalised units per ms
const SMOOTH_MS = 38;

interface Track {
  id: string;
  world: BBox; // observed box minus camera rotation at capture time
  t: number; // capture time of the observation
  vel: { x: number; y: number; w: number; h: number };
  disp: BBox | null; // smoothed screen box (px)
  el: HTMLElement | null;
  kind: 'box' | 'rect';
  parts: { tr?: HTMLElement; bl?: HTMLElement; br?: HTMLElement; center?: HTMLElement; ring?: HTMLElement; label?: HTMLElement };
  labelText: string;
  applied: { x: number; y: number; w: number; h: number };
}

const tracks = new Map<string, Track>();

function cameraOffset(t: number | 'now'): { dx: number; dy: number } {
  const s = getState();
  if (s.feed !== 'camera' || !live.motionAvailable) return { dx: 0, dy: 0 };
  const m = t === 'now' ? { pan: live.pan, tilt: live.tilt } : motionAt(t);
  const landscapeFrame = s.frameSize.w >= s.frameSize.h;
  const hfov = landscapeFrame ? FOV_LONG : FOV_SHORT;
  const vfov = landscapeFrame ? FOV_SHORT : FOV_LONG;
  const mirror = s.camera.facing === 'user' ? -1 : 1;
  // Camera pans left → scene moves right; tilts up → scene moves down.
  return { dx: (m.pan / hfov) * mirror, dy: m.tilt / vfov };
}

function upsert(id: string, box: BBox, t: number, kind: Track['kind']) {
  const off = cameraOffset(t);
  const world = { x: box.x - off.dx, y: box.y - off.dy, w: box.w, h: box.h };
  const tr = tracks.get(id);
  if (!tr) {
    tracks.set(id, { id, world, t, vel: { x: 0, y: 0, w: 0, h: 0 }, disp: null, el: null, kind, parts: {}, labelText: '', applied: { x: Infinity, y: Infinity, w: Infinity, h: Infinity } });
    return;
  }
  const dt = t - tr.t;
  if (dt > 1) {
    const clampV = (v: number) => Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
    const k = 0.5;
    tr.vel = {
      x: tr.vel.x * (1 - k) + clampV((world.x - tr.world.x) / dt) * k,
      y: tr.vel.y * (1 - k) + clampV((world.y - tr.world.y) / dt) * k,
      w: tr.vel.w * (1 - k) + clampV((world.w - tr.world.w) / dt) * k,
      h: tr.vel.h * (1 - k) + clampV((world.h - tr.world.h) / dt) * k,
    };
  }
  tr.world = world;
  tr.t = t;
}

export const trackRenderer = {
  /** Feed a fresh AI result. `capturedAt` is the sensor time of the analysed frame. */
  observe(dets: Detection[], capturedAt: number) {
    for (const d of dets) {
      upsert(d.id, d.bbox, capturedAt, 'box');
      const tr = tracks.get(d.id)!;
      const text = `${d.displayName}  ${Math.round(d.confidence * 100)}%`;
      if (tr.parts.label && text !== tr.labelText) {
        tr.parts.label.textContent = text;
        tr.labelText = text;
      }
    }
    // Forget tracks that are neither observed nor mounted.
    const ids = new Set(dets.map((d) => d.id));
    for (const [id, tr] of tracks) if (!ids.has(id) && !tr.el && tr.kind === 'box') tracks.delete(id);
  },

  /** Static regions (OCR / translation blocks) that should still follow camera motion. */
  observeRects(rects: { id: string; bbox: BBox }[], capturedAt: number) {
    for (const r of rects) upsert(r.id, r.bbox, capturedAt, 'rect');
  },

  /** React ref callback helper: attaches a DOM node to a track id. */
  attach(id: string, el: HTMLElement) {
    let tr = tracks.get(id);
    if (!tr) {
      tr = { id, world: { x: 0.5, y: 0.5, w: 0, h: 0 }, t: performance.now(), vel: { x: 0, y: 0, w: 0, h: 0 }, disp: null, el: null, kind: el.dataset.kind === 'rect' ? 'rect' : 'box', parts: {}, labelText: '', applied: { x: Infinity, y: Infinity, w: Infinity, h: Infinity } };
      tracks.set(id, tr);
    }
    const detach = () => {
      const cur = tracks.get(id);
      if (cur && cur.el === el) {
        cur.el = null;
        cur.parts = {};
      }
    };
    if (tr.el === el && tr.parts.ring === ((el.querySelector('[data-p="ring"]') as HTMLElement | null) ?? undefined) && tr.parts.label === ((el.querySelector('[data-p="label"]') as HTMLElement | null) ?? undefined)) return detach;
    tr.el = el;
    tr.kind = el.dataset.kind === 'rect' ? 'rect' : 'box';
    const q = (r: string) => (el.querySelector(`[data-p="${r}"]`) as HTMLElement | null) ?? undefined;
    tr.parts = { tr: q('tr'), bl: q('bl'), br: q('br'), center: q('center'), ring: q('ring'), label: q('label') };
    tr.labelText = tr.parts.label?.textContent ?? '';
    tr.applied = { x: Infinity, y: Infinity, w: Infinity, h: Infinity };
    // Keep the smoothed position when React re-mounts the node for the same track.
    return detach;
  },

  /** Current smoothed on-screen box for an id (px), if visible. */
  screenBox(id: string | null | undefined): BBox | null {
    return (id && tracks.get(id)?.disp) || null;
  },

  reset() {
    tracks.clear();
  },

  /** Pure prediction step — exported for tests. */
  predict(tr: { world: BBox; t: number; vel: Track['vel'] }, now: number): BBox {
    const age = Math.max(0, Math.min(MAX_EXTRAPOLATE_MS, now - tr.t));
    return { x: tr.world.x + tr.vel.x * age, y: tr.world.y + tr.vel.y * age, w: Math.max(0, tr.world.w + tr.vel.w * age), h: Math.max(0, tr.world.h + tr.vel.h * age) };
  },
};

function frame(now: number, dt: number) {
  if (!tracks.size) return;
  const s = getState();
  if (!s.viewSize.w) return;
  const off = cameraOffset('now');
  const a = 1 - Math.exp(-Math.min(dt, 100) / SMOOTH_MS);
  for (const tr of tracks.values()) {
    if (!tr.el) continue;
    const p = trackRenderer.predict(tr, now);
    const target = boxToScreen({ x: p.x + off.dx, y: p.y + off.dy, w: p.w, h: p.h }, s);
    const d = tr.disp;
    if (!d || Math.abs(target.x - d.x) > s.viewSize.w * 0.35) tr.disp = { ...target };
    else {
      d.x += (target.x - d.x) * a;
      d.y += (target.y - d.y) * a;
      d.w += (target.w - d.w) * a;
      d.h += (target.h - d.h) * a;
    }
    apply(tr);
  }
}

function apply(tr: Track) {
  const d = tr.disp!;
  const ap = tr.applied;
  const moved = Math.abs(d.x - ap.x) > 0.15 || Math.abs(d.y - ap.y) > 0.15;
  const resized = Math.abs(d.w - ap.w) > 0.15 || Math.abs(d.h - ap.h) > 0.15;
  if (!moved && !resized) return;
  const el = tr.el!;
  el.style.transform = `translate3d(${d.x.toFixed(1)}px, ${d.y.toFixed(1)}px, 0)`;
  if (resized) {
    if (tr.kind === 'rect') {
      // Rects (translation blocks) need a real size for text; only when it changes.
      if (Math.abs(d.w - ap.w) > 2 || Math.abs(d.h - ap.h) > 2) {
        el.style.width = `${d.w.toFixed(0)}px`;
        el.style.height = `${d.h.toFixed(0)}px`;
        ap.w = d.w;
        ap.h = d.h;
      }
    } else {
      const { parts } = tr;
      if (parts.tr) parts.tr.style.transform = `translate3d(${d.w.toFixed(1)}px, 0, 0)`;
      if (parts.bl) parts.bl.style.transform = `translate3d(0, ${d.h.toFixed(1)}px, 0)`;
      if (parts.br) parts.br.style.transform = `translate3d(${d.w.toFixed(1)}px, ${d.h.toFixed(1)}px, 0)`;
      if (parts.center) parts.center.style.transform = `translate3d(${(d.w / 2).toFixed(1)}px, ${(d.h / 2).toFixed(1)}px, 0)`;
      if (parts.ring) {
        const r = Math.max(24, Math.max(d.w, d.h) * 0.62);
        parts.ring.style.transform = `translate3d(${(d.w / 2).toFixed(1)}px, ${(d.h / 2).toFixed(1)}px, 0) scale(${(r / 100).toFixed(3)})`;
      }
      ap.w = d.w;
      ap.h = d.h;
    }
  }
  ap.x = d.x;
  ap.y = d.y;
}

onFrame(frame);
