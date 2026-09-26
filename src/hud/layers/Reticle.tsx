import { useMemo } from 'react';
import { useAIState, useFriday } from '../../store/useFriday';

const arc = (r: number, a0: number, a1: number) => {
  const p = (a: number) => [200 + r * Math.cos((a * Math.PI) / 180), 200 + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

/**
 * Central scan ring. Each moving part is its own composited layer (a div with
 * a static SVG inside) animated only with transform / opacity, so the GPU
 * just re-composites cached textures — no SVG repaint per frame.
 */
export function Reticle() {
  const ai = useAIState();
  const mode = useFriday((s) => s.mode);
  const hasFocus = useFriday((s) => !!s.focus && !!(s.lockedId ?? s.primaryId));
  const sheet = useFriday((s) => s.sheet);

  const ticks = useMemo(() => {
    const out: string[] = [];
    for (let a = 0; a < 360; a += 5) {
      const r2 = a % 30 === 0 ? 180 : 185;
      const rad = (a * Math.PI) / 180;
      out.push(`M${200 + 190 * Math.cos(rad)} ${200 + 190 * Math.sin(rad)}L${200 + r2 * Math.cos(rad)} ${200 + r2 * Math.sin(rad)}`);
    }
    return out.join('');
  }, []);
  const bars = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 72; i++) {
      const a = ((i * 5 - 90) * Math.PI) / 180;
      const len = 6 + (i % 4) * 3 + (i % 7);
      out.push(`M${200 + 122 * Math.cos(a)} ${200 + 122 * Math.sin(a)}L${200 + (122 + len) * Math.cos(a)} ${200 + (122 + len) * Math.sin(a)}`);
    }
    return out.join('');
  }, []);

  const voice = ai === 'LISTENING' || ai === 'SPEAKING';
  const busy = ai === 'SEARCHING' || ai === 'THINKING' || ai === 'ANALYZING';
  const display = sheet && sheet !== 'intel' ? 'hidden' : mode === 'translate' || mode === 'nav' ? 'hidden' : hasFocus ? 'quiet' : 'active';
  const svg = (children: React.ReactNode) => (
    <svg viewBox="0 0 400 400" width="100%" height="100%" fill="none">
      {children}
    </svg>
  );

  return (
    <div className="reticle" data-mode={display} data-busy={busy ? 1 : 0} data-voice={voice ? ai : ''}>
      <div className="rl rl-static">
        {svg(
          <>
            <circle cx="200" cy="200" r="190" className="core" />
            <path d={ticks} className="c" strokeWidth="1" opacity="0.7" />
            <circle cx="200" cy="200" r="194" className="c" strokeWidth="0.6" opacity="0.35" />
            <path d="M200 150v22M200 228v22M150 200h22M228 200h22" className="c" strokeWidth="1.2" />
            <circle cx="200" cy="200" r="3" fill="#ff8a1f" />
            <circle cx="200" cy="200" r="9" className="o" strokeWidth="1" opacity="0.8" />
          </>,
        )}
      </div>
      <div className="rl rl-spin">
        {svg(
          <>
            <path d={arc(172, -150, -80)} className="o" strokeWidth="2.2" />
            <path d={arc(172, 30, 100)} className="o" strokeWidth="2.2" />
            <path d={arc(172, 115, 125)} className="o" strokeWidth="2.2" />
            <path d={arc(165, -40, 10)} className="c" strokeWidth="1" />
          </>,
        )}
      </div>
      <div className="rl rl-rev">
        {svg(
          <>
            <circle cx="200" cy="200" r="150" className="c" strokeWidth="1" strokeDasharray="2 7" opacity="0.8" />
            <path d={arc(140, 200, 250)} className="o" strokeWidth="1.2" opacity="0.8" />
            <path d={arc(140, 20, 70)} className="o" strokeWidth="1.2" opacity="0.8" />
          </>,
        )}
      </div>
      <div className="rl rl-pulse">{svg(<circle cx="200" cy="200" r="120" className="c" strokeWidth="1" />)}</div>
      <div className="rl rl-voice">{svg(<path d={bars} className={ai === 'SPEAKING' ? 'o' : 'c'} strokeWidth="2" />)}</div>
    </div>
  );
}
