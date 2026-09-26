import type { BBox, Detection } from '../../core/types';
import { fmtCoord } from '../../core/util';
import { useFriday } from '../../store/useFriday';
import { boxToScreen } from '../geometry';

function brackets(w: number, h: number) {
  const l = Math.max(8, Math.min(22, w / 4, h / 4));
  return `M0 ${l}V0H${l}M${w - l} 0H${w}V${l}M${w} ${h - l}V${h}H${w - l}M${l} ${h}H0V${h - l}`;
}

/** Recognition overlays: brackets, labels, TARGET IDENTIFIED / LOCKED card. */
export function DetectionLayer() {
  const s = useFriday();
  const { detections, viewSize, density, mode, focus, lockedId, lockState, primaryId, geo, sheet } = s;
  if (!viewSize.w || (sheet && sheet !== 'intel') || mode === 'translate') return null;
  const primary = lockedId ?? primaryId;
  const toScreen = (b: BBox) => boxToScreen(b, s);

  const visible = detections.filter((d) => {
    if (d.id === primary) return true;
    if (density === 'minimal') return false;
    if (mode === 'nav') return false;
    return density === 'full' || d.confidence > 0.6;
  });

  const p = detections.find((d) => d.id === primary);
  const pb = p ? toScreen(p.bbox) : null;
  const portrait = viewSize.w < 700;
  const card = pb && focus && (!portrait || lockState !== 'none') ? targetCard(pb, viewSize, portrait) : null;
  const lat = focus?.place?.lat ?? geo?.lat;
  const lon = focus?.place?.lon ?? geo?.lon;

  return (
    <div className="layer">
      <svg className="layer" width={viewSize.w} height={viewSize.h}>
        {visible.map((d) => {
          const b = toScreen(d.bbox);
          const isP = d.id === primary;
          const cls = `det ${isP ? 'primary' : 'other'} ${d.id === lockedId ? 'locked' : ''}`;
          return (
            <g key={d.id} className={cls} style={{ transform: `translate(${b.x}px, ${b.y}px)` }}>
              <path className="br" d={brackets(b.w, b.h)} />
              {isP && (
                <>
                  <rect x={-3} y={-3} width={4} height={4} fill="#ff8a1f" />
                  <rect x={b.w - 1} y={b.h - 1} width={4} height={4} fill="#ff8a1f" />
                  <line x1={b.w / 2} y1={b.h / 2 - 6} x2={b.w / 2} y2={b.h / 2 + 6} stroke="#ffb455" strokeWidth={1} opacity={0.8} />
                  <line x1={b.w / 2 - 6} y1={b.h / 2} x2={b.w / 2 + 6} y2={b.h / 2} stroke="#ffb455" strokeWidth={1} opacity={0.8} />
                </>
              )}
              {d.id === lockedId && (
                <g className="lock-in">
                  <circle
                    className="lock-ring"
                    cx={b.w / 2}
                    cy={b.h / 2}
                    r={Math.min(Math.max(b.w, b.h) * 0.62, Math.max(viewSize.w, viewSize.h) * 0.4)}
                    fill="none"
                    stroke={lockState === 'lost' ? '#ffc53d' : '#ff8a1f'}
                    strokeWidth={1.4}
                    strokeDasharray="14 10 2 10"
                    style={{ filter: 'drop-shadow(0 0 4px rgba(255,138,31,.9))' }}
                  />
                </g>
              )}
            </g>
          );
        })}
        {card && pb && (
          <polyline
            points={`${card.anchorX},${card.anchorY} ${card.elbowX},${card.anchorY} ${pb.x + pb.w / 2},${pb.y}`}
            fill="none"
            stroke="rgba(120,185,255,.55)"
            strokeWidth={1}
          />
        )}
      </svg>
      {visible
        .filter((d) => d.id !== primary || !focus)
        .map((d) => (
          <Tag key={d.id} d={d} b={toScreen(d.bbox)} primary={d.id === primary} />
        ))}
      {card && focus && (
        <div className={`target-card ${lockState === 'lost' ? 'lost' : ''}`} style={{ left: card.x, top: card.y }}>
          <div className="h">{lockState === 'locked' ? 'TARGET LOCKED' : lockState === 'lost' ? 'TARGET LOST — SEARCHING' : 'TARGET IDENTIFIED'}</div>
          <div>{(focus.nameEn ?? focus.name).toUpperCase()}</div>
          {lat != null && lon != null && (
            <div className="mono" style={{ fontSize: 10.5, opacity: 0.8 }}>
              {fmtCoord(lat, 'N', 'S')} {fmtCoord(lon, 'E', 'W')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tag({ d, b, primary }: { d: Detection; b: BBox; primary: boolean }) {
  return (
    <div className={`det-tag ${primary ? 'primary' : 'other'}`} style={{ left: b.x, top: b.y }}>
      <span className="jp">{d.displayName}</span>
      {Math.round(d.confidence * 100)}%
    </div>
  );
}

function targetCard(b: BBox, view: { w: number; h: number }, portrait: boolean) {
  const cw = 190;
  const ch = 58;
  const minY = portrait ? 250 : 120;
  const above = b.y > ch + minY - 20;
  let x = b.x + b.w / 2 - cw / 2 + Math.min(80, view.w * 0.1);
  x = Math.max(12, Math.min(view.w - cw - 12, x));
  const y = above ? Math.max(minY, b.y - ch - 34) : Math.min(view.h - ch - (portrait ? 380 : 240), b.y + b.h + 24);
  const anchorY = above ? y + ch : y;
  return { x, y, anchorX: x, anchorY, elbowX: x - 14 };
}
