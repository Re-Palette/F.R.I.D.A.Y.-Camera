import { useFriday } from '../../store/useFriday';
import { useOrch, usePresence } from '../hooks';
import { Icon } from '../icons';

/** Translation status + read-aloud, shown in TRANSLATE mode. */
export function TranslateBar() {
  const orch = useOrch();
  const mode = useFriday((s) => s.mode);
  const tr = useFriday((s) => s.translations);
  const ocr = useFriday((s) => s.ocr);
  const phase = usePresence(mode === 'translate');
  if (!phase) return null;
  const lang = (tr[0]?.sourceLang ?? ocr?.language ?? '—').toUpperCase();
  return (
    <section className="panel cyan" data-presence={phase}>
      <div className="label">
        TRANSLATION <span className="sub">{lang} → JA</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ fontSize: 13 }}>{tr.length ? `${tr.length} 行を翻訳` : ocr ? 'テキストを探しています…' : '文字にカメラを向けてください'}</span>
        {tr.length > 0 && (
          <>
            <button className="chip orange" style={{ marginLeft: 'auto' }} onClick={() => void orch.services.voice.speak(tr.map((t) => t.target).join('。'), 'ja-JP')}>
              <Icon.Speaker size={13} /> 読み上げ
            </button>
            <button className="chip" onClick={() => void orch.ask('このメニューを要約して')}>
              要約
            </button>
          </>
        )}
      </div>
    </section>
  );
}
