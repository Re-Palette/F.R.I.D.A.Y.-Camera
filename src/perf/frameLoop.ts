/**
 * The single requestAnimationFrame loop of the app.
 *
 * Everything that must move at display rate (tracked HUD boxes, compass,
 * perf meter) subscribes here and writes `transform` / `opacity` /
 * `textContent` directly — no React renders at 60 fps, no competing rAFs.
 */
type FrameFn = (now: number, dt: number) => void;

const subs = new Set<FrameFn>();
let raf = 0;
let last = 0;

function tick(now: number) {
  const dt = last ? now - last : 16.7;
  last = now;
  for (const fn of subs) fn(now, dt);
  raf = requestAnimationFrame(tick);
}

export function onFrame(fn: FrameFn): () => void {
  subs.add(fn);
  if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(tick);
  return () => {
    subs.delete(fn);
  };
}
