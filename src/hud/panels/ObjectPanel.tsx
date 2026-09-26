import { useEffect, useRef } from 'react';
import { relativeJa } from '../../core/util';
import { frameSize } from '../../camera/frame';
import { primaryDetection, useFriday } from '../../store/useFriday';
import { useCountUpDom, useOrch, usePresence, useSticky } from '../hooks';
import { Icon } from '../icons';

/** Live crop of the target from the camera frame. */
function TargetThumb() {
  const orch = useOrch();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      const det = primaryDetection(useFriday.getState());
      if (!c || !det) return;
      const frame = orch.camera.frame;
      const { w, h } = frameSize(frame);
      if (!w || !h) return;
      const side = Math.max(det.bbox.w * w, det.bbox.h * h) * 1.08;
      const cx = (det.bbox.x + det.bbox.w / 2) * w;
      const cy = (det.bbox.y + det.bbox.h / 2) * h;
      const ctx = c.getContext('2d')!;
      try {
        ctx.drawImage(frame, cx - side / 2, cy - side / 2, side, side, 0, 0, c.width, c.height);
      } catch {
        /* frame not ready */
      }
    };
    draw();
    const id = setInterval(draw, 500);
    return () => clearInterval(id);
  }, [orch]);
  return <canvas ref={ref} width={160} height={160} />;
}

export function ObjectPanel({ show, compact = false, ticker = false }: { show: boolean; compact?: boolean; ticker?: boolean }) {
  const orch = useOrch();
  const focus = useFriday((s) => s.focus);
  // Subscribe to primitives only — a new detection object every AI tick must not re-render the card.
  const hasDet = useFriday((s) => !!primaryDetection(s));
  const confTarget = useFriday((s) => Math.round((primaryDetection(s)?.confidence ?? 0) * 100));
  const locked = useFriday((s) => s.lockState === 'locked');
  const news = useFriday((s) => s.news[0]);
  const sticky = useSticky(focus);
  const phase = usePresence(show && !!focus && hasDet);
  const pctRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLElement>(null);
  useCountUpDom(confTarget, pctRef, barRef);
  if (!phase || !sticky) return null;
  const facts = sticky.product
    ? [
        { key: 'price', label: '価格', value: `¥${sticky.product.priceJPY.toLocaleString()}` },
        { key: 'rating', label: '評価', value: `★${sticky.product.rating}` },
        ...sticky.product.specs.slice(0, compact ? 0 : 2),
      ]
    : sticky.facts.slice(0, compact ? 2 : 4);

  return (
    <section className={`panel obj-panel ${compact ? 'compact' : ''}`} data-presence={phase} onClick={() => orch.openSheet('intel')} role="button" aria-label={`${sticky.name} の詳細`}>
      <span className="tick" />
      <div className="obj-thumb">
        <TargetThumb />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="label">
          OBJECT IDENTIFICATION {locked && <Icon.Lock size={11} />}
          {compact && (
            <button
              className="obj-quick"
              onClick={(e) => {
                e.stopPropagation();
                void orch.ask('これについて調べて');
              }}
              aria-label="調べる"
            >
              <Icon.Search size={14} />
            </button>
          )}
        </div>
        <div className="obj-name">{sticky.name}</div>
        <div className="obj-sub">{sticky.subtitle}</div>
        <div className="conf">
          <span className="pct glow-o">
            <span ref={pctRef}>{confTarget}</span>
            <small>%</small>
          </span>
          <span className="bar">
            <i ref={barRef} style={{ transform: `scaleX(${confTarget / 100})` }} />
          </span>
        </div>
      </div>
      {facts.length > 0 && (
        <div className="facts">
          {facts.map((f) => (
            <div key={f.key} className="fact">
              <span>{f.label}</span>
              <span>{f.value}</span>
            </div>
          ))}
        </div>
      )}
      {ticker && news && (
        <div className="ticker" onClick={(e) => {
          e.stopPropagation();
          void orch.ask(`${news.title}について調べて`);
        }}>
          <span className="label">LIVE</span>
          <span className="tt">{news.title}</span>
          <span className="faint">{relativeJa(news.publishedAt)}</span>
        </div>
      )}
      <div className="obj-actions" hidden={compact} onClick={(e) => e.stopPropagation()}>
        <button className="chip orange" onClick={() => void orch.ask('これについて調べて')}>
          <Icon.Search size={12} /> 調べる
        </button>
        <button className="chip" onClick={() => (locked ? orch.unlock() : orch.lock())}>
          <Icon.Lock size={12} /> {locked ? 'ロック解除' : 'ロック'}
        </button>
        {sticky.place && (
          <button className="chip" onClick={() => void orch.ask(`${sticky.place!.name}までナビして`)}>
            <Icon.Nav size={12} /> ナビ
          </button>
        )}
      </div>
    </section>
  );
}
