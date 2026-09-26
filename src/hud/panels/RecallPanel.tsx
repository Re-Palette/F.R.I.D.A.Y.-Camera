import { fmtDateJa, relativeJa } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { useOrch, usePresence, useSticky, useUntil } from '../hooks';

/** "この景色、2ヶ月前にも見たね。" — F.R.I.D.A.Y. connects what you see to your memories. */
export function RecallPanel({ always = false }: { always?: boolean }) {
  const orch = useOrch();
  const recall = useFriday((s) => s.recall);
  const items = useFriday((s) => s.memoryItems);
  const fresh = useRecallFresh();
  const sticky = useSticky(recall);
  const phase = usePresence(!!recall && (fresh || always));
  if (!phase || !sticky) return null;
  const tags = new Set(sticky.item.tags);
  const strip = [sticky.item, ...items.filter((i) => i.id !== sticky.item.id && i.tags.some((t) => tags.has(t)))].slice(0, 4);
  return (
    <section className="panel" data-presence={phase} onClick={() => orch.openSheet('memory')} role="button">
      <div className="label orange">
        MEMORY <span className="sub">過去の写真から</span>
      </div>
      <div style={{ display: 'flex', gap: 5, margin: '8px 0' }}>
        {strip.map((m) => (
          <img key={m.id} src={m.thumbnail} alt="" style={{ width: `${100 / strip.length}%`, maxWidth: 82, aspectRatio: '4/3', objectFit: 'cover', border: '1px solid var(--edge-strong)' }} />
        ))}
      </div>
      <div className="recall" style={{ gridTemplateColumns: '1fr' }}>
        <div>
          <div className="q">この景色、{relativeJa(sticky.item.createdAt)}にも見たね。</div>
          <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
            {fmtDateJa(new Date(sticky.item.createdAt))}
          </div>
        </div>
      </div>
    </section>
  );
}

export const RECALL_MS = 12000;

export function useRecallFresh(): boolean {
  const at = useFriday((s) => (s.recall ? s.recallAt : 0));
  return useUntil(at ? at + RECALL_MS : 0);
}
