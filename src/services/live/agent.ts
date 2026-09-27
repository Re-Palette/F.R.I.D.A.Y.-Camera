/**
 * LiveAgent — F.R.I.D.A.Y.'s spoken conversation over Gemini Live.
 *
 *   CONVERSATION session (pre-connected; streams only while you talk)
 *     fresh camera frame + typed question, or mic PCM 16 kHz + 1 fps frames ──▶
 *     ◀── spoken answer (24 kHz) + transcript · app_action(take_photo …)
 *
 * Object identification does NOT go through this socket: a speech model is
 * the wrong tool for reading logos and model numbers. It uses the fast vision
 * model (gemini-3.8-flash) via /vision/analyze — see live/vision.ts.
 */
import { apiBase, gatewayHeaders } from '../../core/config';
import { Emitter } from '../../core/events';
import type { FrameSource } from '../contracts';
import { MicStreamer, PcmPlayer, bytesToBase64 } from './audio';
import { GeminiLiveSession, type FunctionCall, type LiveSessionOptions, type LiveStatus, type LiveToken } from './session';
import { APP_ACTION, CONVERSATION_PROMPT } from './tools';

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

const CONVO_IDLE_MS = 600_000;

export class LiveAgent {
  readonly events = new Emitter<LiveAgentEvents>();
  readonly convo: GeminiLiveSession;
  private mic: MicStreamer;
  private player: PcmPlayer;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private encoding = false;
  private running = false;
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
    this.convo = new GeminiLiveSession({
      getToken,
      createSocket,
      setup: { systemInstruction: CONVERSATION_PROMPT, tools: [APP_ACTION], googleSearch: true, mediaResolution: 'MEDIA_RESOLUTION_MEDIUM' },
    });
    this.player = new PcmPlayer((p) => this.events.emit('speaking', p));
    this.mic = new MicStreamer((pcm, level) => {
      this.convo.sendAudio(pcm);
      this.lastInteraction = performance.now();
      this.events.emit('level', level);
    });
    this.wireConversation();
  }

  /** The conversation session is the one users feel (voice answers). */
  get status(): LiveStatus {
    return this.convo.status;
  }

  get micOn(): boolean {
    return this.mic.active;
  }

  /**
   * Pre-connect the conversation session so the first question is answered
   * without a connection delay. Nothing is streamed until the user talks.
   * (Identification goes through the fast vision model, not this socket.)
   */
  start(): Promise<void> {
    this.running = true;
    this.lastInteraction = performance.now();
    return this.convo.connect();
  }

  stop() {
    this.running = false;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.stopMic();
    this.player.close();
    this.convo.close();
  }

  // ─── Conversation ────────────────────────────────────────────────────────

  /** Typed (or locally recognised) question → spoken + transcribed answer. */
  async ask(text: string, hudContext?: string) {
    this.player.unlock();
    await this.openConversation(); // includes a fresh frame, so "これ" means what's on screen now
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
    // Show the model what the camera sees right now (before the question), then keep it up to date.
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.lastFrameAt = 0;
    await this.sendFrame(true);
  }

  // ─── Conversation session events ─────────────────────────────────────────

  private audible(): boolean {
    // Only while the user is talking to it: no unprompted remarks from a phone in a pocket.
    return this.mic.active || this.answering;
  }

  private wireConversation() {
    const ev = this.convo.events;
    ev.on('status', (s) => {
      this.events.emit('status', s);
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
   * Conversation frames: 1 fps while the user is talking to it, none when
   * idle or hidden (no cost while you just look around). The connection
   * stays warm; after 10 idle minutes it is closed.
   */
  private scheduleFrame(delay: number) {
    if (!this.running) return;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = setTimeout(() => void this.sendFrame(), delay);
  }

  private async sendFrame(force = false) {
    this.frameTimer = null;
    const now = performance.now();
    const talking = this.mic.active || this.answering || now - this.lastInteraction < 8000;
    if (!talking && !force) {
      if (now - this.lastInteraction > CONVO_IDLE_MS) this.convo.close(); // reopened by the next question / mic
      return; // idle: stream nothing
    }
    const interval = 1000;
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
      if (talking) this.scheduleFrame(interval);
    }
  }
}
