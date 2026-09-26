import { useEffect, useState } from 'react';
import { useFriday } from '../store/useFriday';
import { Boot } from './Boot';
import { CaptureBar } from './controls/CaptureBar';
import { VoiceConsole } from './controls/VoiceConsole';
import { useUntil } from './hooks';
import { DetectionLayer } from './layers/DetectionLayer';
import { FeedLayer } from './layers/FeedLayer';
import { Frame } from './layers/Frame';
import { HazardLayer } from './layers/HazardLayer';
import { NavLayer } from './layers/NavLayer';
import { Reticle } from './layers/Reticle';
import { TranslateLayer } from './layers/TranslateLayer';
import { InfoPanel } from './panels/InfoPanel';
import { NavPanel } from './panels/NavPanel';
import { ObjectPanel } from './panels/ObjectPanel';
import { Radar } from './panels/Radar';
import { RecallPanel, useRecallFresh } from './panels/RecallPanel';
import { ScenePanel } from './panels/ScenePanel';
import { TopBar } from './panels/TopBar';
import { TranslateBar } from './panels/TranslateBar';
import { EnvPanel, ForecastPanel, WeatherChip } from './panels/Weather';
import { IntelSheet } from './sheets/IntelSheet';
import { MemorySheet } from './sheets/MemorySheet';
import { SearchSheet } from './sheets/SearchSheet';
import { SocialSheet } from './sheets/SocialSheet';
import { SystemSheet } from './sheets/SystemSheet';
import { Toasts } from './Toasts';

function useWide() {
  const q = '(min-width: 900px) and (min-aspect-ratio: 1/1)';
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * Visibility policy for every panel — the heart of the dynamic HUD.
 *  minimal: camera + reticle + target brackets + conversation only
 *  auto:    panels appear when something is identified / asked, then fade
 *  full:    everything (tablet / demo / AR-glasses preview)
 */
function usePolicy() {
  const density = useFriday((s) => s.density);
  const mode = useFriday((s) => s.mode);
  const hasFocus = useFriday((s) => !!s.focus && !!(s.lockedId ?? s.primaryId));
  const weatherPinned = useUntil(useFriday((s) => s.pinned.weather));
  const full = density === 'full';
  const min = density === 'minimal';
  const scan = mode === 'scan';
  return {
    scene: !min && (scan || full) && mode !== 'translate' && mode !== 'nav',
    object: !min && hasFocus && (scan || full || mode === 'photo'),
    info: !min && hasFocus && scan,
    env: weatherPinned || (full && scan),
    forecast: weatherPinned || (full && scan),
    radar: !min || mode === 'nav',
    recallAlways: full,
    nav: mode === 'nav',
  };
}

export function Hud() {
  const wide = useWide();
  const p = usePolicy();
  const density = useFriday((s) => s.density);
  const booted = useFriday((s) => s.booted);

  return (
    <div className="app" data-density={density}>
      <FeedLayer />
      <div className="scan-sweep" />
      <Reticle />
      <DetectionLayer />
      <TranslateLayer />
      <NavLayer />
      <HazardLayer />
      <Frame />
      {booted && (
        <>
          <TopBar />
          {wide ? <WideLayout p={p} /> : <PortraitLayout p={p} />}
          <CaptureBar />
        </>
      )}
      <Toasts />
      <SearchSheet />
      <MemorySheet />
      <IntelSheet />
      <SocialSheet />
      <SystemSheet />
      <Boot />
    </div>
  );
}

type Policy = ReturnType<typeof usePolicy>;

/**
 * Phones get a stricter budget: one top-left panel, one bottom panel.
 * Transient panels (memory recall, weather) temporarily take a slot instead
 * of stacking; real-time news collapses into a ticker on the object card.
 */
function PortraitLayout({ p }: { p: Policy }) {
  const recallFresh = useRecallFresh();
  const hasFocus = useFriday((s) => !!s.focus);
  const weatherTransient = p.env && useFriday.getState().density !== 'full';
  const scanLike = useFriday((s) => s.mode === 'scan' || s.mode === 'photo');
  const topLeft = weatherTransient ? 'env' : scanLike && (recallFresh || p.recallAlways) ? 'recall' : 'scene';
  return (
    <>
      <div className="slot slot-tl">
        <ScenePanel show={p.scene && topLeft === 'scene'} compact={hasFocus} />
        <TranslateBar />
        {topLeft === 'recall' && <RecallPanel always={p.recallAlways} />}
        <EnvPanel show={topLeft === 'env' || (p.env && !weatherTransient)} />
      </div>
      <div className="slot slot-tr">
        {p.radar && <Radar />}
        <WeatherChip />
      </div>
      <div
        className="slot"
        style={{ left: 'calc(var(--safe-l) + var(--gutter))', right: 'calc(var(--safe-r) + var(--gutter))', bottom: 'calc(var(--safe-b) + 150px)', alignItems: 'stretch' }}
      >
        {weatherTransient ? (
          <ForecastPanel show />
        ) : p.nav ? (
          <NavPanel />
        ) : (
          <ObjectPanel show={p.object} compact ticker={p.info} />
        )}
        <VoiceConsole />
      </div>
    </>
  );
}

function WideLayout({ p }: { p: Policy }) {
  return (
    <>
      <div className="slot slot-tl">
        <ScenePanel show={p.scene} />
        <TranslateBar />
        {p.nav ? <NavPanel /> : <ObjectPanel show={p.object} />}
        <EnvPanel show={p.env} />
      </div>
      <div className="slot slot-tr">
        <div className="radar-wrap">
          <WeatherChip />
          {p.radar && <Radar />}
        </div>
        <InfoPanel show={p.info} />
      </div>
      <div className="slot slot-bl">
        <RecallPanel always={p.recallAlways} />
      </div>
      <div className="slot slot-bc">
        <VoiceConsole />
      </div>
      <div className="slot slot-br">
        <ForecastPanel show={p.forecast} />
      </div>
    </>
  );
}
