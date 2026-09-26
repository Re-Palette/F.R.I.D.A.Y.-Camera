import { angleDelta, cardinal } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';

/** Compass + radar. North rotates with heading; POIs appear as blips. */
export function Radar() {
  const orch = useOrch();
  const heading = useFriday((s) => s.heading);
  const pois = useFriday((s) => s.pois);
  const nav = useFriday((s) => s.navTarget);
  const mode = useFriday((s) => s.mode);
  const ticks = [];
  for (let a = 0; a < 360; a += 10) {
    const long = a % 90 === 0;
    ticks.push(<line key={a} x1="50" y1="6" x2="50" y2={long ? 11 : 8.5} transform={`rotate(${a} 50 50)`} stroke={long ? '#45d2ff' : 'rgba(69,210,255,.45)'} strokeWidth={long ? 1.2 : 0.7} />);
  }
  return (
    <svg className="radar" viewBox="0 0 100 100" onClick={() => orch.setMode(mode === 'nav' ? 'scan' : 'nav')} role="button" aria-label="Compass and navigation">
      <defs>
        <radialGradient id="rad-bg">
          <stop offset="0%" stopColor="rgba(10,30,60,.55)" />
          <stop offset="100%" stopColor="rgba(3,8,20,.35)" />
        </radialGradient>
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(69,210,255,0)" />
          <stop offset="100%" stopColor="rgba(69,210,255,.45)" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="url(#rad-bg)" stroke="rgba(69,210,255,.55)" strokeWidth="0.8" />
      <circle className="ring-spin" cx="50" cy="50" r="49" fill="none" stroke="#ff8a1f" strokeWidth="1.2" strokeDasharray="18 12 3 12" style={{ filter: 'drop-shadow(0 0 2px #ff8a1f)' }} />
      <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(69,210,255,.22)" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="17" fill="none" stroke="rgba(69,210,255,.22)" strokeWidth="0.6" />
      <g transform={`rotate(${-heading} 50 50)`}>
        {ticks}
        {(['N', 'E', 'S', 'W'] as const).map((d, i) => (
          <text
            key={d}
            x="50"
            y="19"
            transform={`rotate(${i * 90} 50 50)`}
            textAnchor="middle"
            fontSize="8"
            fontFamily="Rajdhani"
            fontWeight="700"
            fill={d === 'N' ? '#ff8a1f' : '#cfe6ff'}
          >
            {d}
          </text>
        ))}
      </g>
      <g className="sweep">
        <path d="M50 50 L50 4 A46 46 0 0 1 82.5 17.5 Z" fill="url(#sweep)" opacity="0.55" />
      </g>
      {pois
        .filter((p) => p.distanceM < 2500)
        .map((p) => {
          const a = (angleDelta(heading, p.bearingDeg) * Math.PI) / 180;
          const r = 8 + 36 * Math.min(1, p.distanceM / 2500);
          const isT = nav?.id === p.id;
          return (
            <circle
              key={p.id}
              cx={50 + r * Math.sin(a)}
              cy={50 - r * Math.cos(a)}
              r={isT ? 2.6 : 1.5}
              fill={isT ? '#ff8a1f' : '#45d2ff'}
              style={isT ? { filter: 'drop-shadow(0 0 3px #ff8a1f)' } : undefined}
            />
          );
        })}
      <path d="M50 38 L56 56 L50 52 L44 56 Z" fill="none" stroke="#ff8a1f" strokeWidth="1.4" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 3px #ff8a1f)' }} />
      <text x="50" y="72" textAnchor="middle" fontSize="7" fontFamily="Share Tech Mono" fill="#cfe6ff">
        {Math.round(heading)}° {cardinal(heading)}
      </text>
    </svg>
  );
}
