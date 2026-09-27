/**
 * Service wiring configuration.
 *
 * Resolution order (highest wins):
 *   1. Runtime overrides saved from the in-app SYSTEM sheet (localStorage)
 *   2. VITE_SERVICE_<NAME>
 *   3. VITE_FRIDAY_MODE
 *   4. "mock"
 */

export type ServiceName =
  | 'vision'
  | 'llm'
  | 'search'
  | 'weather'
  | 'news'
  | 'places'
  | 'translate'
  | 'voice'
  | 'location'
  | 'memory';

export type ServiceMode = 'mock' | 'real' | 'ondevice' | 'live';

export const SERVICE_NAMES: ServiceName[] = [
  'vision',
  'llm',
  'search',
  'weather',
  'news',
  'places',
  'translate',
  'voice',
  'location',
  'memory',
];

/** Which modes each service can run in. */
export const SERVICE_MODES: Record<ServiceName, ServiceMode[]> = {
  vision: ['mock', 'ondevice', 'real', 'live'],
  llm: ['mock', 'real'],
  search: ['mock', 'real'],
  weather: ['mock', 'real'],
  news: ['mock', 'real'],
  places: ['mock', 'real'],
  translate: ['mock', 'real'],
  voice: ['mock', 'real'],
  location: ['mock', 'real'],
  memory: ['mock', 'real'],
};

export const SERVICE_DESCRIPTIONS: Record<ServiceName, string> = {
  vision: 'LOCAL: 端末内検出 · CLOUD: 端末内検出 + クラウド識別 · LIVE: 端末内検出 + Gemini Live（識別・会話）',
  llm: 'Conversation & reasoning',
  search: 'Web search → rank → summarize',
  weather: 'Open-Meteo（キー不要）· カメラ使用中は常に実データ',
  news: 'Contextual news feed',
  places: 'Places / POI / navigation',
  translate: 'Machine translation',
  voice: 'Web Speech STT / TTS',
  location: 'GPS + コンパス · カメラ使用中は常に実際の現在地（デモ映像のみ台場）',
  memory: 'IndexedDB photo memory',
};

/**
 * Defaults when nothing is configured: everything runs on mock data except
 * voice, which uses the browser's free Web Speech API when available (and
 * falls back to text input otherwise).
 */
const DEFAULT_MODES: Record<ServiceName, ServiceMode> = {
  vision: 'mock',
  llm: 'mock',
  search: 'mock',
  weather: 'mock',
  news: 'mock',
  places: 'mock',
  translate: 'mock',
  voice: 'real',
  location: 'mock',
  memory: 'mock',
};

const OVERRIDE_KEY = 'friday.serviceModes';

type Env = Record<string, string | undefined>;

function env(): Env {
  try {
    return (import.meta as unknown as { env?: Env }).env ?? {};
  } catch {
    return {};
  }
}

function readOverrides(): Partial<Record<ServiceName, ServiceMode>> {
  try {
    const raw = globalThis.localStorage?.getItem(OVERRIDE_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<ServiceName, ServiceMode>>) : {};
  } catch {
    return {};
  }
}

/** Did the user pick this service's mode themselves (SYSTEM sheet)? */
export function hasOverride(name: ServiceName): boolean {
  return readOverrides()[name] !== undefined;
}

export function saveOverrides(modes: Partial<Record<ServiceName, ServiceMode>>): void {
  try {
    globalThis.localStorage?.setItem(OVERRIDE_KEY, JSON.stringify(modes));
  } catch {
    /* storage unavailable — runtime-only override */
  }
}

function coerce(name: ServiceName, value: string | undefined): ServiceMode | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase() as ServiceMode;
  return SERVICE_MODES[name].includes(v) ? v : undefined;
}

export function resolveServiceModes(): Record<ServiceName, ServiceMode> {
  const e = env();
  const overrides = readOverrides();
  const global = e.VITE_FRIDAY_MODE === 'real' ? 'real' : e.VITE_FRIDAY_MODE === 'mock' ? 'mock' : undefined;
  const out = {} as Record<ServiceName, ServiceMode>;
  for (const name of SERVICE_NAMES) {
    out[name] =
      coerce(name, overrides[name]) ??
      coerce(name, e[`VITE_SERVICE_${name.toUpperCase()}`]) ??
      global ??
      DEFAULT_MODES[name];
  }
  return out;
}

const GATEWAY_KEY = 'friday.gateway';

export interface GatewaySettings {
  /** Base URL of the F.R.I.D.A.Y. gateway (holds provider keys), e.g. https://my-gateway.vercel.app/api */
  url: string;
  /** Optional access code the gateway requires (not a provider API key). */
  accessCode: string;
}

/** Gateway set in the SYSTEM sheet (runtime) — wins over the build-time VITE_FRIDAY_API_BASE. */
export function gatewaySettings(): GatewaySettings {
  try {
    const raw = globalThis.localStorage?.getItem(GATEWAY_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<GatewaySettings>) : {};
    return { url: v.url?.trim() ?? '', accessCode: v.accessCode ?? '' };
  } catch {
    return { url: '', accessCode: '' };
  }
}

export function saveGatewaySettings(v: GatewaySettings): void {
  try {
    globalThis.localStorage?.setItem(GATEWAY_KEY, JSON.stringify({ url: v.url.trim().replace(/\/$/, ''), accessCode: v.accessCode }));
  } catch {
    /* storage unavailable */
  }
}

export function apiBase(): string {
  return gatewaySettings().url || env().VITE_FRIDAY_API_BASE || '/api';
}

/** Headers every gateway call carries (the optional access code). */
export function gatewayHeaders(): Record<string, string> {
  const code = gatewaySettings().accessCode;
  return code ? { 'x-friday-access': code } : {};
}
