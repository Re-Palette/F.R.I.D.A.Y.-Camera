/**
 * Performance telemetry + adaptive quality governor.
 *
 * Plain mutable object (not React state) so measuring never causes renders.
 * The Perf HUD samples it a few times per second.
 */
import { onFrame } from './frameLoop';

export type Quality = 'high' | 'balanced' | 'low';
export type QualityPref = 'auto' | Quality;

export const perf = {
  // display / HUD
  fps: 0,
  frameMs: 0,
  frameP95: 0,
  refreshHz: 60,
  droppedFrames: 0,
  longTasks: 0,
  // camera preview
  camFps: 0,
  camLatencyMs: null as number | null,
  camDropped: 0,
  camRes: '',
  // AI pipeline
  aiFps: 0,
  aiTargetFps: 0,
  aiInferMs: 0,
  aiLatencyMs: 0,
  aiSkipped: 0,
  aiEngine: '',
  // system
  memMB: null as number | null,
  quality: 'high' as Quality,
  qualityPref: 'auto' as QualityPref,
  motionComp: false,
};

// ─── Display frame monitor ─────────────────────────────────────────────────

const deltas: number[] = [];
let windowStart = 0;
let windowFrames = 0;
let lowWindows = 0;
let goodWindows = 0;

onFrame((now, dt) => {
  deltas.push(dt);
  if (deltas.length > 240) deltas.shift();
  windowFrames++;
  if (!windowStart) windowStart = now;
  // Estimate the panel's refresh interval from the fastest typical frames.
  if (dt > 4 && dt < 40) {
    const hz = 1000 / dt;
    perf.refreshHz = perf.refreshHz * 0.98 + Math.min(144, Math.max(30, hz)) * 0.02;
  }
  const interval = 1000 / Math.round(perf.refreshHz / 30) / 30; // snap to 60/90/120
  if (dt > interval * 1.6 && dt < 1000) perf.droppedFrames += Math.round(dt / interval) - 1;

  if (now - windowStart >= 500) {
    perf.fps = (windowFrames * 1000) / (now - windowStart);
    const recent = deltas.slice(-windowFrames);
    perf.frameMs = recent.reduce((a, b) => a + b, 0) / recent.length;
    const sorted = [...recent].sort((a, b) => a - b);
    perf.frameP95 = sorted[Math.floor(sorted.length * 0.95)] ?? perf.frameMs;
    windowStart = now;
    windowFrames = 0;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    perf.memMB = mem ? mem.usedJSHeapSize / 1048576 : null;
    govern();
  }
});

if (typeof PerformanceObserver !== 'undefined') {
  try {
    new PerformanceObserver((l) => (perf.longTasks += l.getEntries().length)).observe({ type: 'longtask', buffered: false });
  } catch {
    /* longtask unsupported */
  }
}

// ─── Adaptive quality ──────────────────────────────────────────────────────

const listeners = new Set<(q: Quality) => void>();

function apply(q: Quality) {
  if (perf.quality === q && document.documentElement.dataset.quality === q) return;
  perf.quality = q;
  document.documentElement.dataset.quality = q;
  listeners.forEach((fn) => fn(q));
}

/**
 * Degrades visual effects (backdrop blur, glows, scanlines) when the display
 * can't hold its refresh rate, so the camera + HUD stay smooth. Upgrades
 * again only after a long healthy period to avoid oscillation.
 */
function govern() {
  if (perf.qualityPref !== 'auto' || document.hidden) return;
  const healthy = perf.fps >= perf.refreshHz * 0.9;
  const bad = perf.fps < perf.refreshHz * 0.78;
  lowWindows = bad ? lowWindows + 1 : 0;
  goodWindows = healthy ? goodWindows + 1 : 0;
  if (lowWindows >= 4) {
    lowWindows = 0;
    goodWindows = 0;
    if (perf.quality === 'high') apply('balanced');
    else if (perf.quality === 'balanced') apply('low');
  } else if (goodWindows >= 40 && perf.quality === 'low') {
    goodWindows = 0;
    apply('balanced');
  }
}

export function initialQuality(): Quality {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  // Phones start without backdrop blur over the live feed (the most expensive effect).
  return coarse ? 'balanced' : 'high';
}

export function setQualityPref(pref: QualityPref) {
  perf.qualityPref = pref;
  try {
    localStorage.setItem('friday.quality', pref);
  } catch {
    /* ignore */
  }
  apply(pref === 'auto' ? initialQuality() : pref);
}

export function initQuality() {
  let pref: QualityPref = 'auto';
  try {
    const v = localStorage.getItem('friday.quality');
    if (v === 'auto' || v === 'high' || v === 'balanced' || v === 'low') pref = v;
  } catch {
    /* ignore */
  }
  perf.qualityPref = pref;
  apply(pref === 'auto' ? initialQuality() : pref);
}

export function onQuality(fn: (q: Quality) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
