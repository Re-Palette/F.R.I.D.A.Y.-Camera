/**
 * F.R.I.D.A.Y. domain model.
 *
 * Every layer (camera → vision → orchestration → services → HUD) speaks in these
 * types, so a mock and a real implementation of a service are interchangeable.
 */

// ─── AI state machine ───────────────────────────────────────────────────────

export type AIState =
  | 'BOOTING'
  | 'IDLE'
  | 'SCANNING'
  | 'ANALYZING'
  | 'IDENTIFYING'
  | 'IDENTIFIED'
  | 'TARGET_LOCKED'
  | 'LISTENING'
  | 'THINKING'
  | 'SEARCHING'
  | 'SPEAKING'
  | 'ERROR';

export type CaptureMode = 'scan' | 'photo' | 'video' | 'translate' | 'nav';

export type HudDensity = 'minimal' | 'auto' | 'full';

// ─── Geometry ───────────────────────────────────────────────────────────────

/** Bounding box normalised to the source frame (0‥1 on both axes). */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Vision ─────────────────────────────────────────────────────────────────

export type ObjectCategory =
  | 'person'
  | 'building'
  | 'landmark'
  | 'vehicle'
  | 'train'
  | 'road'
  | 'product'
  | 'computer'
  | 'phone'
  | 'appliance'
  | 'food'
  | 'animal'
  | 'plant'
  | 'sign'
  | 'store'
  | 'cosmetics'
  | 'text'
  | 'boat'
  | 'other';

/** Where a perception result came from. */
export type PerceptionSource = 'mock' | 'local' | 'cloud' | 'geo' | 'ocr';

/**
 * Recognition progress for one tracked object:
 *   detected → identifying → identified | possible | unknown
 * (`person` never goes past `detected`: no identity, no attributes.)
 */
export type IdentityStatus = 'detected' | 'identifying' | 'identified' | 'possible' | 'unknown';

export type IdentityKind =
  | 'landmark'
  | 'building'
  | 'product'
  | 'vehicle'
  | 'food'
  | 'plant'
  | 'animal'
  | 'person'
  | 'text'
  | 'place'
  | 'generic';

/** Fine-grained identification of a detection (tier 2, e.g. 車 → Tesla Model 3). */
export interface Identification {
  status: IdentityStatus;
  kind: IdentityKind;
  /** Specific name ("東京ビッグサイト", "Tesla Model 3"). Empty when unknown. */
  name: string;
  nameEn?: string;
  /** One-line description (用途 / カテゴリー / 推定材料…). */
  detail?: string;
  confidence: number;
  /** Knowledge-graph / catalogue reference for profile lookup. */
  entityId?: string;
  officialUrl?: string;
  /** Safe, factual attributes only (型番, ブランド, 学名…). Never personal attributes. */
  attributes?: Record<string, string>;
  /** Alternatives when not certain. */
  candidates?: { name: string; confidence: number }[];
  source: PerceptionSource;
  at: number;
}

/**
 * One perceived object. Field mapping to the perception record spec:
 *   id = trackingId · category = type · label · confidence · bbox = boundingBox
 *   timestamp · attributes · source · identity (tier-2 identification)
 */
export interface Detection {
  /** Stable tracking id — identical across frames for the same physical object. */
  id: string;
  /** Raw (tier-1) model label, e.g. "car", "cell phone". */
  label: string;
  /** Human-facing tier-1 name, e.g. "乗用車". */
  displayName: string;
  /** Secondary line, e.g. "車両". */
  subtitle?: string;
  /** Object type. */
  category: ObjectCategory;
  confidence: number;
  bbox: BBox;
  /** Knowledge-graph reference used by the knowledge / places / product services. */
  entityId?: string;
  /** Capture time (performance.now() timebase) of the frame this came from. */
  timestamp?: number;
  source?: PerceptionSource;
  attributes?: Record<string, string>;
  /** Text read on this object (signs, labels) by OCR. */
  text?: string;
  identity?: Identification;
}

/** Where we think the camera is, and how sure we are. */
export interface LocationEstimate {
  name: string;
  area?: string;
  confidence: number;
  /** Evidence used: GPS fix, recognised landmark, sign text, image. */
  basis: ('gps' | 'landmark' | 'sign' | 'image')[];
  /** true → show as 推定 (not confirmed). */
  estimated: boolean;
}

export type TimeOfDay = 'dawn' | 'morning' | 'day' | 'dusk' | 'night';

export interface SceneAnalysis {
  summary: string;
  tags: string[];
  location?: string;
  timeOfDay: TimeOfDay;
  weather?: string;
  crowd?: 'low' | 'moderate' | 'high';
  environment?: string;
  confidence: number;
  /** Regions the scene model found that the fast detector can't (buildings, signs, text). */
  regions?: Detection[];
}

export interface OcrBlock {
  id: string;
  text: string;
  bbox: BBox;
  lang: string;
}

export interface OcrResult {
  blocks: OcrBlock[];
  fullText: string;
  language: string;
}

// ─── Knowledge ──────────────────────────────────────────────────────────────

export interface Fact {
  key: string;
  label: string;
  value: string;
}

export interface PlaceInfo {
  id: string;
  name: string;
  kind: 'station' | 'store' | 'building' | 'landmark' | 'cafe' | 'restaurant' | 'park';
  address: string;
  lat: number;
  lon: number;
  rating?: number;
  reviewCount?: number;
  openNow?: boolean;
  hours?: string;
  website?: string;
  crowd?: 'low' | 'moderate' | 'high';
}

export interface ProductOffer {
  store: string;
  priceJPY: number;
  url?: string;
}

export interface ProductInfo {
  name: string;
  maker: string;
  priceJPY: number;
  officialUrl: string;
  specs: Fact[];
  rating: number;
  reviewCount: number;
  reviewSummary: string;
  similar: { name: string; priceJPY: number }[];
  offers: ProductOffer[];
}

export interface EntityProfile {
  id: string;
  name: string;
  nameEn?: string;
  subtitle: string;
  category: ObjectCategory;
  summary: string;
  facts: Fact[];
  place?: PlaceInfo;
  product?: ProductInfo;
  keywords: string[];
  officialUrl?: string;
  /** How this entity was recognised (status, confidence) — drives uncertainty wording. */
  identity?: Identification;
}

// ─── Search ─────────────────────────────────────────────────────────────────

/** Source trust tiers, highest first. The HUD prioritises by this order. */
export type SourceTier = 'official' | 'government' | 'news' | 'corporate' | 'reference' | 'community';

export interface SearchSource {
  id: string;
  title: string;
  url: string;
  publisher: string;
  tier: SourceTier;
  snippet: string;
  publishedAt?: string;
  /** 0‥1 — trust score computed from tier, recency and cross-source agreement. */
  trust: number;
}

export type SearchStage = 'query' | 'retrieve' | 'rank' | 'crosscheck' | 'summarize' | 'done';

export interface SearchAnswer {
  query: string;
  summary: string;
  keyPoints: string[];
  sources: SearchSource[];
  followUps: string[];
  generatedAt: string;
}

// ─── Environment / location ────────────────────────────────────────────────

export type WeatherCode = 'clear' | 'partly' | 'cloudy' | 'rain' | 'snow' | 'storm' | 'fog';

export interface WeatherNow {
  tempC: number;
  condition: string;
  code: WeatherCode;
  humidity: number;
  windMs: number;
  uvIndex: number;
  precipProb: number;
  sunset: string;
  airQuality: string;
}

export interface HourlyForecast {
  time: string;
  tempC: number;
  code: WeatherCode;
}

export interface DailyForecast {
  date: string;
  maxC: number;
  minC: number;
  code: WeatherCode;
  condition: string;
  precipProb: number;
}

export interface WeatherReport {
  locationLabel: string;
  now: WeatherNow;
  hourly: HourlyForecast[];
  tomorrow: DailyForecast;
  fetchedAt: string;
}

export interface GeoFix {
  lat: number;
  lon: number;
  altitude?: number;
  accuracy?: number;
  /** m/s */
  speed?: number;
  placeName?: string;
  area?: string;
}

// ─── News / related ─────────────────────────────────────────────────────────

export interface NewsItem {
  id: string;
  title: string;
  source: string;
  tier: SourceTier;
  publishedAt: string;
  url: string;
  topic: string;
}

export interface RelatedInfo {
  id: string;
  kind: 'history' | 'nearby' | 'event' | 'hours' | 'crowd' | 'official';
  title: string;
  detail?: string;
}

// ─── Navigation ─────────────────────────────────────────────────────────────

export interface NavTarget {
  id: string;
  name: string;
  kind: PlaceInfo['kind'];
  lat: number;
  lon: number;
  /** Absolute bearing from the user, degrees clockwise from north. */
  bearingDeg: number;
  distanceM: number;
  eta: { walkMin: number; bikeMin: number; carMin: number };
}

// ─── Hazards ────────────────────────────────────────────────────────────────

export type HazardKind = 'vehicle' | 'obstacle' | 'step' | 'construction' | 'fire' | 'smoke' | 'restricted';

export interface Hazard {
  id: string;
  kind: HazardKind;
  severity: 'info' | 'warn' | 'critical';
  message: string;
  bbox?: BBox;
}

// ─── Memory ─────────────────────────────────────────────────────────────────

export interface MemoryItem {
  id: string;
  kind: 'photo' | 'video';
  createdAt: string;
  /** Small JPEG data URL used by the HUD. The full-resolution blob is stored separately. */
  thumbnail: string;
  tags: string[];
  entities: string[];
  place?: string;
  scene?: string;
  timeOfDay?: TimeOfDay;
  lat?: number;
  lon?: number;
  caption?: string;
}

export interface MemoryQuery {
  text: string;
  from?: Date;
  to?: Date;
  terms: string[];
  timeOfDay?: TimeOfDay[];
  nearHere?: boolean;
}

export interface MemoryHit {
  item: MemoryItem;
  score: number;
  reasons: string[];
}

// ─── Conversation ───────────────────────────────────────────────────────────

export type IntentKind =
  | 'identify'
  | 'search'
  | 'capture_photo'
  | 'record_start'
  | 'record_stop'
  | 'weather'
  | 'navigate'
  | 'translate'
  | 'ocr'
  | 'memory_search'
  | 'place_info'
  | 'product_info'
  | 'scene'
  | 'lock'
  | 'unlock'
  | 'switch_camera'
  | 'zoom'
  | 'social'
  | 'open_url'
  | 'chat';

export interface Intent {
  kind: IntentKind;
  /** Original utterance. */
  text: string;
  /** Extracted subject / search terms. */
  query?: string;
  /** Free-form parameters, e.g. { zoom: "2" }. */
  params?: Record<string, string>;
  /** True when the utterance refers back to the current focus ("これ", "そこ", "いつできた？"). */
  referential: boolean;
}

export type ChatAttachment =
  | { kind: 'search'; answer: SearchAnswer }
  | { kind: 'weather'; report: WeatherReport }
  | { kind: 'memory'; hits: MemoryHit[] }
  | { kind: 'nav'; target: NavTarget }
  | { kind: 'translation'; items: Translation[] }
  | { kind: 'social'; draft: SocialDraft }
  | { kind: 'link'; url: string; label: string };

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  intent?: IntentKind;
  attachment?: ChatAttachment;
}

// ─── Translation ────────────────────────────────────────────────────────────

export interface Translation {
  id: string;
  source: string;
  target: string;
  sourceLang: string;
  targetLang: string;
  bbox?: BBox;
}

// ─── Social ─────────────────────────────────────────────────────────────────

export type SocialPlatform = 'instagram' | 'linkedin' | 'note';

export interface SocialDraft {
  platform: SocialPlatform;
  caption: string;
  hashtags: string[];
  body?: string;
  reelIdea?: string;
}

// ─── Camera ─────────────────────────────────────────────────────────────────

export type Facing = 'environment' | 'user';

export interface CameraCapabilities {
  zoom?: { min: number; max: number; step: number };
  torch: boolean;
  exposure?: { min: number; max: number; step: number };
  focusModes: string[];
  maxWidth?: number;
  maxHeight?: number;
  maxFps?: number;
  /** Largest still the device can capture via ImageCapture (px). */
  photoWidth?: number;
  photoHeight?: number;
}

export interface CameraSettings {
  facing: Facing;
  zoom: number;
  torch: boolean;
  exposure: number;
  timerSec: 0 | 3 | 10;
  /**
   * Live preview resolution. Kept low on purpose: the preview is for *seeing*
   * (low latency, high fps); stills are taken separately at full sensor res.
   */
  preview: '720p' | '1080p';
  /** Still capture: full sensor resolution via ImageCapture, or a preview frame. */
  photo: 'max' | 'preview';
  fps: 30 | 60;
  stabilization: boolean;
  night: boolean;
}

export type FeedSource = 'camera' | 'demo';
