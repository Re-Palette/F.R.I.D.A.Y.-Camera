import { relativeJa } from '../../core/util';
import type { SearchStage } from '../../core/types';
import { TIER_LABEL } from '../../services/search/ranking';
import { useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';
import { Icon } from '../icons';
import { MockBadge, Sheet } from './Sheet';

const STAGES: [SearchStage, string][] = [
  ['query', 'QUERY'],
  ['retrieve', 'RETRIEVE'],
  ['rank', 'RANK'],
  ['crosscheck', 'VERIFY'],
  ['summarize', 'SUMMARY'],
];

export function SearchSheet() {
  const orch = useOrch();
  const open = useFriday((s) => s.sheet === 'search');
  const run = useFriday((s) => s.search);
  const idx = run ? (run.stage === 'done' ? STAGES.length : STAGES.findIndex(([k]) => k === run.stage)) : -1;
  return (
    <Sheet open={open} title="AI SEARCH" badge={<MockBadge service="search" />}>
      {!run && <p className="dim">「これについて調べて」と話しかけると、公式・公的機関・報道を優先して検索・照合・要約します。</p>}
      {run && (
        <>
          <div className="label" style={{ marginBottom: 8 }}>
            <Icon.Search size={12} /> {run.query}
          </div>
          <div className="pipeline">
            {STAGES.map(([k, l], i) => (
              <div key={k} className={i < idx ? 'done' : i === idx ? 'now' : ''}>
                {l}
              </div>
            ))}
          </div>
          {run.stage !== 'done' && <div className="stage-detail">▸ {run.detail ?? run.stage.toUpperCase()}…</div>}
          {run.answer && (
            <>
              <p className="answer">{run.answer.summary}</p>
              {run.answer.keyPoints.length > 0 && (
                <ul className="points">
                  {run.answer.keyPoints.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <h3>Sources · 信頼度順</h3>
              <div className="sources">
                {run.answer.sources.map((s) => (
                  <a key={s.id} className="source" href={s.url} target="_blank" rel="noreferrer">
                    <span className={`tier tier-${s.tier}`}>{TIER_LABEL[s.tier]}</span>
                    <span className="t">{s.title}</span>
                    <span className="p">
                      {s.publisher}
                      {s.publishedAt ? ` · ${relativeJa(s.publishedAt)}` : ''}
                    </span>
                    <span className="trust" style={{ color: s.trust > 0.8 ? 'var(--green)' : s.trust > 0.6 ? 'var(--cyan)' : 'var(--text-dim)' }}>
                      {Math.round(s.trust * 100)}
                    </span>
                  </a>
                ))}
              </div>
              {run.answer.followUps.length > 0 && (
                <>
                  <h3>Follow-up</h3>
                  <div className="followups">
                    {run.answer.followUps.map((f) => (
                      <button
                        key={f}
                        className="chip orange"
                        onClick={() => {
                          orch.openSheet(null);
                          void orch.ask(f);
                        }}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </Sheet>
  );
}
