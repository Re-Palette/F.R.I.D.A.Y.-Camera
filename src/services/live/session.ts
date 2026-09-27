/**
 * GeminiLiveSession — a thin, dependency-free client for the Gemini Live API
 * (bidirectional WebSocket, `BidiGenerateContent`).
 *
 *   browser ──(ephemeral token from our gateway)──▶ wss://generativelanguage.googleapis.com/…
 *     setup → setupComplete
 *     realtimeInput { video | audio | text | audioStreamEnd }   (camera frames, mic PCM, text)
 *     toolResponse  { functionResponses }
 *   ◀── serverContent { modelTurn(audio) · outputTranscription · inputTranscription · interrupted · turnComplete }
 *       toolCall · toolCallCancellation · goAway · sessionResumptionUpdate
 *
 * Connections are recycled transparently: on `goAway` or an unexpected close
 * the session reconnects with a fresh token and the latest resumption
 * handle, so the conversation (and what the model has seen) survives.
 */
import { Emitter } from '../../core/events';

export interface LiveToken {
  token: string;
  /** WebSocket endpoint for this token (the gateway decides the API version). */
  wsUrl: string;
  model: string;
  expiresAt?: string;
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  behavior?: 'BLOCKING' | 'NON_BLOCKING';
  parameters?: Record<string, unknown>;
}

export interface LiveSetupOptions {
  systemInstruction: string;
  tools?: FunctionDeclaration[];
  /** 'MEDIA_RESOLUTION_LOW' ≈ 64 tokens per frame. */
  mediaResolution?: 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH';
  voiceName?: string;
}

export interface FunctionCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface FunctionResponse {
  id: string;
  name: string;
  response: Record<string, unknown>;
  scheduling?: 'SILENT' | 'WHEN_IDLE' | 'INTERRUPT';
}

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface LiveEvents extends Record<string, unknown> {
  status: { status: LiveStatus; detail?: string };
  /** Base64 PCM16 mono @ 24 kHz. */
  audio: string;
  /** Streaming transcript of what the model says. */
  outputText: string;
  /** What the user said (final chunks). */
  inputText: string;
  interrupted: void;
  turnComplete: void;
  toolCall: FunctionCall[];
  toolCancel: string[];
  usage: { total?: number };
}

type WSLike = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((e: Event) => void) | null;
  onmessage: ((e: MessageEvent) => void) | null;
  onclose: ((e: CloseEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
};

export interface LiveSessionOptions {
  getToken: () => Promise<LiveToken>;
  setup: LiveSetupOptions;
  /** For tests. */
  createSocket?: (url: string) => WSLike;
  /** Give up after this many consecutive failed connects. */
  maxRetries?: number;
}

/** Build the first message of a connection (exported for tests). */
export function setupMessage(model: string, o: LiveSetupOptions, resumeHandle?: string | null) {
  return {
    setup: {
      model: model.startsWith('models/') ? model : `models/${model}`,
      generationConfig: {
        // Current Live models answer with audio only; text comes from the transcription.
        responseModalities: ['AUDIO'],
        ...(o.mediaResolution ? { mediaResolution: o.mediaResolution } : {}),
        ...(o.voiceName ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voiceName } } } } : {}),
      },
      systemInstruction: { parts: [{ text: o.systemInstruction }] },
      ...(o.tools?.length ? { tools: [{ functionDeclarations: o.tools }] } : {}),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      // Audio+video sessions are short without compression; keep a sliding window instead.
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
    },
  };
}

/** Close reasons that retrying can't fix → a user-facing explanation (null = retry). */
export function fatalReason(reason: string): string | null {
  const r = reason.toLowerCase();
  if (/credit|prepay|billing|payment/.test(r)) return 'Gemini の残高（前払いクレジット）が不足しています。AI Studio（ai.studio/projects）でチャージしてください';
  if (/quota|rate limit|resource.?exhausted/.test(r)) return 'Gemini の利用上限に達しました。しばらく待つか、AI Studio で上限・お支払いを確認してください';
  if (/api key|api_key|permission|unauthori[sz]ed|forbidden|not allowed/.test(r)) return 'Gemini の API キーが無効か、権限がありません。Vercel の GEMINI_API_KEY を確認してください';
  if (/model.*not (found|supported)|not found.*model/.test(r)) return 'Gemini Live のモデルが見つかりません（GEMINI_LIVE_MODEL を確認してください）';
  return null;
}

async function decode(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data);
}

export class GeminiLiveSession {
  readonly events = new Emitter<LiveEvents>();
  status: LiveStatus = 'idle';
  model = '';
  private ws: WSLike | null = null;
  private wanted = false;
  private resumeHandle: string | null = null;
  private failures = 0;
  private ready: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly opts: LiveSessionOptions) {}

  get open(): boolean {
    return this.status === 'open';
  }

  /** Connect (idempotent). Resolves on setupComplete. */
  connect(): Promise<void> {
    this.wanted = true;
    if (this.ready && (this.status === 'open' || this.status === 'connecting' || this.status === 'reconnecting')) return this.ready;
    this.ready = this.dial(false);
    return this.ready;
  }

  close() {
    this.wanted = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'client closed');
    } catch {
      /* already closed */
    }
    this.setStatus('closed');
    this.ready = null;
  }

  sendVideo(jpegBase64: string) {
    this.send({ realtimeInput: { video: { data: jpegBase64, mimeType: 'image/jpeg' } } });
  }

  sendAudio(pcm16Base64: string) {
    this.send({ realtimeInput: { audio: { data: pcm16Base64, mimeType: 'audio/pcm;rate=16000' } } });
  }

  audioStreamEnd() {
    this.send({ realtimeInput: { audioStreamEnd: true } });
  }

  sendText(text: string) {
    this.send({ realtimeInput: { text } });
  }

  /**
   * Inject context (current HUD target, place…) without asking for a reply:
   * a client-content turn with `turnComplete: false` is held until the next input.
   */
  sendContext(text: string) {
    this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false } });
  }

  sendToolResponse(responses: FunctionResponse[]) {
    this.send({ toolResponse: { functionResponses: responses } });
  }

  private send(msg: unknown): boolean {
    if (!this.ws || this.status !== 'open' || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private setStatus(status: LiveStatus, detail?: string) {
    this.status = status;
    this.events.emit('status', { status, detail });
  }

  private async dial(resuming: boolean): Promise<void> {
    this.setStatus(resuming ? 'reconnecting' : 'connecting');
    let tok: LiveToken;
    try {
      tok = await this.opts.getToken();
    } catch (e) {
      this.fail(`token: ${(e as Error).message}`);
      throw e;
    }
    if (!this.wanted) return;
    this.model = tok.model;
    const url = `${tok.wsUrl}${tok.wsUrl.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(tok.token)}`;
    const ws = this.opts.createSocket ? this.opts.createSocket(url) : (new WebSocket(url) as unknown as WSLike);
    this.ws = ws;
    return new Promise<void>((resolve, reject) => {
      let setupDone = false;
      ws.onopen = () => ws.send(JSON.stringify(setupMessage(tok.model, this.opts.setup, this.resumeHandle)));
      ws.onmessage = (e) => {
        void decode(e.data).then((raw) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(raw);
          } catch {
            return;
          }
          if (msg.setupComplete && !setupDone) {
            setupDone = true;
            this.failures = 0;
            this.setStatus('open');
            resolve();
          }
          this.dispatch(msg);
        });
      };
      ws.onerror = () => undefined; // details arrive with onclose
      ws.onclose = (e) => {
        if (this.ws !== ws) return; // superseded
        this.ws = null;
        if (!setupDone) reject(new Error(`closed before setup (${e.code} ${e.reason || ''})`.trim()));
        if (!this.wanted) return this.setStatus('closed');
        // Billing / key / permission problems won't fix themselves: say so once, in plain words.
        const fatal = fatalReason(e.reason || '');
        if (fatal) return this.fail(fatal);
        // 1000 from the server after goAway, 1011 on errors, 1006 on network loss: resume.
        this.scheduleReconnect(`${e.code} ${e.reason || ''}`.trim());
      };
    });
  }

  private scheduleReconnect(reason: string) {
    this.failures++;
    if (this.failures > (this.opts.maxRetries ?? 5)) return this.fail(`gave up after ${this.failures - 1} retries (${reason})`);
    const delay = Math.min(8000, 250 * 2 ** (this.failures - 1));
    this.setStatus('reconnecting', reason);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.wanted) this.ready = this.dial(true).catch(() => undefined);
    }, delay);
  }

  private fail(detail: string) {
    this.setStatus('error', detail);
    this.wanted = false;
  }

  private dispatch(msg: Record<string, unknown>) {
    const sc = msg.serverContent as
      | {
          modelTurn?: { parts?: { inlineData?: { data?: string; mimeType?: string }; text?: string }[] };
          outputTranscription?: { text?: string };
          inputTranscription?: { text?: string };
          interrupted?: boolean;
          turnComplete?: boolean;
        }
      | undefined;
    if (sc) {
      // One event can carry several parts (audio + transcript): handle all of them.
      for (const p of sc.modelTurn?.parts ?? []) {
        if (p.inlineData?.data && p.inlineData.mimeType?.startsWith('audio/')) this.events.emit('audio', p.inlineData.data);
        else if (p.text) this.events.emit('outputText', p.text);
      }
      if (sc.outputTranscription?.text) this.events.emit('outputText', sc.outputTranscription.text);
      if (sc.inputTranscription?.text) this.events.emit('inputText', sc.inputTranscription.text);
      if (sc.interrupted) this.events.emit('interrupted', undefined);
      if (sc.turnComplete) this.events.emit('turnComplete', undefined);
    }
    const tc = msg.toolCall as { functionCalls?: { id?: string; name?: string; args?: Record<string, unknown> }[] } | undefined;
    if (tc?.functionCalls?.length) {
      this.events.emit(
        'toolCall',
        tc.functionCalls.map((f) => ({ id: f.id ?? '', name: f.name ?? '', args: f.args ?? {} })),
      );
    }
    const cancel = msg.toolCallCancellation as { ids?: string[] } | undefined;
    if (cancel?.ids?.length) this.events.emit('toolCancel', cancel.ids);
    const ru = msg.sessionResumptionUpdate as { newHandle?: string; resumable?: boolean } | undefined;
    if (ru?.resumable && ru.newHandle) this.resumeHandle = ru.newHandle;
    if (msg.goAway && this.wanted && this.ws) {
      // The server will drop this connection soon: move to a fresh one now, resuming state.
      const old = this.ws;
      this.ws = null;
      this.ready = this.dial(true).catch(() => undefined);
      setTimeout(() => {
        try {
          old.close(1000, 'goAway');
        } catch {
          /* ignore */
        }
      }, 1500);
    }
    const um = msg.usageMetadata as { totalTokenCount?: number } | undefined;
    if (um) this.events.emit('usage', { total: um.totalTokenCount });
  }
}
