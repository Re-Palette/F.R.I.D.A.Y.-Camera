import { useFriday } from '../../store/useFriday';
import { Icon } from '../icons';

/** Hazard banner. Hazard boxes are styled on the tracked detection itself (see DetectionLayer). */
export function HazardLayer() {
  const message = useFriday((s) => s.hazards[0]?.message);
  const critical = useFriday((s) => s.hazards[0]?.severity === 'critical');
  if (!message) return null;
  return (
    <div className={`hazard-banner ${critical ? '' : 'warn'}`} role="alert">
      <Icon.Warn size={18} />
      <span className="k">{critical ? 'CAUTION' : 'NOTICE'}</span>
      {message}
    </div>
  );
}
