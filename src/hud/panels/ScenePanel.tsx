import { useMemo } from 'react';
import { fmtTime } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { useNow, usePresence, useSticky, useTypewriter } from '../hooks';

const COND_EN: Record<string, string> = { clear: 'CLEAR', partly: 'PARTLY CLOUDY', cloudy: 'CLOUDY', rain: 'RAIN', snow: 'SNOW', storm: 'STORM', fog: 'FOG' };

export function ScenePanel({ show, compact = false }: { show: boolean; compact?: boolean }) {
  const scene = useFriday((s) => s.scene);
  const sticky = useSticky(scene);
  const phase = usePresence(show && !!scene);
  const typed = useTypewriter(sticky?.summary ?? '');
  const location = useFriday((s) => s.location);
  const counts = useFriday((s) => s.objectCounts);
  const total = counts.reduce((a, c) => a + c.n, 0);
  const wx = useFriday((s) => (s.weather ? `${COND_EN[s.weather.now.code] ?? s.weather.now.condition.toUpperCase()} ${s.weather.now.tempC}°C` : null));
  const now = useNow(30_000);
  const bars = useMemo(() => Array.from({ length: 16 }, (_, i) => 4 + ((Math.sin(i * 1.7 + (sticky?.summary.length ?? 0)) + 1) / 2) * 18), [sticky?.summary]);
  if (!phase || !sticky) return null;
  return (
    <section className={`panel scene-panel ${compact ? 'compact' : ''}`} data-presence={phase}>
      <span className="tick" />
      <div className="label">
        SCENE ANALYSIS
        <span className="sub">{Math.round(sticky.confidence * 100)}%</span>
      </div>
      <div className="spark" aria-hidden>
        {bars.map((h, i) => (
          <i key={i} style={{ height: h }} />
        ))}
      </div>
      <div className="scene-summary">
        {typed}
        {typed.length < sticky.summary.length && <span className="caret" />}
      </div>
      {location && (
        <dl className="scene-rows">
          <dt>LOCATION</dt>
          <dd>
            <span>{location.name}</span>
            <span className={`loc-badge ${location.estimated ? 'est' : 'ok'}`}>{location.estimated ? '推定' : 'IDENTIFIED'}</span>
            <span className="faint num">{Math.round(location.confidence * 100)}%</span>
          </dd>
          {!compact && (
            <>
              <dt>TIME</dt>
              <dd className="num">
                {fmtTime(new Date(now))}
                {wx && (
                  <>
                    <span className="faint">·</span> {wx}
                  </>
                )}
              </dd>
              {total > 0 && (
                <>
                  <dt>OBJECTS</dt>
                  <dd>
                    <span className="num">{total}</span>
                    <span className="counts">
                      {counts.slice(0, 4).map((c) => (
                        <span key={c.key}>
                          {c.label} ×{c.n}
                        </span>
                      ))}
                    </span>
                  </dd>
                </>
              )}
            </>
          )}
        </dl>
      )}
      {!compact && (
        <div className="tags">
          {sticky.tags.map((t) => (
            <span key={t} className="chip">
              #{t}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
