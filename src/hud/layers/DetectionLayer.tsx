import { Fragment, useEffect, useRef, useState } from 'react';
import type { Detection } from '../../core/types';
import { onFrame } from '../../perf/frameLoop';
import { headline, rankForHud, shownConfidence, shownName } from '../../services/vision/perception';
import { getState, useFriday, type FridayState } from '../../store/useFriday';
import { useOrch } from '../hooks';
import { STAGE_LABEL } from '../panels/TopBar';
import { trackRenderer } from '../tracking/trackRenderer';

interface Item {
  id: string;
  primary: boolean;
  locked: boolean;
  lost: boolean;
  hazard: '' | 'warn' | 'critical';
  /** Full label (headline + name) or a quiet marker only. */
  labelled: boolean;
  state: string;
  head: string;
  name: string;
}

/**
 * Which tracks are shown and how — changes only when the set of objects or
 * their *recognition state* changes (never per frame). Positions and the
 * live confidence % are streamed by the TrackRenderer.
 */
function selectItems(s: FridayState): string {
  if (!s.viewSize.w || (s.sheet && s.sheet !== 'intel') || s.mode === 'translate') return '';
  const primary = s.lockedId ?? s.primaryId;
  const wide = s.viewSize.w >= 900;
  const budget = s.density === 'minimal' ? 1 : s.density === 'full' ? 12 : wide ? 5 : 3;
  const visible = s.detections.filter((d) => {
    if (d.id === primary) return true;
    if (s.density === 'minimal' || s.mode === 'nav') return false;
    return d.confidence > (s.density === 'full' ? 0.35 : 0.5);
  });
  const { labelled } = rankForHud(visible, primary, budget);
  const out: Item[] = visible.map((d) => {
    const hz = s.hazards.find((h) => h.id === d.id);
    return {
      id: d.id,
      primary: d.id === primary,
      locked: d.id === s.lockedId,
      lost: d.id === s.lockedId && s.lockState === 'lost',
      hazard: hz ? (hz.severity === 'critical' ? 'critical' : 'warn') : '',
      labelled: labelled.has(d.id) && !(d.id === primary && hasCard(d) && s.density !== 'minimal' && s.mode !== 'nav'),
      state: d.category === 'person' ? 'person' : d.source === 'ocr' ? 'text' : (d.identity?.status ?? 'detected'),
      head: headline(d),
      name: shownName(d),
    };
  });
  return JSON.stringify(out);
}

export function DetectionLayer() {
  const key = useFriday(selectItems);
  const items: Item[] = key ? JSON.parse(key) : [];
  const conf = new Map(getState().detections.map((d) => [d.id, Math.round(shownConfidence(d) * 100)]));
  return (
    <div className="layer det-layer">
      {items.map((it) => (
        <div
          key={it.id}
          className={`det ${it.primary ? 'primary' : 'other'} ${it.labelled || it.primary ? '' : 'quiet'} st-${it.state} ${it.locked ? 'locked' : ''} ${it.lost ? 'lost' : ''} ${it.hazard ? `hz-${it.hazard}` : ''}`}
          data-kind="box"
          ref={(el) => (el ? trackRenderer.attach(it.id, el) : undefined)}
        >
          <i className="c tl" />
          <i className="c tr" data-p="tr" />
          <i className="c bl" data-p="bl" />
          <i className="c br" data-p="br" />
          {it.primary && <i className="cross" data-p="center" />}
          {(it.locked || it.state === 'identifying') && (
            <span className={`lock-ring ${it.locked ? '' : 'scan'}`} data-p="ring">
              <span className="spin" />
            </span>
          )}
          {it.labelled && (
            <span className={`det-tag ${it.primary ? 'primary' : 'other'}`} data-p="label">
              <b className="h">{it.head}</b>
              <span className="n">{it.name}</span>
              {it.state !== 'identifying' && (
                <span className="pct" data-p="pct">
                  {conf.get(it.id) ?? ''}%
                </span>
              )}
            </span>
          )}
        </div>
      ))}
      <TargetCard />
    </div>
  );
}

/** Targets that get the near-object card (people and text keep their plain tag). */
function hasCard(d: Detection | undefined): boolean {
  return !!d && d.category !== 'person' && d.source !== 'ocr' && d.source !== 'geo';
}

interface CardData {
  id: string;
  head: string;
  name: string;
  note?: string;
  pct: number | null;
  rows: [string, string][];
  web: string;
  mock: boolean;
}

const ROW_KEYS: [string, string][] = [
  ['ブランド', 'Brand'],
  ['カテゴリー', 'Category'],
  ['モデル', 'Model'],
  ['カラー', 'Color'],
];

const WEB_LABEL: Record<string, string> = {
  verified: 'WEB VERIFIED',
  partial: 'WEB PARTIAL',
  contradicted: 'WEB MISMATCH',
  unverified: 'NOT VERIFIED',
  skipped: '',
};

/** Card content — recomputed only when the target's recognition result changes. */
function selectCard(s: FridayState): string {
  if (!s.viewSize.w || (s.sheet && s.sheet !== 'intel') || s.mode === 'translate' || s.mode === 'nav' || s.density === 'minimal') return '';
  const id = s.lockedId ?? s.primaryId;
  const d = s.detections.find((x) => x.id === id);
  if (!d || !hasCard(d)) return '';
  const idt = d.identity;
  const busy = !idt || idt.status === 'identifying' || !!idt.stage;
  const stage = idt?.stage ? STAGE_LABEL[idt.stage] : busy ? 'ANALYZING' : '';
  const known = idt && (idt.status === 'identified' || idt.status === 'possible');
  const data: CardData = {
    id: d.id,
    head: stage ? `${stage}…` : '',
    name: shownName(d),
    note: idt?.note,
    pct: idt && idt.status !== 'identifying' && idt.status !== 'detected' ? Math.round(idt.confidence * 100) : null,
    rows: known ? ROW_KEYS.filter(([k]) => idt.attributes?.[k]).map(([k, en]) => [en, idt.attributes![k]]) : [],
    web: idt?.verification ? (WEB_LABEL[idt.verification.status] ?? '') : '',
    mock: idt?.source === 'mock',
  };
  return JSON.stringify(data);
}

/**
 * [ TARGET LOCK ] — a thin card next to the current target that follows its
 * box from the frame loop (transform only). Compact by default: name + %.
 * Tapping it (or locking the target) expands Brand / Category / Model /
 * Color — only what the image or its text actually showed — and a link to
 * the full provenance in the INTEL sheet.
 */
function TargetCard() {
  const orch = useOrch();
  const key = useFriday(selectCard);
  const lockState = useFriday((s) => s.lockState);
  const lockedId = useFriday((s) => s.lockedId);
  const portrait = useFriday((s) => s.viewSize.w < 700);
  const [openId, setOpenId] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const leader = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 200, h: 60 });
  const data: CardData | null = key ? JSON.parse(key) : null;
  const show = !!data;
  const locked = !!data && data.id === lockedId;
  const expanded = !!data && (locked || openId === data.id);

  useEffect(() => {
    const c = card.current;
    if (!show || !c) return;
    const ro = new ResizeObserver(() => {
      size.current = { w: c.offsetWidth, h: c.offsetHeight };
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [show]);

  useEffect(() => {
    if (!show) return;
    return onFrame(() => {
      const s = getState();
      const b = trackRenderer.screenBox(s.lockedId ?? s.primaryId);
      const c = card.current;
      const l = leader.current;
      if (!b || !c || !l) return;
      const { w: cw, h: ch } = size.current;
      const W = s.viewSize.w;
      const H = s.viewSize.h;
      const gap = 14;
      const top = portrait ? 200 : 110;
      const bottom = H - (portrait ? 330 : 200);
      // Beside the box (right, else left), else above / below it.
      let x: number;
      let y: number;
      let side: 'r' | 'l' | 't' | 'b';
      if (b.x + b.w + gap + cw < W - 8) {
        x = b.x + b.w + gap;
        side = 'r';
      } else if (b.x - gap - cw > 8) {
        x = b.x - gap - cw;
        side = 'l';
      } else {
        x = Math.max(8, Math.min(W - cw - 8, b.x + b.w / 2 - cw / 2));
        side = b.y - ch - gap > top ? 't' : 'b';
      }
      if (side === 'r' || side === 'l') y = Math.max(top, Math.min(bottom - ch, b.y));
      else y = side === 't' ? b.y - ch - gap : Math.min(bottom - ch, b.y + b.h + gap);
      y = Math.max(8, y);
      c.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const ax = side === 'r' ? x : side === 'l' ? x + cw : x + cw / 2;
      const ay = side === 't' ? y + ch : side === 'b' ? y : y + 10;
      const bx = side === 'r' ? b.x + b.w : side === 'l' ? b.x : b.x + b.w / 2;
      const by = side === 't' ? b.y : side === 'b' ? b.y + b.h : Math.max(b.y, Math.min(b.y + b.h, ay));
      const len = Math.hypot(bx - ax, by - ay);
      const ang = Math.atan2(by - ay, bx - ax);
      l.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0) rotate(${ang.toFixed(3)}rad) scaleX(${len.toFixed(1)})`;
    });
  }, [show, portrait]);

  if (!data) return null;
  const lost = locked && lockState === 'lost';
  return (
    <>
      <div className="leader" ref={leader} />
      <div
        className={`target-card ${lost ? 'lost' : ''} ${expanded ? 'open' : ''} ${locked ? 'locked' : ''}`}
        ref={card}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => !locked && setOpenId(expanded ? null : data.id)}
      >
        <div className="h">
          <span>{lost ? '[ TARGET LOST ] SEARCHING' : '[ TARGET LOCK ]'}</span>
          {data.head && <span className="stage">{data.head}</span>}
        </div>
        <div className="nm">{data.name}</div>
        {data.note && <div className="note">{data.note}</div>}
        {data.pct != null && (
          <div className="conf">
            <span>Confidence</span>
            <b className="num">{data.pct}%</b>
            <i style={{ transform: `scaleX(${data.pct / 100})` }} />
          </div>
        )}
        {expanded && (
          <>
            {data.rows.length > 0 && (
              <dl className="rows">
                {data.rows.map(([k, v]) => (
                  <Fragment key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {data.web && (
              <div className={`web ${data.web === 'WEB VERIFIED' ? 'ok' : ''}`}>
                {data.web}
                {data.mock ? ' · MOCK' : ''}
              </div>
            )}
            <button
              className="more"
              onClick={(e) => {
                e.stopPropagation();
                orch.openSheet('intel');
              }}
            >
              [ VIEW DETAILS ]
            </button>
          </>
        )}
      </div>
    </>
  );
}
