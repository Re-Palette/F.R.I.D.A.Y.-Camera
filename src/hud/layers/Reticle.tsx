import { useMemo } from 'react';
import { useAIState, useFriday } from '../../store/useFriday';

/** Central scan ring. Recedes when a target is identified so the view stays clear. */
export function Reticle() {
  const ai = useAIState();
  const mode = useFriday((s) => s.mode);
  const hasFocus = useFriday((s) => !!s.focus && !!(s.lockedId ?? s.primaryId));
  const sheet = useFriday((s) => s.sheet);

  const ticks = useMemo(() => {
    const out: string[] = [];
    for (let a = 0; a < 360; a += 5) {
      const long = a % 30 === 0;
      const r1 = 190;
      const r2 = long ? 180 : 185;
      const rad = (a * Math.PI) / 180;
      out.push(`M${200 + r1 * Math.cos(rad)} ${200 + r1 * Math.sin(rad)}L${200 + r2 * Math.cos(rad)} ${200 + r2 * Math.sin(rad)}`);
    }
    return out.join('');
  }, []);

  const bars = useMemo(() => Array.from({ length: 72 }, (_, i) => i * 5), []);
  const voice = ai === 'LISTENING' || ai === 'SPEAKING';
  const busy = ai === 'SEARCHING' || ai === 'THINKING' || ai === 'ANALYZING';
  const display = sheet && sheet !== 'intel' ? 'hidden' : mode === 'translate' || mode === 'nav' ? 'hidden' : hasFocus ? 'quiet' : 'active';

  const arc = (r: number, a0: number, a1: number) => {
    const p = (a: number) => [200 + r * Math.cos((a * Math.PI) / 180), 200 + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };

  return (
    <div className="reticle" data-mode={display} data-busy={busy ? 1 : 0}>
      <svg viewBox="0 0 400 400" width="100%" height="100%" fill="none">
        <defs>
          <radialGradient id="rg-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,160,70,0.10)" />
            <stop offset="60%" stopColor="rgba(255,120,40,0.03)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        <circle cx="200" cy="200" r="190" fill="url(#rg-core)" />
        <path d={ticks} className="c" strokeWidth="1" opacity="0.7" />
        <circle cx="200" cy="200" r="194" className="c" strokeWidth="0.6" opacity="0.35" />
        <g className="r-spin">
          <path d={arc(172, -150, -80)} className="o" strokeWidth="2.2" />
          <path d={arc(172, 30, 100)} className="o" strokeWidth="2.2" />
          <path d={arc(172, 115, 125)} className="o" strokeWidth="2.2" />
          <path d={arc(165, -40, 10)} className="c" strokeWidth="1" />
        </g>
        <g className="r-spin-rev">
          <circle cx="200" cy="200" r="150" className="c" strokeWidth="1" strokeDasharray="2 7" opacity="0.8" />
          <path d={arc(140, 200, 250)} className="o" strokeWidth="1.2" opacity="0.8" />
          <path d={arc(140, 20, 70)} className="o" strokeWidth="1.2" opacity="0.8" />
        </g>
        {voice && (
          <g>
            {bars.map((a, i) => (
              <line
                key={a}
                x1="200"
                y1="78"
                x2="200"
                y2={70 - (i % 4) * 3 - (i % 7)}
                className={ai === 'SPEAKING' ? 'o' : 'c'}
                strokeWidth="2"
                transform={`rotate(${a} 200 200)`}
                style={{ animation: `vpulse ${0.5 + (i % 5) * 0.13}s ease-in-out ${(i % 7) * 0.06}s infinite` }}
              />
            ))}
          </g>
        )}
        {(ai === 'SCANNING' || ai === 'LISTENING') && <circle className="r-pulse c" cx="200" cy="200" r="120" strokeWidth="1" />}
        <g className="c" strokeWidth="1.2">
          <path d="M200 150v22M200 228v22M150 200h22M228 200h22" />
        </g>
        <circle cx="200" cy="200" r="3" fill="#ff8a1f" />
        <circle cx="200" cy="200" r="9" className="o" strokeWidth="1" opacity="0.8" />
      </svg>
    </div>
  );
}
