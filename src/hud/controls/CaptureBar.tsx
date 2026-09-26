import type { CaptureMode } from '../../core/types';
import { useFriday } from '../../store/useFriday';
import { useNow, useOrch } from '../hooks';
import { Icon } from '../icons';

const MODES: { id: CaptureMode; label: string }[] = [
  { id: 'scan', label: 'SCAN' },
  { id: 'photo', label: 'PHOTO' },
  { id: 'video', label: 'VIDEO' },
  { id: 'translate', label: 'TRANSLATE' },
  { id: 'nav', label: 'NAV' },
];

function RecTimer() {
  const start = useFriday((s) => s.recordStartedAt);
  const now = useNow(500);
  if (!start) return null;
  const s = Math.floor((now - start) / 1000);
  return (
    <div className="rec-time">
      <span className="live-dot rec-dot" />
      {String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}
    </div>
  );
}

/** Camera controls. Compact, unbranded shutter — the feed stays the hero. */
export function CaptureBar() {
  const orch = useOrch();
  const mode = useFriday((s) => s.mode);
  const recording = useFriday((s) => s.recording);
  const listening = useFriday((s) => s.listening);
  const zoom = useFriday((s) => s.camera.zoom);
  const last = useFriday((s) => s.memoryItems[0]);
  const zooms = [1, 2, 5];
  const nextZoom = zooms.find((z) => z > zoom + 0.05) ?? 1;

  return (
    <footer className="capture">
      <RecTimer />
      <nav className="modes" aria-label="Capture mode">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? 'on' : ''} onClick={() => orch.setMode(m.id)} aria-pressed={mode === m.id}>
            {m.label}
          </button>
        ))}
      </nav>
      <div className="controls" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
        <div className="left">
          <button className="mem-btn" onClick={() => orch.openSheet('memory')} aria-label="Memory">
            {last ? <img src={last.thumbnail} alt="" /> : <Icon.Memory size={20} />}
          </button>
          <button className="zoom-chip" onClick={() => void orch.setCamera({ zoom: nextZoom })} aria-label="Zoom">
            {zoom < 10 ? zoom.toFixed(zoom % 1 ? 1 : 0) : zoom}×
          </button>
        </div>
        <button
          className={`shutter ${mode === 'video' ? 'video' : mode === 'scan' ? 'scan' : ''} ${recording ? 'recording' : ''}`}
          onClick={() => void orch.shutter()}
          aria-label={mode === 'video' ? (recording ? '録画停止' : '録画開始') : '撮影'}
        >
          <svg viewBox="0 0 68 68">
            <circle cx="34" cy="34" r="32" fill="none" stroke="rgba(160,210,255,.55)" strokeWidth="1.2" />
            <g className="spin">
              <path d="M34 2 A32 32 0 0 1 62 18" fill="none" stroke="#ff8a1f" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 3px #ff8a1f)' }} />
              <path d="M34 66 A32 32 0 0 1 6 50" fill="none" stroke="#ff8a1f" strokeWidth="2" style={{ filter: 'drop-shadow(0 0 3px #ff8a1f)' }} />
            </g>
          </svg>
          <span className="core" />
        </button>
        <div className="right">
          <button className={`round-btn ${listening ? 'on' : ''}`} onClick={() => orch.toggleListening()} aria-label={listening ? 'マイクを停止' : '音声で話しかける'} aria-pressed={listening}>
            <Icon.Mic size={20} />
          </button>
          <button className="round-btn" onClick={() => orch.switchCamera()} aria-label="カメラ切替">
            <Icon.Flip size={20} />
          </button>
        </div>
      </div>
    </footer>
  );
}
