import { useEffect, useState } from 'react';
import type { MemoryItem } from '../../core/types';
import { fmtDateJa } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { useOrch } from '../hooks';
import { Icon } from '../icons';
import { MockBadge, Sheet } from './Sheet';

const SUGGEST = ['去年撮った東京の夜景', 'Re-Paletteのイベント写真', '夕方の写真', 'この場所で撮った写真', '去年撮った海の写真'];

/** Future-facing AI tools. `ready: false` tools are wired into the UI but await a backend. */
const EDIT_TOOLS: { id: string; label: string; ready: boolean }[] = [
  { id: 'enhance', label: '高画質化', ready: false },
  { id: 'bg-remove', label: '背景削除', ready: false },
  { id: 'erase', label: '不要物削除', ready: false },
  { id: 'deblur', label: 'ブレ補正', ready: false },
  { id: 'denoise', label: 'ノイズ除去', ready: false },
  { id: 'color', label: '色補正', ready: false },
  { id: 'crop', label: '自動トリミング', ready: false },
];
const VIDEO_TOOLS = ['ハイライト抽出', '不要部分カット', '字幕生成', 'BGM', 'ショート動画化', 'Reel変換'];

export function MemorySheet() {
  const orch = useOrch();
  const open = useFriday((s) => s.sheet === 'memory');
  const items = useFriday((s) => s.memoryItems);
  const hits = useFriday((s) => s.memoryHits);
  const query = useFriday((s) => s.memoryQuery);
  const selected = useFriday((s) => s.selectedMemory);
  const [q, setQ] = useState(query);

  const list = hits ? hits.map((h) => ({ item: h.item, reasons: h.reasons })) : items.map((item) => ({ item, reasons: [] as string[] }));

  return (
    <Sheet open={open} title={selected ? 'MEMORY · DETAIL' : 'MEMORY'} badge={<MockBadge service="memory" />}>
      {selected ? (
        <Detail item={selected} onBack={() => useFriday.setState({ selectedMemory: null })} />
      ) : (
        <>
          <form
            className="mem-search"
            onSubmit={(e) => {
              e.preventDefault();
              void orch.searchMemory(q);
            }}
          >
            <Icon.Search size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="自然言語で写真を検索（例: 去年撮った海の写真）" enterKeyHint="search" />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ('');
                  void orch.searchMemory('');
                }}
                aria-label="クリア"
              >
                <Icon.Close size={14} />
              </button>
            )}
          </form>
          <div className="suggest">
            {SUGGEST.map((s) => (
              <button
                key={s}
                className={`chip ${query === s ? 'active' : ''}`}
                onClick={() => {
                  setQ(s);
                  void orch.searchMemory(s);
                }}
              >
                {s}
              </button>
            ))}
          </div>
          {hits && (
            <div className="label" style={{ marginTop: 6 }}>
              {hits.length} RESULTS <span className="sub">「{query}」</span>
            </div>
          )}
          <div className="mem-grid">
            {list.map(({ item, reasons }) => (
              <button key={item.id} className="mem-cell" onClick={() => useFriday.setState({ selectedMemory: item })}>
                <img src={item.thumbnail} alt={item.tags.join(' ')} loading="lazy" />
                {reasons.length > 0 && (
                  <div className="why">
                    {reasons.slice(0, 2).map((r) => (
                      <span key={r}>{r}</span>
                    ))}
                  </div>
                )}
                {item.kind === 'video' && <span className="vid">VIDEO</span>}
                <div className="meta">
                  <b>{new Date(item.createdAt).toLocaleDateString('ja-JP')}</b>
                  {item.place}
                </div>
              </button>
            ))}
          </div>
          {!list.length && <p className="dim" style={{ marginTop: 14 }}>該当する写真はありません。</p>}
        </>
      )}
    </Sheet>
  );
}

function Detail({ item, onBack }: { item: MemoryItem; onBack: () => void }) {
  const orch = useOrch();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void orch.services.memory.getBlob(item.id).then((b) => {
      if (b && b.type.startsWith('image')) setUrl((u = URL.createObjectURL(b)));
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
      setUrl(null);
    };
  }, [item.id, orch]);
  return (
    <div className="mem-detail">
      <button className="chip" onClick={onBack} style={{ marginBottom: 10 }}>
        ← BACK
      </button>
      <img src={url ?? item.thumbnail} alt="" />
      <h3>Semantic tags</h3>
      <div className="tags">
        {item.tags.map((t) => (
          <span key={t} className="chip">
            #{t}
          </span>
        ))}
        <span className="chip orange">{fmtDateJa(new Date(item.createdAt))}</span>
      </div>
      {item.scene && (
        <p className="dim" style={{ marginTop: 8, fontSize: 13 }}>
          {item.scene}
          {item.place ? ` · ${item.place}` : ''}
        </p>
      )}
      <h3>AI {item.kind === 'video' ? 'Video' : 'Photo'} Edit</h3>
      <div className="tool-grid">
        {(item.kind === 'video' ? VIDEO_TOOLS.map((l) => ({ id: l, label: l, ready: false })) : EDIT_TOOLS).map((t) => (
          <button key={t.id} className="tool" disabled={!t.ready}>
            <Icon.Sparkle size={14} /> {t.label}
            {!t.ready && <span className="soon">SOON</span>}
          </button>
        ))}
      </div>
      <h3>Share · AI draft</h3>
      <div className="row-actions" style={{ marginTop: 0 }}>
        <button className="btn primary" onClick={() => void orch.draftSocial(item, 'instagram')}>
          <Icon.Share size={14} /> Instagram
        </button>
        <button className="btn" onClick={() => void orch.draftSocial(item, 'linkedin')}>
          LinkedIn
        </button>
        <button className="btn" onClick={() => void orch.draftSocial(item, 'note')}>
          note
        </button>
        <button className="btn danger" onClick={() => void orch.deleteMemory(item.id)} aria-label="削除">
          <Icon.Trash size={14} />
        </button>
      </div>
    </div>
  );
}
