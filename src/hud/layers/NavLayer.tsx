import { useEffect, useRef } from 'react';
import { live } from '../../core/live';
import type { NavTarget } from '../../core/types';
import { angleDelta, fmtDistance } from '../../core/util';
import { onFrame } from '../../perf/frameLoop';
import { getState, useFriday } from '../../store/useFriday';
import { Icon } from '../icons';

const FOV = 62;

/**
 * AR navigation. React renders the markers only when the POI set changes;
 * their horizontal position follows the compass every frame via transform.
 */
export function NavLayer() {
  const mode = useFriday((s) => s.mode);
  const pois = useFriday((s) => s.pois);
  const target = useFriday((s) => s.navTarget);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== 'nav') return;
    return onFrame(() => {
      const el = root.current;
      if (!el) return;
      const { w, h } = getState().viewSize;
      const horizon = h * 0.42;
      el.querySelectorAll<HTMLElement>('[data-bearing]').forEach((m) => {
        const rel = angleDelta(live.heading, Number(m.dataset.bearing));
        const inView = Math.abs(rel) < FOV / 2;
        const isTarget = m.dataset.target === '1';
        m.style.opacity = inView ? '1' : '0';
        const dy = isTarget ? 10 : -Math.min(80, Number(m.dataset.dist) / 25);
        m.style.transform = `translate3d(${((0.5 + rel / FOV) * w).toFixed(1)}px, ${(horizon + dy).toFixed(1)}px, 0) translate(-50%, -100%)`;
      });
      const edge = el.querySelector<HTMLElement>('[data-edge]');
      const floor = el.querySelector<HTMLElement>('[data-floor]');
      const t = getState().navTarget;
      if (t) {
        const rel = angleDelta(live.heading, t.bearingDeg);
        if (edge) {
          edge.style.opacity = Math.abs(rel) >= FOV / 2 ? '1' : '0';
          edge.dataset.side = rel < 0 ? 'left' : 'right';
        }
        if (floor) floor.style.opacity = Math.abs(rel) < 18 ? '1' : '0';
      }
    });
  }, [mode]);

  if (mode !== 'nav') return null;
  const Marker = ({ p, isTarget }: { p: NavTarget; isTarget: boolean }) => (
    <div className={`nav-marker ${isTarget ? '' : 'poi'}`} data-bearing={p.bearingDeg} data-dist={p.distanceM} data-target={isTarget ? '1' : '0'}>
      <div className="pin">
        {isTarget ? `→ ${p.name}` : p.name}
        <small>{isTarget ? `${fmtDistance(p.distanceM)} · 徒歩${p.eta.walkMin}分` : fmtDistance(p.distanceM)}</small>
      </div>
      <div className="stem" />
    </div>
  );
  return (
    <div className="layer" ref={root}>
      {pois
        .filter((p) => p.id !== target?.id && p.distanceM < 3000)
        .slice(0, 6)
        .map((p) => (
          <Marker key={p.id} p={p} isTarget={false} />
        ))}
      {target && <Marker p={target} isTarget />}
      {target && (
        <div className="nav-edge" data-edge data-side="right">
          <Icon.Nav size={18} className="l" style={{ transform: 'rotate(-90deg)' }} />
          {target.name} {fmtDistance(target.distanceM)}
          <Icon.Nav size={18} className="r" style={{ transform: 'rotate(90deg)' }} />
        </div>
      )}
      {target && (
        <svg className="nav-floor" viewBox="0 0 100 100" data-floor>
          {[0, 1, 2].map((i) => (
            <path key={i} className="chev" d="M25 70 50 50 75 70" fill="none" stroke="#ff8a1f" strokeWidth="5" style={{ animationDelay: `${i * 0.45}s` }} />
          ))}
        </svg>
      )}
    </div>
  );
}
