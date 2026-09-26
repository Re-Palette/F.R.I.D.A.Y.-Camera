/**
 * Audio I/O for Gemini Live.
 *
 *   MicStreamer — microphone → 16 kHz mono PCM16 chunks (~40 ms) via an
 *                 AudioWorklet (audio thread; nothing on the UI thread but a
 *                 base64 of 1.3 kB every 40 ms).
 *   PcmPlayer   — 24 kHz PCM16 chunks from the model → gapless playback,
 *                 cleared instantly on barge-in (`interrupted`).
 */

const WORKLET = `
class Pcm16Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(640); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.buf.length) {
        let sum = 0;
        for (let j = 0; j < this.n; j++) sum += Math.abs(this.buf[j]);
        this.port.postMessage({ pcm: this.buf.buffer.slice(0), level: sum / this.n / 32768 });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm16-capture', Pcm16Capture);
`;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PCM16 little-endian → Float32 [-1, 1]. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const n = bytes.length >> 1;
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

export class MicStreamer {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  constructor(private readonly onChunk: (pcmBase64: string, level: number) => void) {}

  get active() {
    return !!this.node;
  }

  async start(): Promise<void> {
    if (this.node) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // The context resamples the mic to 16 kHz for us.
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    try {
      await this.ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm16-capture');
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => this.onChunk(bytesToBase64(new Uint8Array(e.data.pcm)), e.data.level);
    src.connect(this.node);
  }

  stop() {
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}

export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextAt = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onPlaying: (playing: boolean) => void) {}

  get playing() {
    return this.sources.size > 0;
  }

  /** Call from a user gesture once (autoplay policy). */
  unlock() {
    this.ensure();
    void this.ctx?.resume();
  }

  private ensure(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: 24000 });
    return this.ctx;
  }

  enqueue(pcmBase64: string) {
    const ctx = this.ensure();
    const samples = pcm16ToFloat32(base64ToBytes(pcmBase64));
    if (!samples.length) return;
    const buf = ctx.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    // Small lead so chunks arriving slightly late don't click.
    const at = Math.max(ctx.currentTime + 0.03, this.nextAt);
    src.start(at);
    this.nextAt = at + buf.duration;
    const wasIdle = this.sources.size === 0;
    this.sources.add(src);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (wasIdle) this.onPlaying(true);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.idleTimer = setTimeout(() => !this.sources.size && this.onPlaying(false), 250);
    };
  }

  /** Barge-in: drop everything queued. */
  clear() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.sources.clear();
    this.nextAt = 0;
    this.onPlaying(false);
  }

  close() {
    this.clear();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
