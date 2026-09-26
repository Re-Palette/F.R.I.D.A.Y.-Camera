/**
 * Gemini Live — ephemeral token minting (the only thing the gateway does for Live).
 *
 * The API key never reaches the browser: the gateway exchanges it for a
 * single-use, short-lived token, and the browser opens the Live WebSocket
 * with that token directly (lowest latency — frames and audio don't hop
 * through the gateway).
 *
 * Environment:
 *   GEMINI_API_KEY        required
 *   GEMINI_LIVE_MODEL     default "gemini-3.8-live"
 *   FRIDAY_ALLOWED_ORIGINS comma-separated origins allowed to mint tokens (CORS);
 *                         empty = same-origin / dev only
 *   FRIDAY_ACCESS_CODE    optional shared code the app sends as `x-friday-access`
 */

export const DEFAULT_LIVE_MODEL = 'gemini-3.8-live';
const API = 'https://generativelanguage.googleapis.com';
const WS = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained';

/** POST /v1alpha/auth_tokens — one session, must start within 60 s, valid 30 min. */
export async function createLiveToken({ apiKey, model = DEFAULT_LIVE_MODEL, fetchImpl = fetch, now = Date.now() }) {
  const expireTime = new Date(now + 30 * 60_000).toISOString();
  const res = await fetchImpl(`${API}/v1alpha/auth_tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ uses: 1, expireTime, newSessionExpireTime: new Date(now + 60_000).toISOString() }),
  });
  if (!res.ok) throw new Error(`auth_tokens → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  if (!json.name) throw new Error('auth_tokens: no token in response');
  return { token: json.name, wsUrl: WS, model, expiresAt: expireTime };
}

function cors(origin, allowed) {
  const ok = !!origin && allowed.includes(origin);
  return ok
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-friday-access', 'Access-Control-Max-Age': '600', Vary: 'Origin' }
    : {};
}

/**
 * Web-standard handler (Request → Response): works on Vercel Edge, Cloudflare
 * Workers, Deno, and in the Vite dev/preview middleware.
 */
export async function handleLiveToken(request, env, fetchImpl = fetch) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = (env.FRIDAY_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin, allowed) };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers });

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  // Cross-origin callers must be allow-listed; same-origin requests carry no Origin or a matching one.
  const self = new URL(request.url).origin;
  if (origin && origin !== self && !allowed.includes(origin)) return json(403, { error: 'origin not allowed' });
  if (env.FRIDAY_ACCESS_CODE && request.headers.get('x-friday-access') !== env.FRIDAY_ACCESS_CODE) return json(401, { error: 'access code required' });
  if (!env.GEMINI_API_KEY) return json(503, { error: 'GEMINI_API_KEY is not configured on the gateway' });
  try {
    return json(200, await createLiveToken({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_LIVE_MODEL || DEFAULT_LIVE_MODEL, fetchImpl }));
  } catch (e) {
    return json(502, { error: String(e.message ?? e) });
  }
}
