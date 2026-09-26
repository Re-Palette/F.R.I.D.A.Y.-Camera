/**
 * Service contracts.
 *
 * The orchestrator and HUD only ever depend on these interfaces. Each has a
 * `mock` implementation (deterministic, offline, demo-quality data) and a
 * `real` implementation (browser API or HTTP gateway). See docs/ARCHITECTURE.md
 * for the HTTP contract the real clients expect.
 */
import type { ServiceMode } from '../core/config';
import type { Emitter } from '../core/events';
import type {
  ChatMessage,
  Detection,
  EntityProfile,
  GeoFix,
  Intent,
  MemoryHit,
  MemoryItem,
  NavTarget,
  NewsItem,
  OcrResult,
  PlaceInfo,
  RelatedInfo,
  SceneAnalysis,
  SearchAnswer,
  SearchStage,
  SocialDraft,
  SocialPlatform,
  Translation,
  WeatherReport,
} from '../core/types';

export interface ServiceBase {
  readonly mode: ServiceMode;
}

/** Something the vision layer can read pixels from. */
export type FrameSource = HTMLVideoElement | HTMLCanvasElement;

/**
 * A sampled frame for AI (pipeline 2). `bitmap` is a GPU-downscaled copy
 * made only for engines that need pixels (worker engines); the preview
 * itself is never touched. `capturedAt` is the sensor capture time
 * (performance.now() timebase) used for latency and motion compensation.
 */
export interface VisionFrame {
  source: FrameSource;
  bitmap: ImageBitmap | null;
  width: number;
  height: number;
  capturedAt: number;
}

/** Hint for mock implementations: which demo scene is on screen. */
export type DemoScene = 'odaiba' | 'desk' | 'menu' | 'street';

export interface VisionContext {
  geo?: GeoFix;
  heading?: number;
  demoScene?: DemoScene;
  /** Demo feed clock (seconds) so mock detections track the procedural scene. */
  demoClock?: { time: number; sceneTime: number };
  now: Date;
}

// ─── Vision ─────────────────────────────────────────────────────────────────

export interface VisionService extends ServiceBase {
  /** Load models / warm up. Safe to call more than once. */
  init(): Promise<void>;
  /** Does this engine need pixels (an ImageBitmap) for `detect`? Mock engines don't. */
  readonly needsPixels: boolean;
  /** Preferred long side of the sampled bitmap. */
  readonly inputSize: number;
  /** Fast path, called ~5-15×/s off the preview path. Returns tracked detections with stable ids. */
  detect(frame: VisionFrame, ctx: VisionContext): Promise<Detection[]>;
  /** Pure inference time of the last detect (ms), if the engine reports it. */
  lastInferMs?: number;
  /** Slow path, called every few seconds or on scene change. */
  analyzeScene(frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis>;
  /** Text recognition for signs, menus, documents, screens. */
  ocr(frame: FrameSource, ctx: VisionContext): Promise<OcrResult>;
  dispose(): void;
}

// ─── Knowledge (entity profiles, places, products) ─────────────────────────

export interface KnowledgeService extends ServiceBase {
  profile(detection: Detection, ctx: VisionContext): Promise<EntityProfile | null>;
  related(profile: EntityProfile): Promise<RelatedInfo[]>;
}

export interface PlacesService extends ServiceBase {
  nearby(geo: GeoFix, kinds?: PlaceInfo['kind'][]): Promise<PlaceInfo[]>;
  /** Resolve a free-text destination ("駅", "カフェ") into a navigation target. */
  resolveDestination(query: string, geo: GeoFix): Promise<NavTarget | null>;
  reverseGeocode(geo: GeoFix): Promise<{ placeName: string; area: string }>;
}

// ─── Language ──────────────────────────────────────────────────────────────

export interface WorldContext {
  focus?: EntityProfile | null;
  detections: Detection[];
  scene?: SceneAnalysis | null;
  geo?: GeoFix | null;
  weather?: WeatherReport | null;
  now: Date;
}

export interface LLMRequest {
  history: ChatMessage[];
  utterance: string;
  intent: Intent;
  context: WorldContext;
  /** Tool outputs already gathered by the orchestrator (search answer, weather…). */
  grounding?: Grounding;
}

/** Tool results the orchestrator hands to the LLM to verbalise. */
export type Grounding =
  | { kind: 'profile'; profile: EntityProfile | null }
  | { kind: 'search'; answer: SearchAnswer }
  | { kind: 'weather'; report: WeatherReport; when: 'now' | 'tomorrow' }
  | { kind: 'memory'; hits: MemoryHit[] }
  | { kind: 'nav'; target: NavTarget | null; query: string }
  | { kind: 'translation'; items: Translation[] }
  | { kind: 'capture'; item: MemoryItem; timerSec: number }
  | { kind: 'record'; recording: boolean }
  | { kind: 'scene'; scene: SceneAnalysis | null }
  | { kind: 'social'; draft: SocialDraft }
  | { kind: 'ack'; action: string }
  | { kind: 'none' };

export interface LLMService extends ServiceBase {
  /** Streams the reply token-by-token; resolves with the full text. */
  respond(req: LLMRequest, onToken: (chunk: string) => void, signal?: AbortSignal): Promise<string>;
  /** Optional model-based intent classifier. Return null to fall back to rules. */
  classify?(utterance: string, context: WorldContext): Promise<Intent | null>;
}

export interface SearchService extends ServiceBase {
  /**
   * Web search → collect → rank by trust tier → cross-check → summarise.
   * `onStage` lets the HUD visualise the pipeline.
   */
  search(
    query: string,
    context: WorldContext,
    onStage: (stage: SearchStage, detail?: string) => void,
    signal?: AbortSignal,
  ): Promise<SearchAnswer>;
}

export interface TranslateService extends ServiceBase {
  translate(texts: { id: string; text: string; lang?: string }[], targetLang: string): Promise<Translation[]>;
}

// ─── World data ─────────────────────────────────────────────────────────────

export interface WeatherService extends ServiceBase {
  report(geo: GeoFix, label?: string): Promise<WeatherReport>;
}

export interface NewsService extends ServiceBase {
  forContext(topic: { keywords: string[]; geo?: GeoFix | null }): Promise<NewsItem[]>;
}

export interface LocationEvents extends Record<string, unknown> {
  fix: GeoFix;
  heading: number;
  error: string;
}

export interface LocationService extends ServiceBase {
  readonly events: Emitter<LocationEvents>;
  /** Must be invoked from a user gesture on iOS (DeviceOrientation permission). */
  start(): Promise<void>;
  stop(): void;
}

// ─── Voice ─────────────────────────────────────────────────────────────────

export interface VoiceEvents extends Record<string, unknown> {
  partial: string;
  final: string;
  /** User started talking — used for barge-in while the assistant is speaking. */
  speechstart: void;
  listening: boolean;
  speaking: boolean;
  level: number;
  error: string;
}

export interface VoiceService extends ServiceBase {
  readonly events: Emitter<VoiceEvents>;
  readonly sttSupported: boolean;
  readonly ttsSupported: boolean;
  startListening(lang?: string): void;
  stopListening(): void;
  speak(text: string, lang?: string): Promise<void>;
  /** Barge-in: stop any ongoing speech immediately. */
  cancelSpeech(): void;
}

// ─── Memory ─────────────────────────────────────────────────────────────────

export interface MemoryService extends ServiceBase {
  init(): Promise<void>;
  save(item: MemoryItem, blob?: Blob): Promise<void>;
  list(limit?: number): Promise<MemoryItem[]>;
  search(text: string, context: WorldContext): Promise<MemoryHit[]>;
  /** "You saw this view 2 months ago" — similar memories for the current scene. */
  recall(context: WorldContext): Promise<MemoryHit | null>;
  getBlob(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
}

// ─── Creative (future-facing) ───────────────────────────────────────────────

export interface SocialService extends ServiceBase {
  draft(item: MemoryItem, platform: SocialPlatform): Promise<SocialDraft>;
}

// ─── Registry ───────────────────────────────────────────────────────────────

export interface ServiceRegistry {
  vision: VisionService;
  knowledge: KnowledgeService;
  places: PlacesService;
  llm: LLMService;
  search: SearchService;
  translate: TranslateService;
  weather: WeatherService;
  news: NewsService;
  location: LocationService;
  voice: VoiceService;
  memory: MemoryService;
  social: SocialService;
}
