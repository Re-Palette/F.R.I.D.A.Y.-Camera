/**
 * LiveAgent — F.R.I.D.A.Y.'s connection to Gemini Live, as two sessions:
 *
 *   IDENTIFICATION session (always warm, never heard)
 *     target crop + "[HUD] identify T3" ──▶  ◀── report_identification(…) → HUD card
 *     One request in flight at a time (a new input would interrupt the current turn);
 *     any audio it produces is discarded.
 *
 *   CONVERSATION session (opened on the first question / mic, closed when idle)
 *     camera frames (1 / 1–2 s, ≤768 px) · mic PCM 16 kHz · typed questions ──▶
 *     ◀── spoken answer (24 kHz) + transcript · app_action(take_photo …)
 *
 * Keeping them apart means identification never talks over (or gets mixed
 * into) the conversation, and an idle camera streams nothing.
 */
import { apiBase, gatewayHeaders } from '../../core/config';
import { Emitter } from '../../core/events';
import type { FrameSource } from '../contracts';
import { MicStreamer, PcmPlayer, bytesToBase64 } from './audio';
import { GeminiLiveSession, type FunctionCall, type LiveSessionOptions, type LiveStatus, type LiveToken } from './session';
import { APP_ACTION, CONVERSATION_PROMPT, IDENTIFY_PROMPT, REPORT_IDENTIFICATION, identifyPrompt, parseIdentification, type LiveIdentification } from './tools';

export interface LiveAgentEvents extends Record<string, unknown> {
  /** Identification session status (the one that must be up for the HUD). */
  status: { status: LiveStatus; detail?: string };
  /** What the user is saying (accumulating transcript). */
  userPartial: string;
  userFinal: string;
  /** What the model is saying (accumulating transcript). */
  assistantPartial: string;
  assistantFinal: string;
  speaking: boolean;
  mic: boolean;
  level: number;
  action: { action: string; targetId?: string };
}

export async function fetchLiveToken(): Promise<LiveToken> {
  const res = await fetch(`${apiBase()}/live/token`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...gatewayHeaders() } });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* not JSON */
    }
    throw new Error(`/live/token → HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as LiveToken;
}

async function encodeJpeg(src: CanvasImageSource | ImageBitmap, w: number, h: number, maxSide: number, quality: number): Promise<string | null> {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * k));
  const ch = Math.max(2, Math.round(h * k));
  const canvas = new OffscreenCanvas(cw, ch);
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.drawImage(src, 0, 0, cw, ch);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

interface Pending {
  targetId: string;
  image: string | null;
  prompt: string;
  timeoutMs: number;
  resolve: (r: LiveIdentification | null) => void;
  timer?: ReturnType<typeof setTimeout>;
  done: boolean;
  tries: number;
}

const CONVO_IDLE_MS = 120_000;

export class LiveAgent {
  readonly events = new Emitter<LiveAgentEvents>();
  readonly idSession: GeminiLiveSession;
  readonly convo: GeminiLiveSession;
  private mic: MicStreamer;
  private player: PcmPlayer;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private encoding = false;
  private running = false;
  // identification queue: one request in flight
  private queue: Pending[] = [];
  private inflight: Pending | null = null;
  /** The answered turn hasn't sent turnComplete yet: the next request waits (≤1.5 s). */
  private turnOpen = false;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  // conversation
  private lastInteraction = 0;
  private answering = false;
  private userText = '';
  private modelText = '';
  private lastFrameAt = 0;

  constructor(
    private readonly frameSource: () => { frame: FrameSource; w: number; h: number } | null,
    getToken: () => Promise<LiveToken> = fetchLiveToken,
    createSocket?: LiveSessionOptions['createSocket'],
  ) {
    this.idSession = new GeminiLiveSession({
      getToken,
      createSocket,
      setup: { systemInstruction: IDENTIFY_PROMPT, tools: [REPORT_IDENTIFICATION], mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' },
    });
    this.convo = new GeminiLiveSession({
      getToken,
      createSocket,
      setup: { systemInstruction: CONVERSATION_PROMPT, tools: [APP_ACTION], mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' },
    });
    this.player = new PcmPlayer((p) => this.events.emit('speaking', p));
    this.mic = new MicStreamer((pcm, level) => {
      this.convo.sendAudio(pcm);
      this.lastInteraction = performance.now();
      this.events.emit('level', level);
    });
    this.wireIdentification();
    this.wireConversation();
  }

  get status(): LiveStatus {
    return this.idSession.status;
  }

  get micOn(): boolean {
    return this.mic.active;
  }

  /** Warm the identification session (the conversation one opens on first use). */
  start(): Promise<void> {
    this.running = true;
    return this.idSession.connect();
  }

  stop() {
    this.running = false;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.stopMic();
    this.player.close();
    for (const p of [...this.queue, ...(this.inflight ? [this.inflight] : [])]) this.settle(p, null);
    this.queue = [];
    this.idSession.close();
    this.convo.close();
  }

  // ─── Conversation ────────────────────────────────────────────────────────

  /** Typed (or locally recognised) question → spoken + transcribed answer. */
  async ask(text: string, hudContext?: string) {
    this.player.unlock();
    await this.openConversation();
    this.interruptPlayback();
    this.userText = '';
    this.answering = true;
    this.convo.sendText(hudContext ? `${text}\n${hudContext}` : text);
  }

  async toggleMic(): Promise<boolean> {
    if (this.mic.active) {
      this.stopMic();
      return false;
    }
    this.player.unlock();
    await this.openConversation();
    await this.mic.start();
    this.events.emit('mic', true);
    return true;
  }

  stopMic() {
    if (!this.mic.active) return;
    this.mic.stop();
    this.convo.audioStreamEnd();
    this.events.emit('mic', false);
  }

  /** Local barge-in (tap): stop talking now. */
  interruptPlayback() {
    this.player.clear();
    if (this.modelText) this.events.emit('assistantFinal', this.modelText);
    this.modelText = '';
  }

  /** Background facts for the conversation (current target) — never triggers a reply. */
  setContext(text: string) {
    if (this.convo.open) this.convo.sendContext(text);
  }

  private async openConversation() {
    this.lastInteraction = performance.now();
    await this.convo.connect();
    // Show the model what the camera sees right now, then keep it up to date.
    this.lastFrameAt = 0;
    this.scheduleFrame(0);
  }

  // ─── Identification ──────────────────────────────────────────────────────

  /** Identify one target through the identification session. Null on timeout. */
  async identify(targetId: string, crop: ImageBitmap | null, categoryJa: string, bbox: { x: number; y: number; w: number; h: number }, timeoutMs = 9000): Promise<LiveIdentification | null> {
    const image = crop ? await encodeJpeg(crop, crop.width, crop.height, 512, 0.8) : null;
    await this.idSession.connect();
    return new Promise((resolve) => {
      this.queue.push({ targetId, image, prompt: identifyPrompt(targetId, categoryJa, bbox), timeoutMs, resolve, done: false, tries: 0 });
      this.pump();
    });
  }

  /** One request per turn: a new input would interrupt the model's current turn. */
  private pump(): void {
    if (this.inflight || this.turnOpen || !this.queue.length || !this.idSession.open) return;
    const p = this.queue.shift()!;
    if (p.done) return this.pump();
    this.inflight = p;
    p.tries++;
    clearTimeout(p.timer);
    p.timer = setTimeout(() => this.settle(p, null), p.timeoutMs);
    if (p.image) this.idSession.sendVideo(p.image);
    this.idSession.sendText(p.prompt);
  }

  private settle(p: Pending, r: LiveIdentification | null) {
    if (p.done) return;
    p.done = true;
    clearTimeout(p.timer);
    this.queue = this.queue.filter((x) => x !== p);
    if (this.inflight === p) {
      this.inflight = null;
      if (r) {
        // Answered via the tool while the turn may still be running: let it end first,
        // so the next request neither interrupts it nor inherits its turnComplete.
        this.turnOpen = true;
        if (this.turnTimer) clearTimeout(this.turnTimer);
        this.turnTimer = setTimeout(() => this.endTurn(), 1500);
      }
    }
    p.resolve(r);
    this.pump();
  }

  private endTurn() {
    this.turnOpen = false;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.pump();
  }

  private wireIdentification() {
    const ev = this.idSession.events;
    ev.on('status', (s) => {
      this.events.emit('status', s);
      if (s.status === 'open') this.pump();
      if (s.status === 'error') for (const p of [...this.queue, ...(this.inflight ? [this.inflight] : [])]) this.settle(p, null);
    });
    ev.on('toolCall', (calls) => {
      const responses = calls.map((c) => {
        if (c.name !== 'report_identification') return { id: c.id, name: c.name, response: { error: 'unknown function' }, scheduling: 'SILENT' as const };
        const r = parseIdentification(c.args);
        const p = r ? ([this.inflight, ...this.queue].find((x) => x && x.targetId.toLowerCase() === r.targetId.toLowerCase()) ?? this.inflight) : null;
        if (p && r) this.settle(p, r);
        return { id: c.id, name: c.name, response: { ok: !!r }, scheduling: 'SILENT' as const };
      });
      this.idSession.sendToolResponse(responses);
    });
    // The turn ended without an answer (interrupted, or the model just talked): ask once more.
    ev.on('turnComplete', () => {
      if (this.turnOpen) return this.endTurn();
      const p = this.inflight;
      if (!p) return;
      setTimeout(() => {
        if (p.done || this.inflight !== p) return;
        this.inflight = null;
        if (p.tries < 2) this.queue.unshift(p);
        else this.settle(p, null);
        this.pump();
      }, 600);
    });
    // Audio / transcripts from this session are never played or shown.
  }

  // ─── Conversation session events ─────────────────────────────────────────

  private audible(): boolean {
    // Only while the user is talking to it: no unprompted remarks from a phone in a pocket.
    return this.mic.active || this.answering;
  }

  private wireConversation() {
    const ev = this.convo.events;
    ev.on('status', (s) => {
      if (s.status === 'error' || s.status === 'closed') this.stopMic();
    });
    ev.on('inputText', (t) => {
      this.lastInteraction = performance.now();
      this.answering = true;
      this.userText += t;
      this.events.emit('userPartial', this.userText);
    });
    ev.on('audio', (pcm) => {
      this.flushUser();
      if (this.audible()) this.player.enqueue(pcm);
    });
    ev.on('outputText', (t) => {
      this.flushUser();
      if (!this.audible()) return;
      this.modelText += t;
      this.events.emit('assistantPartial', this.modelText);
    });
    ev.on('interrupted', () => {
      this.player.clear();
      if (this.modelText) this.events.emit('assistantFinal', `${this.modelText}…`);
      this.modelText = '';
    });
    ev.on('turnComplete', () => {
      this.flushUser();
      if (this.modelText) this.events.emit('assistantFinal', this.modelText);
      this.modelText = '';
      this.answering = false;
      this.lastInteraction = performance.now();
    });
    ev.on('toolCall', (calls: FunctionCall[]) => {
      const responses = calls.map((c) => {
        const action = c.name === 'app_action' && typeof c.args.action === 'string' ? c.args.action : '';
        if (action) this.events.emit('action', { action, targetId: typeof c.args.target_id === 'string' ? c.args.target_id : undefined });
        return { id: c.id, name: c.name, response: action ? { ok: true } : { error: 'unknown function' }, scheduling: 'WHEN_IDLE' as const };
      });
      this.convo.sendToolResponse(responses);
    });
  }

  private flushUser() {
    if (!this.userText) return;
    this.events.emit('userFinal', this.userText.trim());
    this.userText = '';
  }

  /**
   * Conversation frames: 1 fps while talking, one every 2 s otherwise, none
   * when hidden; after 2 idle minutes the conversation session is closed.
   */
  private scheduleFrame(delay: number) {
    if (!this.running) return;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = setTimeout(() => void this.sendFrame(), delay);
  }

  private async sendFrame() {
    this.frameTimer = null;
    const now = performance.now();
    if (!this.mic.active && !this.answering && now - this.lastInteraction > CONVO_IDLE_MS) {
      this.convo.close();
      return; // reopened by the next question / mic
    }
    const interval = this.mic.active || this.answering ? 1000 : 2000;
    try {
      const src = this.frameSource();
      const visible = typeof document === 'undefined' || document.visibilityState === 'visible';
      if (src && visible && this.convo.open && !this.encoding && now - this.lastFrameAt >= interval - 50) {
        this.encoding = true;
        const k = Math.min(1, 768 / Math.max(src.w, src.h));
        const bm = await createImageBitmap(src.frame as ImageBitmapSource, { resizeWidth: Math.round(src.w * k), resizeHeight: Math.round(src.h * k) });
        try {
          const jpeg = await encodeJpeg(bm, bm.width, bm.height, 768, 0.7);
          if (jpeg) this.convo.sendVideo(jpeg);
          this.lastFrameAt = performance.now();
        } finally {
          bm.close();
        }
      }
    } catch {
      /* frame not ready — try next tick */
    } finally {
      this.encoding = false;
      this.scheduleFrame(interval);
    }
  }
}
