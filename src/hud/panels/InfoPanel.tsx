import { relativeJa } from '../../core/util';
import { TIER_LABEL } from '../../services/search/ranking';
import { useFriday } from '../../store/useFriday';
import { useOrch, usePresence, useSticky } from '../hooks';
import { Icon } from '../icons';

export function InfoPanel({ show }: { show: boolean }) {
  const orch = useOrch();
  const focus = useFriday((s) => s.focus);
  const news = useFriday((s) => s.news);
  const related = useFriday((s) => s.related);
  const has = !!focus && (news.length > 0 || related.length > 0);
  const data = useSticky(has ? { focus: focus!, news, related } : null);
  const phase = usePresence(show && has);
  if (!phase || !data) return null;
  const top = data.news[0];
  return (
    <section className="panel info-panel from-right" data-presence={phase}>
      <span className="tick" />
      <div className="label">REAL-TIME INFO</div>
      {top && (
        <div className="news" onClick={() => void orch.ask(`${top.title}について調べて`)} role="button">
          <div className="news-title">{top.title}</div>
          <div className="news-meta">
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className={`tier tier-${top.tier}`}>{TIER_LABEL[top.tier]}</span>
              {top.source}
            </span>
            <span>{relativeJa(top.publishedAt)}</span>
          </div>
        </div>
      )}
      {data.related.length > 0 && (
        <>
          <div className="divider" />
          <div className="label" style={{ justifyContent: 'space-between' }}>
            <span>関連情報</span>
            <button onClick={() => orch.openSheet('intel')} aria-label="詳細">
              <Icon.External size={13} />
            </button>
          </div>
          <ul className="related">
            {data.related.slice(0, 3).map((r) => (
              <li key={r.id} onClick={() => void orch.ask(`${data.focus.name} ${r.title}`)} role="button">
                {r.title}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
