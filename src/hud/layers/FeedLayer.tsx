import { useEffect, useRef } from 'react';
import { useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';

/** Camera / demo feed + gestures (tap = lock or focus, pinch = zoom). */
export function FeedLayer() {
  const orch = useOrch();
  const host = useRef<HTMLDivElement>(null);
  const feed = useFriday((s) => s.feed);
  const css = useFriday((s) => s.feedCss);
  const cam = useFriday((s) => s.camera);
  const flashAt = useFriday((s) => s.flashAt);

  useEffect(() => {
    const el = feed === 'camera' ? orch.camera.video : orch.camera.demo.canvas;
    host.current?.prepend(el);
    return () => el.remove();
  }, [feed, orch]);

  useEffect(() => {
    const node = host.current!;
    const ro = new ResizeObserver(([e]) => orch.onViewResize(e.contentRect.width, e.contentRect.height));
    ro.observe(node);
    return () => ro.disconnect();
  }, [orch]);

  // Gestures
  useEffect(() => {
    const node = host.current!;
    const pts = new Map<number, { x: number; y: number; t: number; x0: number; y0: number }>();
    let pinch: { d0: number; z0: number } | null = null;
    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const down = (e: PointerEvent) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() });
      if (pts.size === 2) pinch = { d0: dist(), z0: useFriday.getState().camera.zoom };
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      if (pinch && pts.size === 2) {
        const z = Math.max(1, Math.min(10, pinch.z0 * (dist() / pinch.d0)));
        void orch.setCamera({ zoom: Math.round(z * 10) / 10 });
      }
    };
    const up = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (!p || pts.size > 0) return;
      const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
      if (moved < 10 && performance.now() - p.t < 400) {
        const r = node.getBoundingClientRect();
        orch.tap((p.x - r.left) / r.width, (p.y - r.top) / r.height);
      }
    };
    node.addEventListener('pointerdown', down);
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const z = useFriday.getState().camera.zoom * (e.deltaY > 0 ? 0.92 : 1.08);
      void orch.setCamera({ zoom: Math.round(Math.max(1, Math.min(10, z)) * 10) / 10 });
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerup', up);
      node.removeEventListener('pointercancel', up);
      node.removeEventListener('wheel', wheel);
    };
  }, [orch]);

  const mirror = feed === 'camera' && cam.facing === 'user';
  const bright = 1 + css.exposure * 0.18 + (cam.night ? 0.35 : 0);
  const filter = `brightness(${bright.toFixed(2)})${cam.night ? ' contrast(1.1) saturate(0.85)' : ''}${cam.hdr ? ' saturate(1.06)' : ''}`;

  return (
    <div className="feed" ref={host}>
      <style>{`.feed > video, .feed > canvas { transform: scale(${css.zoom}) ${mirror ? 'scaleX(-1)' : ''}; filter: ${filter}; }`}</style>
      <div className="feed-shade" />
      <div className="scanlines" />
      {flashAt > 0 && <div key={flashAt} className="flash" />}
    </div>
  );
}
