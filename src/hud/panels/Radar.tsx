import { useEffect, useMemo, useRef } from 'react';
import { live } from '../../core/live';
import { angleDelta, cardinal } from '../../core/util';
import { onFrame } from '../../perf/frameLoop';
import { getState, useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';

/**
 * Compass + radar. The compass card and blips follow the 60 Hz heading from
 * the frame loop via transform; React renders only when the POI set changes.
 */
export function Radar() {
  const orch = useOrch();
  const pois = useFriday((s) => s.pois);
  const navId = useFriday((s) => s.navTarget?.id);
  const mode = useFriday((s) => s.mode);
  const card = useRef<HTMLDivElement>(null);
  const blips = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      onFrame(() => {
        const h = live.heading || getState().heading;
        if (card.current) card.current.style.transform = `rotate(${(-h).toFixed(1)}deg)`;
        blips.current?.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => {
          const a = (angleDelta(h, Number(b.dataset.b)) * Math.PI) / 180;
          const r = Number(b.dataset.r);
          b.style.transform = `translate3d(${(r * Math.sin(a)).toFixed(2)}%, ${(-r * Math.cos(a)).toFixed(2)}%, 0)`;
        });
        const txt = `${Math.round(h)}° ${cardinal(h)}`;
        if (readout.current && readout.current.textContent !== txt) readout.current.textContent = txt;
      }),
    [],
  );

  const ticks = useMemo(() => {
    const out = [];
    for (let a = 0; a < 360; a += 10) {
      const long = a % 90 === 0;
      out.push(<line key={a} x1="50" y1="6" x2="50" y2={long ? 11 : 8.5} transform={`rotate(${a} 50 50)`} stroke={long ? '#45d2ff' : 'rgba(69,210,255,.45)'} strokeWidth={long ? 1.2 : 0.7} />);
    }
    return out;
  }, []);

  return (
    <div className="radar" onClick={() => orch.setMode(mode === 'nav' ? 'scan' : 'nav')} role="button" aria-label="Compass and navigation">
      <svg className="rd" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="46" fill="rgba(5,14,32,.5)" stroke="rgba(69,210,255,.55)" strokeWidth="0.8" />
        <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(69,210,255,.22)" strokeWidth="0.6" />
        <circle cx="50" cy="50" r="17" fill="none" stroke="rgba(69,210,255,.22)" strokeWidth="0.6" />
      </svg>
      <div className="rd rd-ring">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="49" fill="none" stroke="#ff8a1f" strokeWidth="1.2" strokeDasharray="18 12 3 12" />
        </svg>
      </div>
      <div className="rd rd-sweep" />
      <div className="rd" ref={card}>
        <svg viewBox="0 0 100 100">
          {ticks}
          {(['N', 'E', 'S', 'W'] as const).map((d, i) => (
            <text key={d} x="50" y="19" transform={`rotate(${i * 90} 50 50)`} textAnchor="middle" fontSize="8" fontFamily="Rajdhani" fontWeight="700" fill={d === 'N' ? '#ff8a1f' : '#cfe6ff'}>
              {d}
            </text>
          ))}
        </svg>
      </div>
      <div className="rd rd-blips" ref={blips}>
        {pois
          .filter((p) => p.distanceM < 2500)
          .map((p) => (
            <i key={p.id} data-b={p.bearingDeg} data-r={(8 + 36 * Math.min(1, p.distanceM / 2500)).toFixed(1)} className={navId === p.id ? 'nav' : ''} />
          ))}
      </div>
      <svg className="rd" viewBox="0 0 100 100">
        <path d="M50 38 L56 56 L50 52 L44 56 Z" fill="none" stroke="#ff8a1f" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="rd-readout mono" ref={readout} />
    </div>
  );
}
