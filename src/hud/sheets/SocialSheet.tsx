import type { SocialPlatform } from '../../core/types';
import { useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';
import { MockBadge, Sheet } from './Sheet';

const PLATFORMS: [SocialPlatform, string][] = [
  ['instagram', 'Instagram'],
  ['linkedin', 'LinkedIn'],
  ['note', 'note'],
];

export function SocialSheet() {
  const orch = useOrch();
  const open = useFriday((s) => s.sheet === 'social');
  const draft = useFriday((s) => s.socialDraft);
  const item = useFriday((s) => s.selectedMemory);
  const text = draft ? [draft.caption, draft.body, draft.hashtags.join(' ')].filter(Boolean).join('\n\n') : '';
  return (
    <Sheet open={open} title="SOCIAL · AI DRAFT" badge={<MockBadge service="llm" />}>
      {item && (
        <div className="tabs">
          {PLATFORMS.map(([p, l]) => (
            <button key={p} className={`chip ${draft?.platform === p ? 'active' : ''}`} onClick={() => void orch.draftSocial(item, p)}>
              {l}
            </button>
          ))}
        </div>
      )}
      {item && <img src={item.thumbnail} alt="" style={{ width: 120, border: '1px solid var(--edge)', marginBottom: 10 }} />}
      {!draft ? (
        <p className="dim">生成中…</p>
      ) : (
        <>
          <div className="draft">
            {draft.caption}
            {draft.body && `\n\n${draft.body}`}
          </div>
          <div className="hash">{draft.hashtags.join(' ')}</div>
          {draft.reelIdea && (
            <>
              <h3>Reel idea</h3>
              <p style={{ fontSize: 13 }}>{draft.reelIdea}</p>
            </>
          )}
          <div className="row-actions">
            <button className="btn primary" onClick={() => void navigator.clipboard?.writeText(text).then(() => orch.toast('COPIED'))}>
              COPY
            </button>
            {typeof navigator.share === 'function' && (
              <button className="btn" onClick={() => void navigator.share({ text }).catch(() => undefined)}>
                SHARE
              </button>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
