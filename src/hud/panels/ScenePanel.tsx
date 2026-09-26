import { useMemo } from 'react';
import { useFriday } from '../../store/useFriday';
import { usePresence, useSticky, useTypewriter } from '../hooks';

export function ScenePanel({ show, compact = false }: { show: boolean; compact?: boolean }) {
  const scene = useFriday((s) => s.scene);
  const sticky = useSticky(scene);
  const phase = usePresence(show && !!scene);
  const typed = useTypewriter(sticky?.summary ?? '');
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
