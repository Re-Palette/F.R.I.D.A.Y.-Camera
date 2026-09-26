import { angleDelta, fmtDistance } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { useOrch, usePresence, useSticky } from '../hooks';
import { Icon } from '../icons';

export function NavPanel() {
  const orch = useOrch();
  const mode = useFriday((s) => s.mode);
  const t = useFriday((s) => s.navTarget);
  const heading = useFriday((s) => s.heading);
  const pois = useFriday((s) => s.pois);
  const sticky = useSticky(t);
  const phase = usePresence(mode === 'nav');
  if (!phase) return null;
  if (!sticky || !t)
    return (
      <section className="panel" data-presence={phase}>
        <div className="label orange">AR NAVIGATION</div>
        <div className="dim" style={{ fontSize: 12, margin: '6px 0 8px' }}>
          行き先を選ぶか「駅までナビして」と話しかけてください
        </div>
        <div className="tags">
          {pois.slice(0, 5).map((p) => (
            <button key={p.id} className="chip" onClick={() => useFriday.setState({ navTarget: p })}>
              {p.name} · {fmtDistance(p.distanceM)}
            </button>
          ))}
        </div>
      </section>
    );
  const rel = angleDelta(heading, sticky.bearingDeg);
  return (
    <section className="panel" data-presence={phase}>
      <div className="nav-panel">
        <div>
          <div className="label orange">NAVIGATING</div>
          <div className="dest">{sticky.name}</div>
        </div>
        <svg width="46" height="46" viewBox="0 0 46 46" aria-label="direction">
          <circle cx="23" cy="23" r="21" fill="none" stroke="rgba(69,210,255,.4)" />
          <g transform={`rotate(${rel} 23 23)`}>
            <path d="M23 7 31 31 23 26 15 31Z" fill="rgba(255,138,31,.25)" stroke="#ff8a1f" strokeWidth="1.5" strokeLinejoin="round" />
          </g>
        </svg>
        <div className="eta" style={{ gridColumn: '1 / -1' }}>
          <span className="num" style={{ fontSize: 18 }}>
            {fmtDistance(sticky.distanceM)}
          </span>
          <span className="on">
            <Icon.Walk size={15} /> {sticky.eta.walkMin}分
          </span>
          <span>
            <Icon.Bike size={15} /> {sticky.eta.bikeMin}分
          </span>
          <span>
            <Icon.Car size={15} /> {sticky.eta.carMin}分
          </span>
          <button className="chip" style={{ marginLeft: 'auto' }} onClick={() => orch.setMode('scan')}>
            END
          </button>
        </div>
      </div>
    </section>
  );
}
