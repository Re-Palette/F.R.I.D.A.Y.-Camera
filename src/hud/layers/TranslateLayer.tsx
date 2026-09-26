import { useFriday } from '../../store/useFriday';
import { trackRenderer } from '../tracking/trackRenderer';

/** AR translation: translated text replaces the original in place (positioned by the TrackRenderer). */
export function TranslateLayer() {
  const mode = useFriday((s) => s.mode);
  const translations = useFriday((s) => s.translations);
  if (mode !== 'translate') return null;
  return (
    <div className="layer">
      {translations
        .filter((t) => t.bbox)
        .map((t) => (
          <div key={t.id} className="tr-block" data-kind="rect" ref={(el) => (el ? trackRenderer.attach(`tr:${t.id}`, el) : undefined)} style={{ ['--len' as string]: t.target.length }}>
            <span className="src">
              {t.sourceLang.toUpperCase()}→{t.targetLang.toUpperCase()}
            </span>
            <span className="txt">{t.target}</span>
          </div>
        ))}
    </div>
  );
}
