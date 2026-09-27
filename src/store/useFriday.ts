import { create } from 'zustand';
import type { ServiceMode, ServiceName } from '../core/config';
import { resolveServiceModes } from '../core/config';
import type {
  AIState,
  CameraCapabilities,
  CameraSettings,
  CaptureMode,
  ChatMessage,
  Detection,
  EntityProfile,
  FeedSource,
  GeoFix,
  Hazard,
  HudDensity,
  LocationEstimate,
  MemoryHit,
  MemoryItem,
  NavTarget,
  NewsItem,
  OcrResult,
  RelatedInfo,
  SceneAnalysis,
  SearchAnswer,
  SearchStage,
  SocialDraft,
  Translation,
  WeatherReport,
} from '../core/types';
import type { DemoScene } from '../services/contracts';

export type SheetKind = 'search' | 'memory' | 'intel' | 'system' | 'social' | null;
export type LockState = 'none' | 'locked' | 'lost';
export type Busy = 'thinking' | 'searching' | null;

export interface Toast {
  id: string;
  text: string;
  kind: 'info' | 'memory' | 'warn';
}

export interface SearchRun {
  query: string;
  stage: SearchStage;
  detail?: string;
  answer?: SearchAnswer;
  error?: string;
}

export interface FridayState {
  // boot
  bootPhase: number;
  booted: boolean;

  // mode / hud
  mode: CaptureMode;
  density: HudDensity;
  sheet: SheetKind;
  /** Transient panels (e.g. weather after "天気は？") keyed by expiry time. */
  pinned: Partial<Record<'weather' | 'info' | 'scene', number>>;

  // camera
  feed: FeedSource;
  demoScene: DemoScene;
  cameraError: string | null;
  camera: CameraSettings;
  caps: CameraCapabilities | null;
  frameSize: { w: number; h: number };
  viewSize: { w: number; h: number };
  recording: boolean;
  recordStartedAt: number | null;
  countdown: number | null;
  flashAt: number;
  focusPoint: { x: number; y: number; at: number } | null;
  /** Digital zoom / exposure applied in CSS when the hardware can't. */
  feedCss: { zoom: number; exposure: number };

  // services
  serviceModes: Record<ServiceName, ServiceMode>;

  // perception
  detections: Detection[];
  primaryId: string | null;
  lockedId: string | null;
  lockState: LockState;
  focus: EntityProfile | null;
  related: RelatedInfo[];
  news: NewsItem[];
  scene: SceneAnalysis | null;
  analyzingUntil: number;
  /** Fused "where are we" (GPS + landmarks + signs). */
  location: LocationEstimate | null;
  /** Multi-object summary, e.g. PERSON ×4 · CAR ×3. */
  objectCounts: { key: string; label: string; n: number }[];
  hazards: Hazard[];
  ocr: OcrResult | null;
  translations: Translation[];

  // world
  geo: GeoFix | null;
  heading: number;
  weather: WeatherReport | null;
  navTarget: NavTarget | null;
  pois: NavTarget[];

  // conversation
  conversation: ChatMessage[];
  partial: string;
  draft: string;
  listening: boolean;
  speaking: boolean;
  /** Gemini Live connection (vision=live). */
  live: { status: string; detail?: string; mic: boolean } | null;
  /** Wake word 「フライデー」 listener state. */
  wake: 'off' | 'listening' | 'paused' | 'unsupported' | 'denied';
  busy: Busy;
  search: SearchRun | null;

  // memory
  memoryItems: MemoryItem[];
  memoryHits: MemoryHit[] | null;
  memoryQuery: string;
  recall: MemoryHit | null;
  recallAt: number;
  selectedMemory: MemoryItem | null;
  socialDraft: SocialDraft | null;

  toasts: Toast[];
  /** Developer performance overlay. */
  perfHud: boolean;
}

export const initialCamera: CameraSettings = {
  facing: 'environment',
  zoom: 1,
  torch: false,
  exposure: 0,
  timerSec: 0,
  preview: '720p',
  photo: 'max',
  fps: 60,
  stabilization: true,
  night: false,
};

/** Perf HUD: ?perf=1, VITE_PERF_HUD=1, or the SYSTEM sheet toggle (persisted). Off in production by default. */
function loadPerfHud(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('perf');
    if (q != null) return q !== '0';
    const saved = localStorage.getItem('friday.perfHud');
    if (saved != null) return saved === '1';
  } catch {
    /* ignore */
  }
  return (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_PERF_HUD === '1';
}

function loadDensity(): HudDensity {
  try {
    const v = localStorage.getItem('friday.density');
    if (v === 'minimal' || v === 'auto' || v === 'full') return v;
  } catch {
    /* ignore */
  }
  return 'auto';
}

export const useFriday = create<FridayState>(() => ({
  bootPhase: 0,
  booted: false,
  mode: 'scan',
  density: loadDensity(),
  sheet: null,
  pinned: {},
  feed: 'demo',
  demoScene: 'odaiba',
  cameraError: null,
  camera: initialCamera,
  caps: null,
  frameSize: { w: 0, h: 0 },
  viewSize: { w: 0, h: 0 },
  recording: false,
  recordStartedAt: null,
  countdown: null,
  flashAt: 0,
  focusPoint: null,
  feedCss: { zoom: 1, exposure: 0 },
  serviceModes: resolveServiceModes(),
  detections: [],
  primaryId: null,
  lockedId: null,
  lockState: 'none',
  focus: null,
  related: [],
  news: [],
  scene: null,
  analyzingUntil: 0,
  location: null,
  objectCounts: [],
  hazards: [],
  ocr: null,
  translations: [],
  geo: null,
  heading: 0,
  weather: null,
  navTarget: null,
  pois: [],
  conversation: [],
  partial: '',
  draft: '',
  listening: false,
  speaking: false,
  live: null,
  wake: 'off',
  busy: null,
  search: null,
  memoryItems: [],
  memoryHits: null,
  memoryQuery: '',
  recall: null,
  recallAt: 0,
  selectedMemory: null,
  socialDraft: null,
  toasts: [],
  perfHud: loadPerfHud(),
}));

export const setState = useFriday.setState;
export const getState = useFriday.getState;

/**
 * The AI state is *derived*, never set directly, so it can't drift out of
 * sync with what the system is actually doing. Priority mirrors what the user
 * most needs to know right now.
 */
export function deriveAIState(s: FridayState, now = Date.now()): AIState {
  if (!s.booted) return 'BOOTING';
  if (s.speaking) return 'SPEAKING';
  if (s.busy === 'searching') return 'SEARCHING';
  if (s.busy === 'thinking') return 'THINKING';
  const target = primaryDetection(s);
  if (target?.identity?.status === 'identifying' || target?.identity?.stage) return 'IDENTIFYING';
  if (s.listening && s.partial) return 'LISTENING';
  if (s.lockState === 'locked') return 'TARGET_LOCKED';
  if (s.analyzingUntil > now) return 'ANALYZING';
  if (s.primaryId && s.focus) return 'IDENTIFIED';
  if (s.listening) return 'LISTENING';
  return 'SCANNING';
}

export const useAIState = () => useFriday((s) => deriveAIState(s));

export const primaryDetection = (s: FridayState): Detection | null =>
  s.detections.find((d) => d.id === (s.lockedId ?? s.primaryId)) ?? null;
