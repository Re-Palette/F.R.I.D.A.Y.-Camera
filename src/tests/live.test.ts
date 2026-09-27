import { describe, expect, it } from 'vitest';
import { LiveAgent } from '../services/live/agent';
import { GeminiLiveSession, setupMessage } from '../services/live/session';
import { parseIdentification } from '../services/live/tools';

/** In-memory stand-in for the Live WebSocket, driven by a tiny scripted server. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  constructor(
    readonly url: string,
    private readonly server: (m: Record<string, unknown>, s: FakeSocket) => void,
  ) {
    FakeSocket.all.push(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    }, 0);
  }
  send(raw: string) {
    const m = JSON.parse(raw);
    this.sent.push(m);
    this.server(m, this);
  }
  /** Server → client (the real API sends binary frames). */
  push(m: unknown, binary = false) {
    const data = binary ? new TextEncoder().encode(JSON.stringify(m)).buffer : JSON.stringify(m);
    setTimeout(() => this.onmessage?.({ data } as MessageEvent), 0);
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    setTimeout(() => this.onclose?.({ code, reason } as CloseEvent), 0);
  }
}

const token = async () => ({ token: 'auth_tokens/t', wsUrl: 'wss://example.invalid/ws', model: 'gemini-3.8-live' });
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe('Gemini Live session', () => {
  it('sends a Live setup: audio out + transcripts + compression + resumption', () => {
    const m = setupMessage('gemini-3.8-live', { systemInstruction: 'x', tools: [{ name: 'f', description: 'd' }] }, 'h1').setup;
    expect(m.model).toBe('models/gemini-3.8-live');
    expect(m.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(m.outputAudioTranscription).toEqual({});
    expect(m.contextWindowCompression).toEqual({ slidingWindow: {} });
    expect(m.sessionResumption).toEqual({ handle: 'h1' });
    expect(m.tools).toEqual([{ functionDeclarations: [{ name: 'f', description: 'd' }] }]);
  });

  it('connects with the token, decodes binary frames and resumes after goAway', async () => {
    FakeSocket.all = [];
    const s = new GeminiLiveSession({
      getToken: token,
      setup: { systemInstruction: 'x' },
      createSocket: (url) =>
        new FakeSocket(url, (m, sock) => {
          if (m.setup) {
            sock.push({ setupComplete: {} }, true);
            sock.push({ sessionResumptionUpdate: { newHandle: `h${FakeSocket.all.length}`, resumable: true } });
          }
        }) as never,
    });
    const texts: string[] = [];
    s.events.on('outputText', (t) => texts.push(t));
    await s.connect();
    expect(FakeSocket.all[0].url).toBe('wss://example.invalid/ws?access_token=auth_tokens%2Ft');
    FakeSocket.all[0].push({ serverContent: { outputTranscription: { text: 'こんにちは' } } }, true);
    await tick();
    expect(texts).toEqual(['こんにちは']);
    FakeSocket.all[0].push({ goAway: { timeLeft: '5s' } });
    await tick(20);
    expect(FakeSocket.all).toHaveLength(2);
    expect((FakeSocket.all[1].sent[0].setup as { sessionResumption: unknown }).sessionResumption).toEqual({ handle: 'h1' });
    expect(s.status).toBe('open');
    s.close();
  });
});

describe('Live identification', () => {
  it('parses tool answers defensively and drops plates / people', () => {
    const r = parseIdentification({
      target_id: 'T1',
      candidates: [{ name: 'Tesla Model 3', confidence: 1.4, brand: 'Tesla' }, { name: '', confidence: 0.5 }],
      visible_text: ['TESLA', '品川 300 さ 12-34'],
    })!;
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].confidence).toBeLessThanOrEqual(0.97);
    expect(r.text).toEqual(['TESLA']);
    const person = parseIdentification({ target_id: 'T2', is_person: true, candidates: [{ name: 'Someone', confidence: 0.9 }] })!;
    expect(person.candidates).toEqual([]);
    expect(parseIdentification({ candidates: [] })).toBeNull();
  });

  it('pre-connects the conversation and streams nothing while idle', async () => {
    FakeSocket.all = [];
    const agent = new LiveAgent(() => ({ frame: {} as never, w: 1280, h: 720 }), token, (url) =>
      new FakeSocket(url, (m, sock) => {
        if (m.setup) sock.push({ setupComplete: {} });
      }) as never,
    );
    await agent.start();
    expect(agent.status).toBe('open');
    await tick(50);
    const sock = FakeSocket.all[0];
    expect((sock.sent[0].setup as { tools: { functionDeclarations: { name: string }[] }[] }).tools[0].functionDeclarations.map((f) => f.name)).toEqual(['app_action']);
    expect(sock.sent.filter((m) => m.realtimeInput)).toHaveLength(0); // no frames, no audio while idle
    agent.stop();
  });
});

describe('Live errors', () => {
  it('stops retrying and explains billing / key problems', async () => {
    const { fatalReason } = await import('../services/live/session');
    expect(fatalReason('Your prepayment credits are depleted. Please go to AI Studio')).toContain('残高');
    expect(fatalReason('API key not valid')).toContain('API キー');
    expect(fatalReason('Internal error')).toBeNull();
  });
});
