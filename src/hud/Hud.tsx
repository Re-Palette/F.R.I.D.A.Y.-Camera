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
import { HomeStrip } from './panels/HomeStrip';
import { IntelSheet } from './sheets/IntelSheet';
import { MemorySheet } from './sheets/MemorySheet';
import { SearchSheet } from './sheets/SearchSheet';
import { SocialSheet } from './sheets/SocialSheet';
import { SystemSheet } from './sheets/SystemSheet';
import { PerfHud } from './PerfHud';
import { Toasts } from './Toasts';

function useMedia(q: string) {
  const [match, setMatch] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setMatch(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return match;
}

function useWide() {
  return useMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)');
}

/**
 * Phone HOME: a touch phone (never a mouse-driven PC, whatever its window
 * size) in the default AUTO density — one screen, essentials only, nothing
 * that scrolls. FULL density still shows every panel.
 */
function useHome(wide: boolean) {
  const touch = useMedia('(pointer: coarse)');
  const density = useFriday((s) => s.density);
  const home = !wide && touch && density !== 'full';
  useEffect(() => useFriday.setState({ home }), [home]);
  return home;
}

/**
 * Visibility policy for every panel — the heart of the dynamic HUD.
 *  minimal: camera + reticle + target brackets + conversation only
 *  auto:    the target is described by the thin card next to it (DetectionLayer);
 *           panels appear only when asked, then fade
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
    // The big object card is never permanent: FULL only (AUTO uses the near-object card).
    object: full && hasFocus && (scan || mode === 'photo'),
    info: full && hasFocus && scan,
    env: weatherPinned || (full && scan),
    forecast: weatherPinned || (full && scan),
    radar: !min || mode === 'nav',
    recallAlways: full,
    nav: mode === 'nav',
  };
}

export function Hud() {
  const wide = useWide();
  const home = useHome(wide);
  const p = usePolicy();
  const density = useFriday((s) => s.density);
  const booted = useFriday((s) => s.booted);

  return (
    <div className="app" data-density={density} data-home={home ? '' : undefined}>
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
          {wide ? <WideLayout p={p} /> : home ? <HomeLayout p={p} /> : <PortraitLayout p={p} />}
          <CaptureBar />
        </>
      )}
      <Toasts />
      <PerfHud />
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

/**
 * Phone HOME: top bar → one-line place · weather · time → the camera with the
 * target card → voice bar + capture controls. Panels the user asks for
 * (weather, navigation, translation) still appear in place, one at a time.
 */
function HomeLayout({ p }: { p: Policy }) {
  const weatherAsked = p.env;
  return (
    <>
      <div className="slot slot-tl home-tl">
        <HomeStrip />
        <TranslateBar />
        <EnvPanel show={weatherAsked} />
      </div>
      {p.nav && (
        <div className="slot slot-tr">
          <Radar />
        </div>
      )}
      <div className="slot home-bottom">
        {weatherAsked ? <ForecastPanel show /> : p.nav ? <NavPanel /> : null}
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
