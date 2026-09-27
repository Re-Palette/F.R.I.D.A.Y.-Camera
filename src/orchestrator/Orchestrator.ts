/**
 * AI Orchestration layer.
 *
 *   Camera ─▶ Vision ─▶ Orchestrator ─▶ Search / Places / Memory / Voice / LLM … ─▶ store ─▶ HUD
 *
 * The orchestrator owns every loop (detection, scene, OCR, world data), turns
 * perception into *focus* with hysteresis so HUD panels appear only when
 * needed, routes utterances to tools, grounds the LLM with tool results, and
 * manages barge-in. The HUD never calls services directly.
 */
import { CameraController } from '../camera/CameraController';
import { FrameSampler } from '../camera/FrameSampler';
import { frameReady, toJpegDataUrl } from '../camera/frame';
import { live, startMotion } from '../core/live';
import { perf } from '../perf/metrics';
import { trackRenderer } from '../hud/tracking/trackRenderer';
import { saveOverrides, type ServiceMode, type ServiceName } from '../core/config';
import type {
  CameraSettings,
  CaptureMode,
  ChatAttachment,
  ChatMessage,
  Detection,
  EntityProfile,
  GeoFix,
  HudDensity,
  LocationEstimate,
  PlaceInfo,
  Intent,
  MemoryItem,
  SocialPlatform,
} from '../core/types';
import { boxCenter, boxContains, clamp, fmtDateJa, iou, sleep, timeOfDayFor, uid, viewToFrame } from '../core/util';
import type { DemoScene, Grounding, ServiceRegistry, VisionContext, VisionFrame, VisionService, WorldContext } from '../services/contracts';
import { toNavTarget } from '../services/places';
import { createServices, createVision } from '../services/registry';
import { getState, setState, type SheetKind, type Toast } from '../store/useFriday';
import { evaluateHazards } from './hazards';
import { IdentificationManager } from './identification';
import { LiveVisionService } from '../services/vision/WorkerVisionService';
import { BrowserLocationService, MockLocationService } from '../services/location';
import { metersBetween, reverseGeocode } from '../services/location/reverse';
import { MockWeatherService, OpenMeteoWeatherService } from '../services/weather';
import type { LiveAgent } from '../services/live/agent';
import { attachText, countObjects, detectLang, estimateLocation, geoAnchors, shownName } from '../services/vision/perception';
import { classifyIntent } from './intents';

const PRIMARY_ACQUIRE_MS = 450;
const PRIMARY_RELEASE_MS = 1300;
const LOCK_LOST_MS = 700;
const LOCK_DROP_MS = 4000;
const SCENE_INTERVAL_MS = 9000;
const WEATHER_TTL_MS = 10 * 60 * 1000;

const TOD_TAG = { dawn: '夜明け', morning: '朝', day: '昼', dusk: '夕焼け', night: '夜' } as const;

/** Questions Gemini Live answers itself (it sees the camera); app commands stay local. */
const LIVE_INTENTS = new Set<Intent['kind']>(['identify', 'place_info', 'product_info', 'chat', 'scene', 'search']);

export class Orchestrator {
  services: ServiceRegistry;
  readonly camera = new CameraController();
  private vision: VisionService;
  private running = false;
  private unsubs: (() => void)[] = [];
  private liveUnsubs: (() => void)[] = [];
  private lastReverse: { lat: number; lon: number; at: number } | null = null;
  private abort: AbortController | null = null;
  private candidate: { id: string; since: number } | null = null;
  private lastSeen = new Map<string, number>();
  private lockLastBox: Detection['bbox'] | null = null;
  private profileCache = new Map<string, Promise<EntityProfile | null>>();
  private recalled = new Set<string>();
  private lastSceneAt = 0;
  private lastWeatherAt = 0;
  private lastPoiGeo: { lat: number; lon: number } | null = null;
  private lastOcrText = '';
  private lastSpoken = '';
  private hazardWarned = new Set<string>();
  private timers: ReturnType<typeof setTimeout>[] = [];
  private lastHeadingPush = 0;
  /** Pipeline 2: samples camera frames for AI, latest-frame-wins, never blocks the preview. */
  private readonly sampler: FrameSampler;
  /** Tier-2 identification (cached per track, prioritised, budgeted). */
  private readonly identifier: IdentificationManager;
  private nearbyPlaces: PlaceInfo[] = [];
  private sceneRegions: { dets: Detection[]; at: number } | null = null;
  private textDets: Detection[] = [];
  private textAt = 0;
  private textById = new Map<string, string>();
  private focusKey = '';
  private lastSummaryAt = 0;

  constructor() {
    this.services = createServices(getState().serviceModes);
    this.vision = this.services.vision;
    if (this.vision instanceof LiveVisionService) this.wireLive(this.vision);
    this.sampler = new FrameSampler(
      () => ({ source: this.camera.frame, needsPixels: this.vision.needsPixels, inputSize: this.vision.inputSize }),
      (frame) => this.runVision(frame),
    );
    this.camera.onFeedElementChange = () => this.sampler.rebind();
    this.identifier = new IdentificationManager({
      vision: () => this.vision,
      crop: (d) => this.cropTarget(d),
      ctx: () => this.visionCtx(),
      scene: () => getState().scene,
      nearby: () => this.nearbyPlaces,
    });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────

  async boot() {
    setState({ bootPhase: 1 });
    this.wire();
    const forced = new URLSearchParams(location.search).get('demo') as DemoScene | null;
    const bootAnim = sleep(1900);
    const tasks: Promise<unknown>[] = [
      this.services.memory.init().then(() => this.refreshMemory()),
      this.services.location.start(),
      startMotion().then((ok) => (perf.motionComp = ok)),
    ];
    if (forced || !CameraController.supported) {
      this.useDemo(forced ?? getState().demoScene);
    } else {
      tasks.push(
        this.camera.startCamera(getState().camera).then(
          () => this.onFeedChanged('camera'),
          (err: Error) => {
            setState({ cameraError: err.name === 'NotAllowedError' ? 'カメラへのアクセスが拒否されました' : 'カメラを起動できません' });
            this.toast('CAMERA UNAVAILABLE — DEMO FEED', 'warn');
            this.useDemo(getState().demoScene);
          },
        ),
      );
    }
    setState({ bootPhase: 2 });
    await Promise.allSettled(tasks);
    setState({ bootPhase: 3 });
    await bootAnim;
    setState({ booted: true, bootPhase: 4 });
    // PWA shortcuts (manifest `shortcuts`): ?mode=translate / ?sheet=memory
    const q = new URLSearchParams(location.search);
    const mode = q.get('mode') as CaptureMode | null;
    if (mode && ['scan', 'photo', 'video', 'translate', 'nav'].includes(mode)) this.setMode(mode);
    const sheet = q.get('sheet');
    if (sheet === 'memory' || sheet === 'system') this.openSheet(sheet);
    this.running = true;
    this.sampler.start();
    void this.worldLoop();
  }

  dispose() {
    this.running = false;
    this.sampler.stop();
    this.unsubs.forEach((u) => u());
    this.timers.forEach(clearTimeout);
    this.services.location.stop();
    this.services.voice.stopListening();
    this.vision.dispose();
    this.camera.dispose();
  }

  private wire() {
    this.unsubs.forEach((u) => u());
    const { location: loc, voice } = this.services;
    this.unsubs = [
      loc.events.on('fix', (geo) => {
        const prev = getState().geo;
        setState({ geo: { ...geo, placeName: geo.placeName ?? prev?.placeName, area: geo.area ?? prev?.area } });
        if (!prev) void this.onFirstFix();
        else if (this.services.location.mode === 'real') void this.maybeReverse(geo);
      }),
      loc.events.on('heading', (heading) => {
        // 60 Hz sensor → `live` for the frame loop; the store only gets ~8 Hz for text readouts.
        live.heading = heading;
        const now = performance.now();
        if (now - this.lastHeadingPush > 125) {
          this.lastHeadingPush = now;
          setState({ heading });
        }
      }),
      voice.events.on('listening', (listening) => setState({ listening, partial: listening ? getState().partial : '' })),
      voice.events.on('speaking', (speaking) => setState({ speaking })),
      voice.events.on('partial', (partial) => {
        setState({ partial });
        if (getState().speaking && this.isBargeIn(partial)) this.interrupt();
      }),
      voice.events.on('final', (text) => {
        setState({ partial: '' });
        if (text) void this.ask(text);
      }),
      voice.events.on('error', (e) => {
        if (e === 'not-allowed') this.toast('マイクへのアクセスが拒否されました', 'warn');
      }),
    ];
  }

  /** Swap a service implementation at runtime (SYSTEM sheet). */
  async setServiceMode(name: ServiceName, mode: ServiceMode) {
    const modes = { ...getState().serviceModes, [name]: mode };
    saveOverrides(modes);
    this.services.location.stop();
    this.services.voice.stopListening();
    this.services = createServices(modes);
    setState({ serviceModes: modes, listening: false });
    this.profileCache.clear();
    this.wire();
    await this.services.memory.init();
    await this.refreshMemory();
    await this.services.location.start();
    this.lastWeatherAt = 0;
    this.lastPoiGeo = null;
    // Re-selecting VISION rebuilds it (e.g. new gateway settings → fresh Live session).
    this.swapVision(name === 'vision');
    this.toast(`${name.toUpperCase()} → ${mode.toUpperCase()}`);
  }

  // ─── Feed / camera ─────────────────────────────────────────────────────

  private useDemo(scene: DemoScene) {
    setState({ demoScene: scene });
    const { viewSize } = getState();
    this.camera.resize(viewSize.w || innerWidth, viewSize.h || innerHeight);
    this.camera.startDemo(scene);
    this.onFeedChanged('demo');
  }

  private onFeedChanged(feed: 'camera' | 'demo') {
    setState({ feed, caps: this.camera.caps, frameSize: this.camera.frameSize });
    this.syncGeoServices(feed);
    this.swapVision();
    this.resetPerception();
  }

  /**
   * A live camera is somewhere real: the scripted Odaiba position (and the
   * weather / places made up for it) would be wrong. With the camera, a `mock`
   * location upgrades to the device's GPS + compass and `mock` weather to
   * Open-Meteo (both free, no key); the demo feed keeps its scripted world.
   */
  private syncGeoServices(feed: 'camera' | 'demo') {
    const configured = getState().serviceModes;
    const wantLoc = feed === 'camera' ? 'real' : configured.location;
    const wantWeather = feed === 'camera' ? 'real' : configured.weather;
    let changed = false;
    if (this.services.location.mode !== wantLoc) {
      this.services.location.stop();
      this.services.location = wantLoc === 'real' ? new BrowserLocationService() : new MockLocationService();
      changed = true;
    }
    if (this.services.weather.mode !== wantWeather) {
      this.services.weather = wantWeather === 'real' ? new OpenMeteoWeatherService() : new MockWeatherService();
      changed = true;
    }
    if (!changed) return;
    // Forget the old world: the next fix re-runs place lookup, weather and nearby places.
    setState({ geo: null, weather: null, location: null, pois: [] });
    this.nearbyPlaces = [];
    this.lastWeatherAt = 0;
    this.lastPoiGeo = null;
    this.lastReverse = null;
    this.wire();
    void this.services.location.start();
  }

  /**
   * The demo feed is synthetic, so it is always "seen" by the mock detector.
   * A real camera can't be understood by the mock, so a `mock` vision setting
   * upgrades to on-device detection there.
   */
  private swapVision(force = false) {
    const configured = getState().serviceModes.vision;
    const feed = this.camera.source;
    const wanted = feed === 'demo' ? 'mock' : configured === 'mock' ? 'ondevice' : configured;
    if (this.vision.mode === wanted && !force) return;
    this.liveUnsubs.forEach((u) => u());
    this.liveUnsubs = [];
    this.vision.dispose();
    this.vision = createVision(wanted, { search: () => this.services.search });
    if (this.vision instanceof LiveVisionService) this.wireLive(this.vision);
    else setState({ live: null });
    this.vision.init().catch(() => {
      this.toast('VISION MODEL LOAD FAILED', 'warn');
    });
  }

  private get liveAgent(): LiveAgent | null {
    return this.vision instanceof LiveVisionService ? this.vision.agent : null;
  }

  /** Gemini Live: camera frames out; transcripts, speech state and app actions in. */
  private wireLive(v: LiveVisionService) {
    v.setFrameSource(() => {
      const { w, h } = this.camera.frameSize;
      return w && h && frameReady(this.camera.frame) ? { frame: this.camera.frame, w, h } : null;
    });
    const a = v.agent;
    const liveState = (patch: Partial<NonNullable<ReturnType<typeof getState>['live']>>) =>
      setState({ live: { status: a.status, mic: a.micOn, ...getState().live, ...patch } });
    liveState({ status: a.status, detail: undefined, mic: false });
    this.liveUnsubs = [
      a.events.on('status', ({ status, detail }) => {
        liveState({ status, detail });
        if (status === 'open') this.toast('GEMINI LIVE CONNECTED');
        if (status === 'error') this.toast(`GEMINI LIVE: ${detail ?? '接続できません'}`, 'warn', 5000);
      }),
      a.events.on('mic', (mic) => {
        liveState({ mic });
        setState({ listening: mic, partial: mic ? getState().partial : '' });
      }),
      a.events.on('userPartial', (partial) => setState({ partial })),
      a.events.on('userFinal', (text) => {
        setState({ partial: '' });
        if (text) this.push({ role: 'user', text, intent: 'chat' });
        setState({ busy: 'thinking' });
      }),
      a.events.on('assistantPartial', (draft) => setState({ draft, busy: null })),
      a.events.on('assistantFinal', (text) => {
        this.push({ role: 'assistant', text, intent: 'chat' });
        this.lastSpoken = text;
        setState({ draft: '', busy: null });
      }),
      a.events.on('speaking', (speaking) => setState({ speaking })),
      a.events.on('action', ({ action }) => void this.liveAction(action)),
    ];
  }

  /** app_action from Gemini Live → the same camera controls the UI uses. */
  private async liveAction(action: string) {
    switch (action) {
      case 'take_photo':
        return void this.capturePhoto(0).catch(() => undefined);
      case 'start_recording':
        return void this.startRecording();
      case 'stop_recording':
        return void this.stopRecording();
      case 'lock_target':
        return void this.lock();
      case 'unlock_target':
        return this.unlock();
      case 'open_official_site':
        return void this.execute({ kind: 'open_url', text: '公式サイト', referential: true }, new AbortController().signal);
      case 'mode_translate':
        return this.setMode('translate');
      case 'mode_navigation':
        return this.setMode('nav');
      case 'mode_scan':
        return this.setMode('scan');
    }
  }

  /** What the HUD is pointing at, for questions routed to Gemini Live ("これは何？"). */
  private liveHudContext(): string {
    const s = getState();
    const d = s.detections.find((x) => x.id === (s.lockedId ?? s.primaryId));
    const here = this.services.location.mode === 'real' && s.geo ? [s.geo.area, s.geo.placeName].filter(Boolean).join(' ') : '';
    const where = here ? ` 現在地（GPS）: ${here}。` : '';
    if (!d || !(this.vision instanceof LiveVisionService)) return where ? `[HUD 補足]${where}` : '';
    const idt = d.identity;
    const name = d.category === 'person' ? '人物' : idt && (idt.status === 'identified' || idt.status === 'possible') ? `${idt.name}（${Math.round(idt.confidence * 100)}%${idt.note ? `・${idt.note}` : ''}）` : d.displayName;
    return `[HUD 補足] ユーザーが指している対象: ${this.vision.targetId(d.id)} = ${name}。${where}`;
  }

  get visionMode() {
    return this.vision.mode;
  }

  async setFeed(feed: 'camera' | 'demo') {
    if (feed === 'demo') return this.useDemo(getState().demoScene);
    try {
      await this.camera.startCamera(getState().camera);
      setState({ cameraError: null });
      this.onFeedChanged('camera');
    } catch {
      this.toast('カメラを起動できません', 'warn');
    }
  }

  setDemoScene(scene: DemoScene) {
    setState({ demoScene: scene });
    if (this.camera.source === 'demo') {
      this.camera.setDemoScene(scene);
      this.resetPerception();
    }
  }

  onViewResize(w: number, h: number) {
    setState({ viewSize: { w, h } });
    this.camera.resize(w, h);
    setState({ frameSize: this.camera.frameSize });
  }

  async setCamera(patch: Partial<CameraSettings>) {
    const camera = { ...getState().camera, ...patch };
    setState({ camera });
    const needsRestart = this.camera.source === 'camera' && (patch.facing || patch.preview || patch.fps);
    if (needsRestart) {
      try {
        await this.camera.startCamera(camera);
        setState({ caps: this.camera.caps, frameSize: this.camera.frameSize });
        this.resetPerception();
      } catch {
        this.toast('カメラ設定を適用できません', 'warn');
      }
    }
    const css = await this.camera.apply(camera);
    setState({ feedCss: { zoom: css.cssZoom, exposure: css.cssExposure } });
  }

  switchCamera() {
    if (this.camera.source === 'demo') return this.toast('DEMO FEED — 実カメラで利用できます');
    void this.setCamera({ facing: getState().camera.facing === 'user' ? 'environment' : 'user' });
  }

  setMode(mode: CaptureMode) {
    const prev = getState().mode;
    if (prev === mode) return;
    setState({ mode, translations: mode === 'translate' ? getState().translations : [], ocr: mode === 'translate' ? getState().ocr : null });
    if (mode === 'translate') {
      this.lastOcrText = '';
      void this.runTranslate();
    }
    if (mode === 'nav') void this.refreshPois(true);
    if (prev === 'nav') setState({ navTarget: null });
  }

  setDensity(density: HudDensity) {
    setState({ density });
    try {
      localStorage.setItem('friday.density', density);
    } catch {
      /* ignore */
    }
  }

  openSheet(sheet: SheetKind) {
    setState({ sheet });
    if (sheet === 'memory') void this.refreshMemory();
  }

  // ─── Perception loops ──────────────────────────────────────────────────

  private visionCtx(): VisionContext {
    const s = getState();
    const demo = this.camera.source === 'demo';
    return {
      geo: s.geo ?? undefined,
      heading: s.heading,
      demoScene: demo ? s.demoScene : undefined,
      demoClock: demo ? { time: this.camera.demo.time, sceneTime: this.camera.demo.sceneTime } : undefined,
      now: new Date(),
    };
  }

  worldContext(): WorldContext {
    const s = getState();
    return { focus: s.focus, detections: s.detections, scene: s.scene, geo: s.geo, weather: s.weather, location: s.location, now: new Date() };
  }

  /** Pipeline 2 body: runs for one sampled frame; only lightweight results reach the HUD. */
  private async runVision(frame: VisionFrame) {
    const sheet = getState().sheet;
    if (sheet && sheet !== 'intel') {
      frame.bitmap?.close();
      return;
    }
    const t0 = performance.now();
    const dets = await this.vision.detect(frame, this.visionCtx());
    perf.aiInferMs = this.vision.lastInferMs || performance.now() - t0;
    const v = this.vision as VisionService & { failed?: string | null; delegate?: string };
    perf.aiEngine = v.failed ? `${v.mode} ✕ ${v.failed.slice(0, 40)}` : `${v.mode}${v.delegate ? ` · ${v.delegate}` : ''}`;
    const s = getState();
    const merged = this.identifier.process(this.augment(dets), performance.now(), s.lockedId, s.primaryId);
    trackRenderer.observe(merged, frame.capturedAt);
    this.processDetections(merged);
  }

  /**
   * Adds what the fast detector can't see: cloud scene regions (buildings,
   * signs), free-standing OCR text, and GPS/compass building estimates.
   * Everything stays lightweight metadata — no pixels.
   */
  private augment(dets: Detection[]): Detection[] {
    const s = getState();
    const now = performance.now();
    const out = dets.map((d) => (this.textById.has(d.id) ? { ...d, text: this.textById.get(d.id) } : d));
    if (this.sceneRegions && now - this.sceneRegions.at < 10000) {
      out.push(...this.sceneRegions.dets.filter((r) => !out.some((d) => iou(d.bbox, r.bbox) > 0.5)));
    }
    if (now - this.textAt < 6000) out.push(...this.textDets);
    // Projected buildings need a *real* position: never overlay the demo GPS on a live camera.
    if (this.camera.source === 'camera' && this.vision.mode !== 'mock' && this.services.location.mode === 'real' && s.mode === 'scan') {
      const anchors = geoAnchors(s.pois, s.geo, live.heading || s.heading, { hfov: 55, now });
      out.push(...anchors.filter((g) => !out.some((d) => (d.identity?.entityId ?? d.entityId) === g.entityId)));
    }
    return out;
  }

  /** GPU crop of one target for identification (≤ 512 px). Only on demand. */
  private async cropTarget(d: Detection): Promise<ImageBitmap | null> {
    const { w, h } = this.camera.frameSize;
    if (!w || !h) return null;
    const pad = 0.1;
    const sx = clamp((d.bbox.x - d.bbox.w * pad) * w, 0, w - 2);
    const sy = clamp((d.bbox.y - d.bbox.h * pad) * h, 0, h - 2);
    const sw = clamp(d.bbox.w * (1 + 2 * pad) * w, 2, w - sx);
    const sh = clamp(d.bbox.h * (1 + 2 * pad) * h, 2, h - sy);
    const k = Math.min(1, 512 / Math.max(sw, sh));
    return createImageBitmap(this.camera.frame, sx, sy, sw, sh, { resizeWidth: Math.round(sw * k), resizeHeight: Math.round(sh * k), resizeQuality: 'medium' }).catch(() => null);
  }

  private computeLocation(dets: Detection[]): LocationEstimate | null {
    const s = getState();
    const lm = dets
      .filter((d) => (d.identity?.kind === 'landmark' || d.identity?.kind === 'building') && (d.identity.status === 'identified' || d.identity.status === 'possible'))
      .sort((a, b) => (b.identity!.confidence ?? 0) - (a.identity!.confidence ?? 0))[0];
    const sign = dets.find((d) => d.text)?.text ?? this.textDets[0]?.text ?? null;
    return estimateLocation({
      geo: s.geo,
      landmark: lm ? { name: lm.identity!.name, confidence: lm.identity!.confidence, source: lm.identity!.source, area: s.scene?.location } : null,
      signText: sign,
      sceneLocation: s.scene?.location,
    });
  }

  private processDetections(dets: Detection[]) {
    const now = Date.now();
    const s = getState();
    dets.forEach((d) => this.lastSeen.set(d.id, now));

    // Target lock tracking, with re-acquisition for trackers that re-issue ids.
    let { lockedId, lockState } = s;
    if (lockedId) {
      const hit = dets.find((d) => d.id === lockedId);
      if (hit) {
        this.lockLastBox = hit.bbox;
        lockState = 'locked';
      } else {
        const last = this.lockLastBox;
        const re = last && dets.find((d) => iou(d.bbox, last) > 0.2);
        if (re) {
          lockedId = re.id;
          lockState = 'locked';
        } else {
          const missing = now - (this.lastSeen.get(lockedId) ?? now);
          if (missing > LOCK_DROP_MS) {
            lockedId = null;
            lockState = 'none';
            this.toast('TARGET LOST');
          } else if (missing > LOCK_LOST_MS) lockState = 'lost';
        }
      }
    }

    // Primary target: the most salient stable detection (centre-weighted).
    let primaryId = s.primaryId;
    if (lockedId) primaryId = lockedId;
    else {
      const best = dets
        .filter((d) => d.confidence > 0.5)
        .map((d) => {
          const c = boxCenter(d.bbox);
          const centre = 1 - Math.min(1, Math.hypot(c.x - 0.5, c.y - 0.5) * 1.6);
          const area = Math.min(1, Math.sqrt(d.bbox.w * d.bbox.h) * 2);
          return { d, score: d.confidence * (0.45 + 0.35 * centre + 0.2 * area) };
        })
        .sort((a, b) => b.score - a.score)[0]?.d;
      if (best && best.id !== primaryId) {
        if (this.candidate?.id !== best.id) this.candidate = { id: best.id, since: now };
        const currentVisible = primaryId && dets.some((d) => d.id === primaryId);
        if (now - this.candidate.since > (currentVisible ? PRIMARY_ACQUIRE_MS * 4 : PRIMARY_ACQUIRE_MS)) primaryId = best.id;
      } else if (best) this.candidate = null;
      if (primaryId && !dets.some((d) => d.id === primaryId) && now - (this.lastSeen.get(primaryId) ?? 0) > PRIMARY_RELEASE_MS) {
        primaryId = best?.id && now - (this.candidate?.since ?? now) > PRIMARY_ACQUIRE_MS ? best.id : null;
      }
    }

    const hazards = evaluateHazards(dets);
    for (const h of hazards) {
      if (h.severity === 'critical' && !this.hazardWarned.has(h.id)) {
        this.hazardWarned.add(h.id);
        this.later(() => this.hazardWarned.delete(h.id), 8000);
        if (typeof navigator !== 'undefined') navigator.vibrate?.([80, 60, 80]);
      }
    }

    setState({ detections: dets, lockedId, lockState, primaryId, hazards });
    // Refocus when the primary target changes *or* its identification progresses
    // (TARGET DETECTED → IDENTIFYING → IDENTIFIED re-reads the profile).
    const p = primaryId ? dets.find((d) => d.id === primaryId) : undefined;
    const key = p ? `${p.id}|${p.identity?.status ?? ''}|${p.identity?.name ?? ''}` : primaryId ?? '';
    if (key !== this.focusKey) {
      this.focusKey = key;
      // Gemini Live hears the mic directly, so tell it (silently) what "これ" refers to now.
      const live = this.liveAgent;
      if (live?.status === 'open' && p?.identity && p.identity.status !== 'identifying') live.setContext(this.liveHudContext());
      if (p) void this.loadFocus(p);
      else if (!primaryId) setState({ focus: null, related: [], news: [], recall: null });
    } else if (p?.identity && s.focus?.identity && s.focus.id === p.id) {
      // Same answer, refined evidence (web verification, confidence): patch it in place.
      const a = s.focus.identity;
      const b = p.identity;
      if (a.confidence !== b.confidence || a.verification?.status !== b.verification?.status || a.note !== b.note) {
        setState({ focus: { ...s.focus, identity: b } });
      }
    }
    if (now - this.lastSummaryAt > 1000) {
      this.lastSummaryAt = now;
      setState({ objectCounts: countObjects(dets.filter((d) => d.source !== 'ocr' && d.source !== 'geo')), location: this.computeLocation(dets) });
    }
  }

  /**
   * Profile for the focus card / Intel sheet / voice answers, keyed by the
   * identification state so it upgrades as recognition progresses. Specific
   * knowledge is only fetched once something is identified or possible.
   */
  private profileFor(det: Detection): Promise<EntityProfile | null> {
    const id = det.identity;
    const status = id?.status ?? 'detected';
    const key = `${id?.entityId ?? det.entityId ?? det.id}:${status}:${id?.name ?? ''}`;
    let p = this.profileCache.get(key);
    if (!p) {
      p = (async () => {
        const specific = !!id && (status === 'identified' || status === 'possible') && det.category !== 'person';
        const base = specific
          ? await this.services.knowledge.profile({ ...det, entityId: id!.entityId ?? det.entityId, displayName: id!.name || det.displayName }, this.visionCtx()).catch(() => null)
          : null;
        return profileWithIdentity(base, det);
      })();
      this.profileCache.set(key, p);
    }
    // The cache is keyed by the answer; evidence (web check, confidence) keeps refining it.
    const live = det.identity;
    return live && det.category !== 'person' ? p.then((x) => (x ? { ...x, identity: live } : x)) : p;
  }

  private async loadFocus(det: Detection) {
    const profile = await this.profileFor(det);
    if (getState().primaryId !== det.id && getState().lockedId !== det.id) return;
    setState({ focus: profile, related: [], news: [] });
    if (!profile) return;
    const [related, news] = await Promise.all([
      this.services.knowledge.related(profile).catch(() => []),
      this.services.news.forContext({ keywords: profile.keywords, geo: getState().geo }).catch(() => []),
    ]);
    if (getState().focus?.id !== profile.id) return;
    setState({ related, news });
    if (!this.recalled.has(profile.id)) {
      this.recalled.add(profile.id);
      const recall = await this.services.memory.recall(this.worldContext()).catch(() => null);
      if (recall && getState().focus?.id === profile.id) setState({ recall, recallAt: Date.now() });
    }
  }

  private async analyzeScene() {
    this.lastSceneAt = Date.now();
    setState({ analyzingUntil: Date.now() + 1500 });
    try {
      const scene = await this.vision.analyzeScene(this.camera.frame, getState().detections.filter((d) => d.source !== 'geo'), this.visionCtx());
      setState({ scene });
      const at = performance.now();
      this.sceneRegions = scene.regions?.length ? { at, dets: scene.regions.map((r, i) => ({ ...r, id: r.id || `region:${i}:${r.label}`, timestamp: at, source: 'cloud' as const })) } : null;
    } catch {
      /* keep previous scene */
    }
  }

  private resetPerception() {
    this.candidate = null;
    this.lastSeen.clear();
    this.lastSceneAt = Date.now() - SCENE_INTERVAL_MS + 1600;
    this.lastOcrText = '';
    trackRenderer.reset();
    this.identifier.reset();
    this.sceneRegions = null;
    this.textDets = [];
    this.textById.clear();
    this.focusKey = '';
    setState({ location: null, objectCounts: [] });
    setState({ detections: [], primaryId: null, lockedId: null, lockState: 'none', focus: null, related: [], news: [], hazards: [], ocr: null, translations: [], recall: null, scene: null });
    if (getState().mode === 'translate') this.later(() => void this.runTranslate(), 1200);
  }

  private async worldLoop() {
    let tick = 0;
    while (this.running) {
      const s = getState();
      if (s.geo && Date.now() - this.lastWeatherAt > WEATHER_TTL_MS) void this.refreshWeather();
      // Scene understanding is the slow path — every few seconds, never per frame.
      if ((!s.sheet || s.sheet === 'intel') && Date.now() - this.lastSceneAt > SCENE_INTERVAL_MS) void this.analyzeScene();
      // 500 ms ticks: OCR every 3 s in TRANSLATE, POIs every 1 s in NAV (else every 20 s).
      if (s.mode === 'translate' && tick % 6 === 0) void this.runTranslate();
      if ((s.mode === 'nav' && tick % 2 === 0) || tick % 40 === 0) void this.refreshPois();
      // Sign / text recognition in SCAN mode: every ~2.5 s, when the provider can read text.
      if (s.mode === 'scan' && !s.sheet && tick % 5 === 2 && this.vision.capabilities.text !== 'none') void this.scanText();
      tick++;
      await sleep(500);
    }
  }

  private async scanText() {
    const ocr = await this.vision.ocr(this.camera.frame, this.visionCtx()).catch(() => null);
    if (!ocr) return;
    const now = performance.now();
    const hosts = getState().detections.filter((d) => d.source !== 'ocr' && d.source !== 'geo');
    const { byId, free } = attachText(hosts, ocr.blocks);
    this.textById = byId;
    this.textAt = now;
    this.textDets = free.slice(0, 3).map((b) => {
      const lang = b.lang && b.lang !== 'und' ? b.lang : detectLang(b.text);
      return {
        id: `ocr:${b.text.slice(0, 32)}`,
        label: 'text',
        displayName: b.text,
        subtitle: `テキスト · ${lang.toUpperCase()}`,
        category: 'text' as const,
        confidence: 0.9,
        bbox: b.bbox,
        timestamp: now,
        source: 'ocr' as const,
        text: b.text,
        identity: { status: 'identified' as const, kind: 'text' as const, name: b.text, detail: lang.toUpperCase(), confidence: 0.9, source: 'ocr' as const, at: now },
      };
    });
  }

  private async onFirstFix() {
    const geo = getState().geo!;
    if (this.services.location.mode === 'real' && this.services.places.mode === 'mock') await this.maybeReverse(geo, true);
    else {
      const rev = await this.services.places.reverseGeocode(geo).catch(() => null);
      if (rev) setState({ geo: { ...getState().geo!, placeName: rev.placeName, area: rev.area } });
    }
    void this.refreshWeather();
    void this.refreshPois(true);
  }

  /** Real position → place name (keyless OSM lookup): first fix, then after moving ~500 m, ≤ 1/min. */
  private async maybeReverse(geo: GeoFix, force = false) {
    if (this.services.places.mode !== 'mock') return; // a real places service already named it
    const now = Date.now();
    const last = this.lastReverse;
    if (!force && last && (now - last.at < 60_000 || metersBetween(last, geo) < 500)) return;
    this.lastReverse = { lat: geo.lat, lon: geo.lon, at: now };
    const rev = await reverseGeocode(geo);
    const cur = getState().geo;
    if (rev && cur) {
      setState({ geo: { ...cur, placeName: rev.placeName, area: rev.area } });
      if (!force) void this.refreshWeather();
    }
  }

  private async refreshWeather() {
    const geo = getState().geo;
    if (!geo) return;
    this.lastWeatherAt = Date.now();
    try {
      const label = geo.placeName ?? geo.area ?? '現在地';
      setState({ weather: await this.services.weather.report(geo, label) });
    } catch {
      this.lastWeatherAt = Date.now() - WEATHER_TTL_MS + 60_000;
    }
  }

  private async refreshPois(force = false) {
    const geo = getState().geo;
    if (!geo) return;
    const moved = !this.lastPoiGeo || Math.abs(this.lastPoiGeo.lat - geo.lat) + Math.abs(this.lastPoiGeo.lon - geo.lon) > 0.0005;
    if (!force && !moved) return;
    this.lastPoiGeo = { lat: geo.lat, lon: geo.lon };
    // Made-up places belong to the demo world, never around your real position.
    if (this.services.location.mode === 'real' && this.services.places.mode === 'mock') {
      this.nearbyPlaces = [];
      setState({ pois: [] });
      return;
    }
    try {
      const places = await this.services.places.nearby(geo);
      this.nearbyPlaces = places;
      const pois = places.map((p) => toNavTarget(p, geo)).filter((p) => p.distanceM < 8000);
      const nav = getState().navTarget;
      setState({ pois, navTarget: nav ? (pois.find((p) => p.id === nav.id) ?? nav) : null });
    } catch {
      /* ignore */
    }
  }

  private async runTranslate() {
    try {
      const ocr = await this.vision.ocr(this.camera.frame, this.visionCtx());
      if (getState().mode !== 'translate' && !getState().busy) return;
      setState({ ocr });
      if (!ocr.fullText || ocr.fullText === this.lastOcrText) return ocr;
      this.lastOcrText = ocr.fullText;
      const translations = await this.services.translate.translate(
        ocr.blocks.map((b) => ({ id: b.id, text: b.text, lang: b.lang })),
        'ja',
      );
      const withBoxes = translations.map((t) => ({ ...t, bbox: ocr.blocks.find((b) => b.id === t.id)?.bbox }));
      setState({ translations: withBoxes });
      trackRenderer.observeRects(
        withBoxes.filter((t) => t.bbox).map((t) => ({ id: `tr:${t.id}`, bbox: t.bbox! })),
        performance.now(),
      );
      return ocr;
    } catch {
      return null;
    }
  }

  // ─── Interaction: tap / lock ───────────────────────────────────────────

  /** Tap at normalised view coordinates: lock onto a target or focus. */
  tap(x: number, y: number) {
    void startMotion().then((ok) => (perf.motionComp = ok)); // iOS needs a gesture for motion access
    const s = getState();
    const z = s.feedCss.zoom || 1;
    const p = viewToFrame({ x: (x - 0.5) / z + 0.5, y: (y - 0.5) / z + 0.5 }, s.frameSize, s.viewSize, this.camera.mirrored);
    const hit = [...s.detections].sort((a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h).find((d) => boxContains(d.bbox, p.x, p.y));
    if (hit) {
      if (s.lockedId === hit.id) this.unlock();
      else this.lock(hit);
      return;
    }
    setState({ focusPoint: { x, y, at: Date.now() } });
    void this.camera.focusAt();
  }

  lock(det?: Detection) {
    const s = getState();
    const target = det ?? s.detections.find((d) => d.id === s.primaryId);
    if (!target) return false;
    this.lockLastBox = target.bbox;
    // A tapped target is the user's priority: identify it now (or retry an unknown).
    if (!target.identity || target.identity.status === 'unknown' || target.identity.status === 'detected') this.identifier.retry(target.id);
    // Details were requested: confirm against official sources (once per model, cached).
    else if (target.identity.status === 'identified' || target.identity.status === 'possible') void this.identifier.verify(target.id, target);
    setState({ lockedId: target.id, lockState: 'locked', primaryId: target.id });
    navigator.vibrate?.(20);
    void this.loadFocus(target);
    return true;
  }

  unlock() {
    setState({ lockedId: null, lockState: 'none' });
  }

  // ─── Conversation ──────────────────────────────────────────────────────

  toggleListening() {
    const live = this.liveAgent;
    if (live) {
      // Gemini Live: the mic streams straight to the model (it hears, sees, and answers by voice).
      void live.toggleMic().catch((e: Error) => this.toast(e.name === 'NotAllowedError' ? 'マイクへのアクセスが拒否されました' : `MIC: ${e.message}`, 'warn'));
      return;
    }
    const { voice } = this.services;
    if (getState().listening) voice.stopListening();
    else {
      if (getState().speaking) this.interrupt();
      voice.startListening('ja-JP');
    }
  }

  private isBargeIn(partial: string) {
    const p = partial.replace(/\s/g, '');
    if (p.length < 2) return false;
    // Ignore our own TTS leaking into the microphone.
    return !this.lastSpoken.replace(/\s/g, '').includes(p.slice(0, 6));
  }

  /** Barge-in: stop speaking and cancel any in-flight response. */
  interrupt() {
    this.liveAgent?.interruptPlayback();
    this.services.voice.cancelSpeech();
    this.abort?.abort();
    this.abort = null;
    setState({ speaking: false, busy: null, draft: '' });
  }

  private push(msg: Omit<ChatMessage, 'id' | 'ts'>) {
    const m: ChatMessage = { ...msg, id: uid('msg'), ts: Date.now() };
    setState({ conversation: [...getState().conversation.slice(-40), m] });
    return m;
  }

  async ask(raw: string) {
    const text = raw.trim();
    if (!text) return;
    this.interrupt();
    const ac = new AbortController();
    this.abort = ac;
    const history = getState().conversation;
    setState({ busy: 'thinking', partial: '', draft: '' });
    const ctx = this.worldContext();
    const intent: Intent = (await this.services.llm.classify?.(text, ctx)) ?? classifyIntent(text, !!ctx.focus);
    this.push({ role: 'user', text, intent: intent.kind });
    const live = this.liveAgent;
    if (live && LIVE_INTENTS.has(intent.kind)) {
      // Gemini Live sees the camera: it answers (by voice + transcript) with the HUD target as context.
      try {
        await live.ask(text, this.liveHudContext());
        setTimeout(() => getState().busy === 'thinking' && setState({ busy: null }), 12000);
      } catch (e) {
        this.push({ role: 'assistant', text: `Gemini Live に接続できません（${(e as Error).message}）。` });
        setState({ busy: null });
      }
      if (this.abort === ac) this.abort = null;
      return;
    }
    try {
      const grounding = await this.execute(intent, ac.signal);
      if (ac.signal.aborted) return;
      setState({ busy: 'thinking' });
      let draft = '';
      const reply = await this.services.llm.respond(
        { history, utterance: text, intent, context: this.worldContext(), grounding },
        (chunk) => {
          draft += chunk;
          setState({ draft });
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      this.push({ role: 'assistant', text: reply, intent: intent.kind, attachment: attachmentFor(grounding) });
      setState({ busy: null, draft: '' });
      this.lastSpoken = reply;
      await this.services.voice.speak(reply, 'ja-JP');
    } catch (err) {
      if ((err as Error).name === 'AbortError' || ac.signal.aborted) return;
      this.push({ role: 'assistant', text: `エラーが発生しました（${(err as Error).message}）。` });
      setState({ busy: null, draft: '' });
    } finally {
      if (this.abort === ac) this.abort = null;
    }
  }

  /** Tool execution for an intent. Returns grounding for the LLM. */
  private async execute(intent: Intent, signal: AbortSignal): Promise<Grounding> {
    const s = getState();
    const target = s.detections.find((d) => d.id === (s.lockedId ?? s.primaryId)) ?? s.detections[0];
    switch (intent.kind) {
      case 'identify':
      case 'place_info':
      case 'product_info': {
        if (!target) return { kind: 'profile', profile: s.focus };
        let subject = target;
        // "これは何？" while identification is pending: kick it off now and wait briefly for tier 2.
        if (target.category !== 'person' && target.source !== 'ocr' && (!target.identity || target.identity.status === 'identifying')) {
          if (!target.identity) this.identifier.retry(target.id);
          const until = performance.now() + 2500;
          while (performance.now() < until && !signal.aborted) {
            await sleep(150, signal);
            const idn = this.identifier.identityOf(target.id);
            if (idn && idn.status !== 'identifying') {
              subject = { ...target, identity: idn };
              break;
            }
          }
        }
        const profile = await this.profileFor(subject);
        if (profile && getState().focus?.id !== profile.id) {
          setState({ primaryId: target.id });
          void this.loadFocus(target);
        }
        // "いくら？" for something we recognised but hold no price for → Web Search.
        if (intent.kind === 'product_info' && profile && !profile.product && /値段|価格|いくら|最安/.test(intent.text) && target.category !== 'person') {
          return this.execute({ ...intent, kind: 'search', query: `${profile.name} 価格`, referential: false }, signal);
        }
        if (profile && (intent.kind === 'product_info' || intent.kind === 'place_info')) setState({ sheet: 'intel' });
        return { kind: 'profile', profile };
      }
      case 'chat':
        return s.focus && intent.referential ? { kind: 'profile', profile: s.focus } : { kind: 'none' };
      case 'search': {
        const base = intent.query ?? intent.text;
        const strip = (t: string) => t.replace(/(これ|それ|あれ|この|その|あの|ここ|そこ|この場所|この辺)(について|の)?/g, '').trim();
        const ctx = this.worldContext();
        let query = base;
        if (/ここ|この場所|この辺|この辺り/.test(intent.text)) {
          // "ここについて調べて" → the place: identified landmark / building first, then the location estimate.
          const lm = s.detections.find((d) => (d.identity?.kind === 'landmark' || d.identity?.kind === 'building') && d.identity.status !== 'unknown' && d.identity.name);
          const where = lm?.identity?.name ?? s.location?.name ?? s.geo?.area;
          if (where) query = `${where} ${strip(base)}`.trim();
        } else if (intent.referential && s.focus?.identity?.status === 'unknown' && target) {
          // Unknown object → image search with a crop of the target.
          const crop = await this.cropTarget(target);
          if (crop) {
            const c = document.createElement('canvas');
            c.width = crop.width;
            c.height = crop.height;
            c.getContext('2d')!.drawImage(crop, 0, 0);
            crop.close();
            ctx.focusImage = c.toDataURL('image/jpeg', 0.8);
          }
          query = `画像検索: ${target.displayName}`;
        } else if (intent.referential && s.focus && !base.includes(s.focus.name)) {
          query = `${s.focus.name} ${strip(base)}`.trim();
        }
        setState({ busy: 'searching', sheet: 'search', search: { query, stage: 'query' } });
        const answer = await this.services.search.search(
          query,
          ctx,
          (stage, detail) => setState({ search: { ...getState().search!, stage, detail } }),
          signal,
        );
        setState({ search: { query, stage: 'done', answer } });
        return { kind: 'search', answer };
      }
      case 'weather': {
        const report = s.weather ?? (s.geo ? await this.services.weather.report(s.geo, '東京') : null);
        if (!report) return { kind: 'ack', action: '位置情報が取得できないため、天気を確認できません。' };
        setState({ weather: report, pinned: { ...getState().pinned, weather: Date.now() + 15000 } });
        return { kind: 'weather', report, when: intent.params?.when === 'tomorrow' ? 'tomorrow' : 'now' };
      }
      case 'navigate': {
        const q = intent.query ?? intent.text;
        const geo = s.geo;
        const t = geo ? await this.services.places.resolveDestination(q, geo) : null;
        if (t) {
          setState({ navTarget: t });
          this.setMode('nav');
        }
        return { kind: 'nav', target: t, query: q };
      }
      case 'translate':
      case 'ocr': {
        this.setMode('translate');
        this.lastOcrText = '';
        await this.runTranslate();
        return { kind: 'translation', items: getState().translations };
      }
      case 'memory_search': {
        const hits = await this.services.memory.search(intent.query ?? intent.text, this.worldContext());
        setState({ memoryHits: hits, memoryQuery: intent.text, sheet: 'memory' });
        return { kind: 'memory', hits };
      }
      case 'capture_photo': {
        const timer = Number(intent.params?.timer ?? 0);
        const item = await this.capturePhoto(timer || undefined);
        return { kind: 'capture', item, timerSec: timer };
      }
      case 'record_start':
        await this.startRecording();
        return { kind: 'record', recording: getState().recording };
      case 'record_stop':
        await this.stopRecording();
        return { kind: 'record', recording: false };
      case 'switch_camera':
        this.switchCamera();
        return { kind: 'ack', action: this.camera.source === 'demo' ? 'デモ映像ではカメラを切り替えられません。' : 'カメラを切り替えました。' };
      case 'zoom': {
        const z = Math.max(1, Math.min(10, Number(intent.params?.zoom ?? 2)));
        await this.setCamera({ zoom: z });
        return { kind: 'ack', action: `${z}倍にズームしました。` };
      }
      case 'lock':
        return { kind: 'ack', action: this.lock() ? `${s.focus?.name ?? '対象'}をロックしました。追跡します。` : 'ロックできる対象がありません。' };
      case 'unlock':
        this.unlock();
        return { kind: 'ack', action: 'ロックを解除しました。' };
      case 'scene':
        await this.analyzeScene();
        return { kind: 'scene', scene: getState().scene };
      case 'open_url': {
        const f = s.focus;
        let url = f?.officialUrl ?? f?.identity?.officialUrl ?? f?.product?.officialUrl ?? f?.place?.website ?? null;
        const label = f ? `${f.name} 公式サイト` : '公式サイト';
        if (!url && f && f.category !== 'person' && f.identity?.status !== 'unknown') {
          // Not in the knowledge base: find it (official-tier sources rank first).
          const answer = await this.services.search.search(`${f.name} 公式サイト`, this.worldContext(), () => undefined, signal).catch(() => null);
          url = answer?.sources.find((x) => x.tier === 'official')?.url ?? null;
        }
        if (!url) return { kind: 'link', url: null, label, opened: false };
        // Voice results aren't a user gesture, so popups may be blocked — the reply also carries a button.
        const w = window.open(url, '_blank', 'noopener');
        return { kind: 'link', url, label, opened: !!w };
      }
      case 'social': {
        const item = s.selectedMemory ?? (await this.services.memory.list(1))[0];
        if (!item) return { kind: 'ack', action: '投稿に使う写真がありません。先に撮影してください。' };
        const draft = await this.services.social.draft(item, (intent.params?.platform ?? 'instagram') as SocialPlatform);
        setState({ socialDraft: draft, selectedMemory: item, sheet: 'social' });
        return { kind: 'social', draft };
      }
    }
  }

  // ─── Capture & memory ──────────────────────────────────────────────────

  private semanticTags(): { tags: string[]; entities: string[] } {
    const s = getState();
    const tags = new Set<string>();
    s.scene?.tags.forEach((t) => tags.add(t));
    if (s.geo?.area) tags.add(s.geo.area);
    if (s.focus) {
      tags.add(s.focus.name);
      if (s.focus.nameEn) tags.add(s.focus.nameEn);
    }
    s.detections.filter((d) => d.category !== 'person' && d.confidence > 0.6).forEach((d) => tags.add(d.displayName));
    const tod = s.scene?.timeOfDay ?? timeOfDayFor(new Date());
    tags.add(TOD_TAG[tod]);
    return { tags: [...tags].slice(0, 10), entities: s.focus ? [s.focus.id, s.focus.name] : [] };
  }

  private buildItem(kind: 'photo' | 'video', thumbnail: string): MemoryItem {
    const s = getState();
    const { tags, entities } = this.semanticTags();
    return {
      id: uid(kind),
      kind,
      createdAt: new Date().toISOString(),
      thumbnail,
      tags,
      entities,
      place: s.geo?.area ?? s.geo?.placeName ?? s.scene?.location,
      scene: s.scene?.summary,
      timeOfDay: s.scene?.timeOfDay ?? timeOfDayFor(new Date()),
      lat: s.geo?.lat,
      lon: s.geo?.lon,
    };
  }

  async capturePhoto(timerSec: number = getState().camera.timerSec): Promise<MemoryItem> {
    for (let i = timerSec; i > 0; i--) {
      setState({ countdown: i });
      await sleep(1000);
    }
    setState({ countdown: null, flashAt: Date.now() });
    navigator.vibrate?.(15);
    // 見る → 撮る: grab the HUD thumbnail from the preview instantly, then take the
    // full-resolution still (ImageCapture) — the preview keeps running meanwhile.
    const thumb = toJpegDataUrl(this.camera.frame, 360, 0.72);
    const shot = await this.camera.takePhoto(getState().camera).catch(() => null);
    const item = this.buildItem('photo', thumb);
    await this.services.memory.save(item, shot?.blob);
    await this.refreshMemory();
    this.toast(`MEMORY SAVED  ${item.tags.slice(0, 3).map((t) => `#${t}`).join(' ')}`, 'memory');
    return item;
  }

  async startRecording() {
    if (getState().recording) return;
    if (!this.camera.startRecording()) return this.toast('この端末では録画できません', 'warn');
    // Leave headroom for the hardware encoder: AI runs slower while recording.
    this.sampler.capFps = 8;
    setState({ recording: true, recordStartedAt: Date.now() });
  }

  async stopRecording() {
    if (!getState().recording) return;
    const blob = await this.camera.stopRecording();
    this.sampler.capFps = 15;
    setState({ recording: false, recordStartedAt: null });
    const item = this.buildItem('video', toJpegDataUrl(this.camera.frame, 360, 0.72));
    await this.services.memory.save(item, blob ?? undefined);
    await this.refreshMemory();
    this.toast(`VIDEO SAVED  ${item.tags.slice(0, 2).map((t) => `#${t}`).join(' ')}`, 'memory');
  }

  async shutter() {
    const mode = getState().mode;
    if (mode === 'video') return getState().recording ? this.stopRecording() : this.startRecording();
    await this.capturePhoto();
  }

  async refreshMemory() {
    setState({ memoryItems: await this.services.memory.list(80).catch(() => []) });
  }

  async searchMemory(text: string) {
    setState({ memoryQuery: text });
    if (!text.trim()) return setState({ memoryHits: null });
    setState({ memoryHits: await this.services.memory.search(text, this.worldContext()) });
  }

  async draftSocial(item: MemoryItem, platform: SocialPlatform) {
    setState({ selectedMemory: item, socialDraft: null, sheet: 'social' });
    setState({ socialDraft: await this.services.social.draft(item, platform) });
  }

  async deleteMemory(id: string) {
    await this.services.memory.remove(id);
    setState({ selectedMemory: null });
    await this.refreshMemory();
  }

  // ─── Misc ──────────────────────────────────────────────────────────────

  toast(text: string, kind: Toast['kind'] = 'info', ms = 2800) {
    const t: Toast = { id: uid('toast'), text, kind };
    setState({ toasts: [...getState().toasts.slice(-2), t] });
    this.later(() => setState({ toasts: getState().toasts.filter((x) => x.id !== t.id) }), ms);
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(setTimeout(fn, ms));
  }

  describeMemory(item: MemoryItem) {
    return `${fmtDateJa(new Date(item.createdAt))} · ${item.place ?? ''}`;
  }
}

function attachmentFor(g: Grounding): ChatAttachment | undefined {
  switch (g.kind) {
    case 'search':
      return { kind: 'search', answer: g.answer };
    case 'weather':
      return { kind: 'weather', report: g.report };
    case 'memory':
      return { kind: 'memory', hits: g.hits };
    case 'nav':
      return g.target ? { kind: 'nav', target: g.target } : undefined;
    case 'translation':
      return { kind: 'translation', items: g.items };
    case 'social':
      return { kind: 'social', draft: g.draft };
    case 'link':
      return g.url ? { kind: 'link', url: g.url, label: g.label } : undefined;
    default:
      return undefined;
  }
}

/**
 * Builds the focus profile for a detection at its current recognition stage.
 * People never get more than "人物". Unknown objects say so plainly.
 */
function profileWithIdentity(base: EntityProfile | null, det: Detection): EntityProfile {
  const id = det.identity;
  const status = id?.status ?? 'detected';
  if (det.category === 'person') {
    return { id: det.id, name: '人物', subtitle: 'PERSON DETECTED', category: 'person', summary: '人物を検出しました。顔による個人の特定や、年齢・性別などの推定は行いません。', facts: [], keywords: [], identity: id };
  }
  if (base && id && (status === 'identified' || status === 'possible')) {
    return { ...base, identity: id, officialUrl: base.officialUrl ?? id.officialUrl ?? base.place?.website ?? base.product?.officialUrl };
  }
  if (id && (status === 'identified' || status === 'possible')) {
    return {
      id: id.entityId ?? det.id,
      name: id.name,
      nameEn: id.nameEn,
      subtitle: [det.displayName, id.detail].filter(Boolean).join(' / '),
      category: det.category,
      summary: id.detail ?? `${id.name}と推定されます。`,
      facts: Object.entries(id.attributes ?? {}).map(([label, value]) => ({ key: label, label, value })),
      keywords: [id.name, det.displayName],
      officialUrl: id.officialUrl,
      identity: id,
    };
  }
  const name = shownName(det);
  return {
    id: det.id,
    name,
    subtitle: det.subtitle ?? det.category,
    category: det.category,
    summary:
      status === 'identifying'
        ? `${det.displayName}を識別しています…`
        : status === 'unknown'
          ? '何かは特定できませんでした。「これについて調べて」と話しかけると画像検索します。'
          : `${det.displayName}を検出しました（信頼度 ${Math.round(det.confidence * 100)}%）。`,
    facts: [
      { key: 'class', label: '分類', value: det.displayName },
      { key: 'conf', label: '検出信頼度', value: `${Math.round(det.confidence * 100)}%` },
      ...(det.text ? [{ key: 'text', label: '文字', value: det.text }] : []),
    ],
    keywords: [det.displayName],
    identity: id,
  };
}
