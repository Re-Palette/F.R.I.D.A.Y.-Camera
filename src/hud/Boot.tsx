import { useEffect, useState } from 'react';
import { useFriday } from '../store/useFriday';

const LINES = ['VISION CORE', 'SENSOR ARRAY', 'MEMORY BANK', 'VOICE LINK', 'HUD OVERLAY'];

/** Suit-up sequence shown while the camera and services come online. */
export function Boot() {
  const phase = useFriday((s) => s.bootPhase);
  const booted = useFriday((s) => s.booted);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!booted) return;
    const t = setTimeout(() => setGone(true), 900);
    return () => clearTimeout(t);
  }, [booted]);
  if (gone) return null;
  const shown = Math.min(LINES.length, 1 + phase * 1.4);
  return (
    <div className={`boot ${booted ? 'done' : ''}`}>
      <div className="boot-inner">
        <div className="boot-logo" aria-label="F.R.I.D.A.Y.">
          {'F.R.I.D.A.Y.'.split('').map((c, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.06}s` }}>
              {c}
            </span>
          ))}
        </div>
        <div className="boot-sub">AI VISION INTERFACE</div>
        <div className="boot-log">
          {LINES.slice(0, Math.floor(shown)).map((l, i) => (
            <div key={l} style={{ animationDelay: `${i * 0.05}s` }}>
              <span>▸ {l}</span>
              <b>ONLINE</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
