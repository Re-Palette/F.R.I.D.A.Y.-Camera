import { useFriday } from '../../store/useFriday';
import { boxToScreen } from '../geometry';

/** AR translation: translated text replaces the original in place. */
export function TranslateLayer() {
  const s = useFriday();
  const { translations, mode, viewSize } = s;
  if (mode !== 'translate' || !viewSize.w) return null;
  return (
    <div className="layer">
      {translations
        .filter((t) => t.bbox)
        .map((t) => {
          const b = boxToScreen(t.bbox!, s);
          const fs = Math.max(10, Math.min(17, b.h * 0.4, (b.w / Math.max(6, t.target.length)) * 1.5));
          return (
            <div key={t.id} className="tr-block" style={{ left: b.x, top: b.y, width: b.w, height: b.h, fontSize: fs }}>
              <span className="src">{t.sourceLang.toUpperCase()}→{t.targetLang.toUpperCase()}</span>
              {t.target}
            </div>
          );
        })}
    </div>
  );
}
