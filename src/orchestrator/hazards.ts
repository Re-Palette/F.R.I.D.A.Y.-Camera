import type { Detection, Hazard } from '../core/types';

/**
 * Safety rules evaluated on every detection frame. Deliberately conservative:
 * the HUD only escalates to `critical` for large, central, moving hazards.
 */
export function evaluateHazards(dets: Detection[]): Hazard[] {
  const out: Hazard[] = [];
  for (const d of dets) {
    const area = d.bbox.w * d.bbox.h;
    const cx = d.bbox.x + d.bbox.w / 2;
    const central = cx > 0.25 && cx < 0.75;
    if (d.category === 'vehicle' || d.category === 'train') {
      if (area > 0.06 && central) out.push({ id: d.id, kind: 'vehicle', severity: 'critical', message: `${d.displayName}が接近しています`, bbox: d.bbox });
      else if (area > 0.03 && central) out.push({ id: d.id, kind: 'vehicle', severity: 'warn', message: `前方に${d.displayName}`, bbox: d.bbox });
    }
    if (/cone|barrier|construction/i.test(d.label)) out.push({ id: d.id, kind: 'construction', severity: 'warn', message: '工事区域 — 足元に注意', bbox: d.bbox });
    if (/fire|flame/i.test(d.label)) out.push({ id: d.id, kind: 'fire', severity: 'critical', message: '火気を検知', bbox: d.bbox });
    if (/smoke/i.test(d.label)) out.push({ id: d.id, kind: 'smoke', severity: 'critical', message: '煙を検知', bbox: d.bbox });
    if (/step|stairs|curb/i.test(d.label)) out.push({ id: d.id, kind: 'step', severity: 'warn', message: '段差あり', bbox: d.bbox });
  }
  return out.sort((a, b) => (a.severity === 'critical' ? -1 : 0) - (b.severity === 'critical' ? -1 : 0));
}
