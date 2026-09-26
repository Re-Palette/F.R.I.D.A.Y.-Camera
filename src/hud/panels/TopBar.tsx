import { useEffect, useRef, useState } from 'react';
import { perf } from '../../perf/metrics';
import { fmtTime } from '../../core/util';
import { promptInstall, usePwa } from '../../pwa';
import { deriveAIState, primaryDetection, useAIState, useFriday } from '../../store/useFriday';
import { useNow, useOrch } from '../hooks';
import { Icon } from '../icons';

export const STAGE_LABEL: Record<string, string> = { reading: 'OCR', analyzing: 'VISION ANALYSIS', matching: 'IDENTIFICATION', verifying: 'WEB VERIFY' };

const STATE_LABEL: Record<string, string> = {
  BOOTING: 'BOOTING',
  IDLE: 'STANDBY',
  SCANNING: 'SCANNING',
  ANALYZING: 'ANALYZING',
  IDENTIFYING: 'IDENTIFYING',
  IDENTIFIED: 'IDENTIFIED',
  TARGET_LOCKED: 'TARGET LOCKED',
  LISTENING: 'LISTENING',
  THINKING: 'THINKING',
  SEARCHING: 'SEARCHING',
  SPEAKING: 'SPEAKING',
  ERROR: 'ERROR',
};

export function AIStatus({ compact = false }: { compact?: boolean }) {
  const ai = useAIState();
  const detail = useFriday((s) => {
    const st = deriveAIState(s);
    if (st === 'SEARCHING') return s.search?.detail ?? s.search?.stage.toUpperCase();
    if (st === 'IDENTIFIED' || st === 'TARGET_LOCKED') return s.focus?.name;
    if (st === 'IDENTIFYING') {
      const d = primaryDetection(s);
      const stage = d?.identity?.stage;
      return `${stage ? `${STAGE_LABEL[stage]} · ` : ''}${d?.displayName ?? ''}`;
    }
    if (st === 'LISTENING') return s.partial || undefined;
    if (st === 'SCANNING') return `${s.detections.length} OBJECTS`;
    return undefined;
  });
  const glyph =
    ai === 'TARGET_LOCKED' ? (
      <Icon.Lock size={12} />
    ) : ai === 'IDENTIFIED' ? (
      <Icon.Target size={12} />
    ) : (
      <span className="glyph">
        <i />
        <i />
        <i />
        <i />
      </span>
    );
  return (
    <span className="ai-state" data-s={ai} aria-live="polite">
      {glyph}
      {STATE_LABEL[ai]}
      {!compact && detail && <span className="detail">· {detail}</span>}
    </span>
  );
}

/** Gemini Live connection state (vision = LIVE). Tap → SYSTEM. */
function GeminiChip() {
  const orch = useOrch();
  const live = useFriday((s) => s.live);
  if (!live) return null;
  const label = { open: live.mic ? 'GEMINI · MIC' : 'GEMINI LIVE', connecting: 'GEMINI …', reconnecting: 'GEMINI …', error: 'GEMINI ✕', closed: 'GEMINI ✕', idle: 'GEMINI' }[live.status] ?? 'GEMINI';
  return (
    <button className={`gemini-chip st-${live.status} ${live.mic ? 'mic' : ''}`} onClick={() => orch.openSheet('system')} title={live.detail}>
      <i />
      {label}
    </button>
  );
}

function useBattery(): number | null {
  const [lvl, setLvl] = useState<number | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; addEventListener: (e: string, f: () => void) => void }> };
    nav.getBattery?.().then((b) => {
      setLvl(b.level);
      b.addEventListener('levelchange', () => setLvl(b.level));
    });
  }, []);
  return lvl;
}

export function TopBar() {
  const orch = useOrch();
  const now = useNow(10_000);
  const battery = useBattery();
  const feed = useFriday((s) => s.feed);
  const cam = useFriday((s) => s.camera);
  const recording = useFriday((s) => s.recording);
  const anyMock = useFriday((s) => Object.values(s.serviceModes).some((m) => m === 'mock') || s.feed === 'demo');
  const [quick, setQuick] = useState(false);

  return (
    <header className="topbar">
      <div className="topbar-row">
        <div className="brand" onClick={() => orch.openSheet('system')} role="button" aria-label="F.R.I.D.A.Y. system">
          F<span className="brand-dot">.</span>R<span className="brand-dot">.</span>I<span className="brand-dot">.</span>D<span className="brand-dot">.</span>A
          <span className="brand-dot">.</span>Y<span className="brand-dot">.</span>
        </div>
        <button className="feed-chips" onClick={() => setQuick((q) => !q)} aria-expanded={quick} aria-label="Camera settings">
          <span className={`live-dot ${recording ? 'rec-dot' : ''}`} />
          {recording ? 'REC' : feed === 'demo' ? 'DEMO' : 'LIVE'}
          <span className="sep" />
          {cam.preview === '1080p' ? '1080P' : '720P'}
          <span className="sep" />
          <LiveFps fallback={cam.fps} />
          FPS
        </button>
        <div className="status">
          <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor" aria-hidden>
            <rect x="0" y="8" width="2.6" height="4" rx=".5" />
            <rect x="4.4" y="5.5" width="2.6" height="6.5" rx=".5" />
            <rect x="8.8" y="3" width="2.6" height="9" rx=".5" />
            <rect x="13.2" y="0" width="2.6" height="12" rx=".5" />
          </svg>
          {battery != null && (
            <span className="num" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <svg width="11" height="16" viewBox="0 0 11 16" fill="none" stroke="currentColor" aria-hidden>
                <rect x="1" y="2.5" width="9" height="13" rx="1.5" />
                <rect x="3.5" y="0.5" width="4" height="2" fill="currentColor" />
                <rect x="2.5" y={4 + 10 * (1 - battery)} width="6" height={10 * battery} fill="currentColor" stroke="none" />
              </svg>
              {Math.round(battery * 100)}%
            </span>
          )}
          <span className="num" style={{ fontSize: 16 }}>
            {fmtTime(new Date(now))}
          </span>
        </div>
      </div>
      <div className="topbar-row second">
        <AIStatus />
        <GeminiChip />
        <InstallChip />
        {anyMock && (
          <button className="mock-badge only-auto" style={{ marginLeft: 'auto' }} onClick={() => orch.openSheet('system')}>
            {feed === 'demo' ? 'DEMO · MOCK DATA' : 'MOCK DATA'}
          </button>
        )}
      </div>
      {quick && <QuickSettings />}
    </header>
  );
}

function QuickSettings() {
  const orch = useOrch();
  const cam = useFriday((s) => s.camera);
  const caps = useFriday((s) => s.caps);
  const set = (p: Parameters<typeof orch.setCamera>[0]) => void orch.setCamera(p);
  const Q = ({ on, onClick, children, disabled }: { on?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button className={`chip ${on ? 'active' : ''}`} onClick={onClick} disabled={disabled} style={disabled ? { opacity: 0.4 } : undefined}>
      {children}
    </button>
  );
  return (
    <div className="quick" role="toolbar" aria-label="Camera quick settings">
      <Q on={cam.torch} onClick={() => set({ torch: !cam.torch })} disabled={!caps?.torch}>
        <Icon.Bolt size={14} /> FLASH
      </Q>
      <Q on={cam.timerSec > 0} onClick={() => set({ timerSec: cam.timerSec === 0 ? 3 : cam.timerSec === 3 ? 10 : 0 })}>
        <Icon.Timer size={14} /> {cam.timerSec ? `${cam.timerSec}S` : 'TIMER'}
      </Q>
      <Q on={cam.night} onClick={() => set({ night: !cam.night })}>
        <Icon.Moon size={14} /> NIGHT
      </Q>
      <Q on={cam.stabilization} onClick={() => set({ stabilization: !cam.stabilization })}>
        <Icon.Stabilize size={14} /> STAB
      </Q>
      <Q on={cam.preview === '1080p'} onClick={() => set({ preview: cam.preview === '1080p' ? '720p' : '1080p' })}>
        PREVIEW {cam.preview === '1080p' ? '1080P' : '720P'}
      </Q>
      <Q on={cam.photo === 'max'} onClick={() => set({ photo: cam.photo === 'max' ? 'preview' : 'max' })}>
        PHOTO {cam.photo === 'max' ? (caps?.photoWidth ? `${Math.round((caps.photoWidth * (caps.photoHeight ?? caps.photoWidth * 0.75)) / 1e6)}MP` : 'MAX') : 'FAST'}
      </Q>
      <Q on={cam.fps === 60} onClick={() => set({ fps: cam.fps === 60 ? 30 : 60 })}>
        {cam.fps}FPS
      </Q>
      <Q on={cam.exposure !== 0} onClick={() => set({ exposure: cam.exposure >= 1 ? -1 : cam.exposure + 1 })}>
        EV {cam.exposure > 0 ? '+' : ''}
        {cam.exposure.toFixed(1)}
      </Q>
    </div>
  );
}

/** Appears only when Chrome reports the app is installable. */
function InstallChip() {
  const { prompt, installed, dismissed } = usePwa();
  if (!prompt || installed || dismissed) return null;
  return (
    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
      <button className="chip orange" style={{ height: 22, fontFamily: 'var(--f-display)', fontWeight: 700, letterSpacing: '0.12em', fontSize: 10.5 }} onClick={() => void promptInstall()}>
        ⤓ INSTALL APP
      </button>
      <button className="chip" style={{ height: 22, padding: '0 7px' }} onClick={() => usePwa.setState({ dismissed: true })} aria-label="閉じる">
        ×
      </button>
    </span>
  );
}

/** Measured preview fps, written straight to the DOM twice a second. */
function LiveFps({ fallback }: { fallback: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const id = setInterval(() => {
      const v = perf.camFps || perf.fps;
      if (ref.current && v) ref.current.textContent = String(Math.round(v));
    }, 500);
    return () => clearInterval(id);
  }, []);
  return <span ref={ref}>{fallback}</span>;
}
