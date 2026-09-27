import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain ESM shared with the deployable gateway
import { handleLiveToken } from '../../gateway/live-token.mjs';

type Handler = (req: Request, env: Record<string, string>, fetchImpl: typeof fetch) => Promise<Response>;
const handle = handleLiveToken as Handler;

function google(calls: { url: string; init: RequestInit }[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ name: 'auth_tokens/abc' }), { status: 200 });
  }) as unknown as typeof fetch;
}

const req = (headers: Record<string, string> = {}) => new Request('https://gw.example/api/live/token', { method: 'POST', headers });

describe('gateway /live/token', () => {
  it('mints a single-use token with the server-side key and never returns the key', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const res = await handle(req(), { GEMINI_API_KEY: 'secret-key' }, google(calls));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.token).toBe('auth_tokens/abc');
    expect(body.wsUrl).toContain('BidiGenerateContentConstrained');
    expect(JSON.stringify(body)).not.toContain('secret-key');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1alpha/auth_tokens');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
    expect(JSON.parse(calls[0].init.body as string).uses).toBe(1);
  });

  it('rejects foreign origins, missing access codes and missing keys', async () => {
    const f = google([]);
    expect((await handle(req({ origin: 'https://evil.example' }), { GEMINI_API_KEY: 'k' }, f)).status).toBe(403);
    const allowed = { GEMINI_API_KEY: 'k', FRIDAY_ALLOWED_ORIGINS: 'https://me.github.io' };
    const ok = await handle(req({ origin: 'https://me.github.io' }), allowed, f);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://me.github.io');
    expect((await handle(req(), { GEMINI_API_KEY: 'k', FRIDAY_ACCESS_CODE: 'c0de' }, f)).status).toBe(401);
    expect((await handle(req({ 'x-friday-access': 'c0de' }), { GEMINI_API_KEY: 'k', FRIDAY_ACCESS_CODE: 'c0de' }, f)).status).toBe(200);
    expect((await handle(req(), {}, f)).status).toBe(503);
  });
});

// @ts-expect-error — plain ESM shared with the deployable gateway
import { handleVisionAnalyze, parseModelJson } from '../../gateway/vision-analyze.mjs';

describe('gateway /vision/analyze (gemini-3.8-flash)', () => {
  const handleV = handleVisionAnalyze as Handler;
  const post = (body: unknown) => new Request('https://gw.example/api/vision/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const img = 'data:image/jpeg;base64,/9j/AAAA';

  it('sends the crop with JSON output and falls back when a config field is unsupported', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const b = JSON.parse(init.body as string);
      bodies.push(b);
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
      if (b.generationConfig.mediaResolution) return new Response('Invalid JSON payload: unknown field mediaResolution', { status: 400 });
      const out = { candidates: [{ name: 'Apple MacBook Air 13-inch', brand: 'Apple', confidence: 0.91 }], visible_text: ['MacBook Air'] };
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(out) + '\n```' }] } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await handleV(post({ image: img, label: 'laptop', category: 'computer', ocr: ['MacBook Air'], area: '東京都渋谷区' }), { GEMINI_API_KEY: 'k' }, f);
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.result.candidates[0].name).toBe('Apple MacBook Air 13-inch');
    expect(bodies).toHaveLength(2);
    const parts = (bodies[1].contents as { parts: Record<string, unknown>[] }[])[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: '/9j/AAAA' } });
    expect(String(parts[1].text)).toContain('東京都渋谷区');
    expect((bodies[1].generationConfig as Record<string, unknown>).responseMimeType).toBe('application/json');
  });

  it('reports readiness and rejects bad input without calling Google', async () => {
    const never = (() => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    const ready = await handleV(new Request('https://gw.example/api/vision/analyze'), { GEMINI_API_KEY: 'k' }, never);
    expect(await ready.json()).toEqual({ ready: true, model: 'gemini-3.8-flash' });
    const notReady = await handleV(new Request('https://gw.example/api/vision/analyze'), {}, never);
    expect((await notReady.json()).ready).toBe(false);
    expect((await handleV(post({ image: 'nope' }), { GEMINI_API_KEY: 'k' }, never)).status).toBe(400);
    expect(parseModelJson('noise {"candidates":[]} tail')).toEqual({ candidates: [] });
  });
});
