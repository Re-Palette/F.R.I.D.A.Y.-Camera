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
import { toJpegDataUrl } from '../camera/frame';
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
  HudDensity,
  Intent,
  MemoryItem,
  SocialPlatform,
} from '../core/types';
import { boxCenter, boxContains, fmtDateJa, iou, sleep, timeOfDayFor, uid, viewToFrame } from '../core/util';
import type { DemoScene, Grounding, ServiceRegistry, VisionContext, VisionFrame, VisionService, WorldContext } from '../services/contracts';
import { toNavTarget } from '../services/places';
import { createServices } from '../services/registry';
import { MockVisionService } from '../services/vision/MockVisionService';
import { OnDeviceVisionService, RemoteVisionService } from '../services/vision/WorkerVisionService';
import { getState, setState, type SheetKind, type Toast } from '../store/useFriday';
import { evaluateHazards } from './hazards';
import { classifyIntent } from './intents';

const PRIMARY_ACQUIRE_MS = 450;
const PRIMARY_RELEASE_MS = 1300;
const LOCK_LOST_MS = 700;
const LOCK_DROP_MS = 4000;
const SCENE_INTERVAL_MS = 9000;
const WEATHER_TTL_MS = 10 * 60 * 1000;

const TOD_TAG = { dawn: '夜明け', morning: '朝', day: '昼', dusk: '夕焼け', night: '夜' } as const;

export class Orchestrator {
  services: ServiceRegistry;
  readonly camera = new CameraController();
  private vision: VisionService;
  private running = false;
  private unsubs: (() => void)[] = [];
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

  constructor() {
    this.services = createServices(getState().serviceModes);
    this.vision = this.services.vision;
    this.sampler = new FrameSampler(
      () => ({ source: this.camera.frame, needsPixels: this.vision.needsPixels, inputSize: this.vision.inputSize }),
      (frame) => this.runVision(frame),
    );
    this.camera.onFeedElementChange = () => this.sampler.rebind();
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
    this.swapVision();
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
    this.swapVision();
    this.resetPerception();
  }

  /**
   * The demo feed is synthetic, so it is always "seen" by the mock detector.
   * A real camera can't be understood by the mock, so a `mock` vision setting
   * upgrades to on-device detection there.
   */
  private swapVision() {
    const configured = getState().serviceModes.vision;
    const feed = this.camera.source;
    const wanted = feed === 'demo' ? 'mock' : configured === 'mock' ? 'ondevice' : configured;
    if (this.vision.mode === wanted) return;
    this.vision.dispose();
    this.vision = wanted === 'ondevice' ? new OnDeviceVisionService() : wanted === 'real' ? new RemoteVisionService() : new MockVisionService();
    this.vision.init().catch(() => {
      this.toast('VISION MODEL LOAD FAILED', 'warn');
    });
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
    return { focus: s.focus, detections: s.detections, scene: s.scene, geo: s.geo, weather: s.weather, now: new Date() };
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
    trackRenderer.observe(dets, frame.capturedAt);
    this.processDetections(dets);
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

    const changedPrimary = primaryId !== s.primaryId;
    setState({ detections: dets, lockedId, lockState, primaryId, hazards });
    if (changedPrimary) {
      if (primaryId) {
        const det = dets.find((d) => d.id === primaryId);
        if (det) void this.loadFocus(det);
      } else setState({ focus: null, related: [], news: [], recall: null });
    }
  }

  private profileFor(det: Detection): Promise<EntityProfile | null> {
    const key = det.entityId ?? det.id;
    let p = this.profileCache.get(key);
    if (!p) {
      p = this.services.knowledge.profile(det, this.visionCtx()).catch(() => null);
      this.profileCache.set(key, p);
    }
    return p;
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
      const scene = await this.vision.analyzeScene(this.camera.frame, getState().detections, this.visionCtx());
      setState({ scene });
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
      tick++;
      await sleep(500);
    }
  }

  private async onFirstFix() {
    const geo = getState().geo!;
    const rev = await this.services.places.reverseGeocode(geo).catch(() => null);
    if (rev) setState({ geo: { ...getState().geo!, placeName: rev.placeName, area: rev.area } });
    void this.refreshWeather();
    void this.refreshPois(true);
  }

  private async refreshWeather() {
    const geo = getState().geo;
    if (!geo) return;
    this.lastWeatherAt = Date.now();
    try {
      const label = geo.area ? '東京' : geo.placeName ?? '現在地';
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
    try {
      const places = await this.services.places.nearby(geo);
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
        const profile = await this.profileFor(target);
        if (profile && getState().focus?.id !== profile.id) {
          setState({ primaryId: target.id });
          void this.loadFocus(target);
        }
        if (profile && (intent.kind === 'product_info' || intent.kind === 'place_info')) setState({ sheet: 'intel' });
        return { kind: 'profile', profile };
      }
      case 'chat':
        return s.focus && intent.referential ? { kind: 'profile', profile: s.focus } : { kind: 'none' };
      case 'search': {
        const base = intent.query ?? intent.text;
        const query = intent.referential && s.focus && !base.includes(s.focus.name) ? `${s.focus.name} ${base.replace(/(これ|それ|あれ|この|その|あの)(について)?/g, '').trim()}` : base;
        setState({ busy: 'searching', sheet: 'search', search: { query, stage: 'query' } });
        const answer = await this.services.search.search(
          query,
          this.worldContext(),
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
    default:
      return undefined;
  }
}
