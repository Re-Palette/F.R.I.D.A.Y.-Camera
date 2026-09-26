import { useFriday } from '../../store/useFriday';
import { boxToScreen } from '../geometry';
import { Icon } from '../icons';

export function HazardLayer() {
  const s = useFriday();
  const { hazards, viewSize } = s;
  if (!hazards.length || !viewSize.w) return null;
  const top = hazards[0];
  return (
    <>
      <svg className="layer" width={viewSize.w} height={viewSize.h}>
        {hazards
          .filter((h) => h.bbox)
          .map((h) => {
            const b = boxToScreen(h.bbox!, s);
            return <rect key={h.id} className={`hz-box ${h.severity === 'critical' ? '' : 'warn'}`} x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={2} />;
          })}
      </svg>
      <div className={`hazard-banner ${top.severity === 'critical' ? '' : 'warn'}`} role="alert">
        <Icon.Warn size={18} />
        <span className="k">{top.severity === 'critical' ? 'CAUTION' : 'NOTICE'}</span>
        {top.message}
      </div>
    </>
  );
}
