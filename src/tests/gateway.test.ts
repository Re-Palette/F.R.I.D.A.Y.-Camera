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
