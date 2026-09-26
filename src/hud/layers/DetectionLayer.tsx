import { useEffect, useRef } from 'react';
import { fmtCoord } from '../../core/util';
import { onFrame } from '../../perf/frameLoop';
import { headline, rankForHud, shownConfidence, shownName } from '../../services/vision/perception';
import { getState, useFriday, type FridayState } from '../../store/useFriday';
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
      labelled: labelled.has(d.id),
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
          className={`det ${it.primary ? 'primary' : 'other'} ${it.labelled ? '' : 'quiet'} st-${it.state} ${it.locked ? 'locked' : ''} ${it.lost ? 'lost' : ''} ${it.hazard ? `hz-${it.hazard}` : ''}`}
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

/** TARGET LOCKED card (+ coordinates), following the locked box from the frame loop. */
function TargetCard() {
  const focus = useFriday((s) => s.focus);
  const lockState = useFriday((s) => s.lockState);
  const portrait = useFriday((s) => s.viewSize.w < 700);
  const hidden = useFriday((s) => !s.viewSize.w || (!!s.sheet && s.sheet !== 'intel') || s.mode === 'translate' || !s.lockedId);
  const geoLat = useFriday((s) => (s.geo ? +s.geo.lat.toFixed(4) : null));
  const geoLon = useFriday((s) => (s.geo ? +s.geo.lon.toFixed(4) : null));
  const card = useRef<HTMLDivElement>(null);
  const leader = useRef<HTMLDivElement>(null);
  const show = !!focus && !hidden && lockState !== 'none';

  useEffect(() => {
    if (!show) return;
    return onFrame(() => {
      const s = getState();
      const b = trackRenderer.screenBox(s.lockedId);
      const c = card.current;
      const l = leader.current;
      if (!b || !c || !l) return;
      const cw = 190;
      const ch = 58;
      const minY = portrait ? 250 : 120;
      const above = b.y > ch + minY + 10;
      const x = Math.max(12, Math.min(s.viewSize.w - cw - 12, b.x + b.w / 2 - cw / 2 + Math.min(80, s.viewSize.w * 0.1)));
      const y = above ? Math.max(minY, b.y - ch - 44) : Math.min(s.viewSize.h - ch - (portrait ? 380 : 240), b.y + b.h + 24);
      c.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const ax = x;
      const ay = above ? y + ch : y;
      const bx = b.x + b.w / 2;
      const by = above ? b.y : b.y + b.h;
      const len = Math.hypot(bx - ax, by - ay);
      const ang = Math.atan2(by - ay, bx - ax);
      l.style.transform = `translate3d(${ax.toFixed(1)}px, ${ay.toFixed(1)}px, 0) rotate(${ang.toFixed(3)}rad) scaleX(${len.toFixed(1)})`;
    });
  }, [show, portrait]);

  if (!show || !focus) return null;
  const lat = focus.place?.lat ?? geoLat;
  const lon = focus.place?.lon ?? geoLon;
  return (
    <>
      <div className="leader" ref={leader} />
      <div className={`target-card ${lockState === 'lost' ? 'lost' : ''}`} ref={card}>
        <div className="h">{lockState === 'lost' ? 'TARGET LOST — SEARCHING' : 'TARGET LOCKED'}</div>
        <div>{(focus.nameEn ?? focus.name).toUpperCase()}</div>
        {lat != null && lon != null && (
          <div className="mono" style={{ fontSize: 10.5, opacity: 0.8 }}>
            {fmtCoord(lat, 'N', 'S')} {fmtCoord(lon, 'E', 'W')}
          </div>
        )}
      </div>
    </>
  );
}
