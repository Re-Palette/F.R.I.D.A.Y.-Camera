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

export type ServiceMode = 'mock' | 'real' | 'ondevice';

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
  vision: ['mock', 'ondevice', 'real'],
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
  vision: 'Object detection / scene / OCR',
  llm: 'Conversation & reasoning',
  search: 'Web search → rank → summarize',
  weather: 'Open-Meteo (no key)',
  news: 'Contextual news feed',
  places: 'Places / POI / navigation',
  translate: 'Machine translation',
  voice: 'Web Speech STT / TTS',
  location: 'GPS + compass',
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

export function apiBase(): string {
  return env().VITE_FRIDAY_API_BASE ?? '/api';
}
