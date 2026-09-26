import { angleDelta, fmtDistance } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { Icon } from '../icons';

const FOV = 62;

/** AR navigation: horizon markers for POIs, edge arrows, floor chevrons. */
export function NavLayer() {
  const { mode, pois, navTarget, heading, viewSize } = useFriday();
  if (mode !== 'nav' || !viewSize.w) return null;
  const horizon = viewSize.h * 0.42;
  const place = (bearing: number) => angleDelta(heading, bearing);
  const t = navTarget;
  const rel = t ? place(t.bearingDeg) : 0;
  const inView = t && Math.abs(rel) < FOV / 2;

  return (
    <div className="layer">
      {pois
        .filter((p) => p.id !== t?.id && Math.abs(place(p.bearingDeg)) < FOV / 2 && p.distanceM < 3000)
        .slice(0, 6)
        .map((p) => {
          const x = (0.5 + place(p.bearingDeg) / FOV) * viewSize.w;
          const y = horizon - Math.min(80, p.distanceM / 25);
          return (
            <div key={p.id} className="nav-marker poi" style={{ left: x, top: y }}>
              <div className="pin">
                {p.name}
                <small>{fmtDistance(p.distanceM)}</small>
              </div>
              <div className="stem" />
            </div>
          );
        })}
      {t && inView && (
        <div className="nav-marker" style={{ left: (0.5 + rel / FOV) * viewSize.w, top: horizon + 10 }}>
          <div className="pin">
            → {t.name}
            <small>
              {fmtDistance(t.distanceM)} · 徒歩{t.eta.walkMin}分
            </small>
          </div>
          <div className="stem" />
        </div>
      )}
      {t && !inView && (
        <div className={`nav-edge ${rel < 0 ? 'left' : 'right'}`}>
          {rel < 0 && <Icon.Nav size={18} style={{ transform: 'rotate(-90deg)' }} />}
          {t.name} {fmtDistance(t.distanceM)}
          {rel > 0 && <Icon.Nav size={18} style={{ transform: 'rotate(90deg)' }} />}
        </div>
      )}
      {t && Math.abs(rel) < 18 && (
        <svg className="nav-floor" viewBox="0 0 100 100">
          {[0, 1, 2].map((i) => (
            <path
              key={i}
              className="chev"
              d="M25 70 50 50 75 70"
              fill="none"
              stroke="#ff8a1f"
              strokeWidth="5"
              style={{ animationDelay: `${i * 0.45}s`, filter: 'drop-shadow(0 0 4px #ff8a1f)' }}
            />
          ))}
        </svg>
      )}
    </div>
  );
}
