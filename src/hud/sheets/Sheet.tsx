import type { ReactNode } from 'react';
import { useFriday } from '../../store/useFriday';
import { useOrch, usePresence } from '../hooks';
import { Icon } from '../icons';

export function Sheet({ open, title, badge, children }: { open: boolean; title: string; badge?: ReactNode; children: ReactNode }) {
  const orch = useOrch();
  const phase = usePresence(open, 450);
  if (!phase) return null;
  return (
    <>
      <div className="sheet-scrim" style={{ opacity: phase === 'shown' ? 1 : 0 }} onClick={() => orch.openSheet(null)} />
      <section className="sheet" data-presence={phase} role="dialog" aria-label={title}>
        <header className="sheet-head">
          <h2>{title}</h2>
          {badge}
          <button className="icon-btn x" onClick={() => orch.openSheet(null)} aria-label="閉じる">
            <Icon.Close size={16} />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}

export function MockBadge({ service }: { service: 'search' | 'llm' | 'memory' | 'news' | 'places' }) {
  const mode = useFriday((s) => s.serviceModes[service]);
  return mode === 'mock' ? <span className="mock-badge">MOCK DATA</span> : <span className="chip" style={{ height: 18, fontSize: 9.5 }}>LIVE</span>;
}
