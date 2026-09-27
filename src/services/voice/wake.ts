/**
 * Wake word: say 「フライデー！」 and the microphone opens (like "Hey Google").
 *
 * Uses the browser's speech recognition in continuous mode, only to spot the
 * name — on-device when the browser offers it (Chrome's `processLocally`),
 * otherwise the platform recogniser. Anything said right after the name
 * (「フライデー、これは何？」) is handed over as the first question.
 *
 * The listener pauses whenever the real microphone is in use (conversation,
 * recording) or the page is hidden, and resumes afterwards.
 */
import { Emitter } from '../../core/events';
import { recognitionCtor, type SpeechRecognitionLike } from './index';

/** Ways recognisers write the name (katakana, hiragana, English, clipped). */
const WAKE = /(フ[ラィ]イ?デ[ーィ]?|ふらいでー?|friday|フライディ|プライデー|ライデー)/i;

/** Finds the wake word; `rest` is whatever followed it (the command, if any). */
export function matchWake(text: string): { hit: boolean; rest: string } {
  const m = WAKE.exec(text);
  if (!m) return { hit: false, rest: '' };
  const rest = text
    .slice(m.index + m[0].length)
    .replace(/^[\s、。,.!！?？ー〜~]+/, '')
    .trim();
  return { hit: true, rest };
}

export interface WakeEvents extends Record<string, unknown> {
  /** Heard the name. `command` = the rest of the sentence, when complete. */
  wake: { command: string };
  state: 'off' | 'listening' | 'paused' | 'unsupported' | 'denied';
}

type LocalRec = SpeechRecognitionLike & { processLocally?: boolean; maxAlternatives?: number };

export class WakeWordListener {
  readonly events = new Emitter<WakeEvents>();
  readonly supported = recognitionCtor() !== null;
  private rec: LocalRec | null = null;
  private enabled = false;
  private paused = false;
  private fired = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private onVisibility = () => this.sync();

  get state(): WakeEvents['state'] {
    if (!this.supported) return 'unsupported';
    if (!this.enabled) return 'off';
    return this.paused || document.visibilityState !== 'visible' ? 'paused' : 'listening';
  }

  setEnabled(on: boolean) {
    this.enabled = on && this.supported;
    if (on) document.addEventListener('visibilitychange', this.onVisibility);
    else document.removeEventListener('visibilitychange', this.onVisibility);
    this.sync();
  }

  /** The app is using the microphone itself (conversation / recording). */
  setPaused(p: boolean) {
    this.paused = p;
    this.sync();
  }

  private sync() {
    const want = this.enabled && !this.paused && document.visibilityState === 'visible';
    if (want && !this.rec) this.start();
    if (!want && this.rec) this.stop();
    this.events.emit('state', this.state);
  }

  private start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor() as LocalRec;
    rec.lang = 'ja-JP';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    // Chrome can keep this on the device (no audio leaves the phone) when the language pack is present.
    if ('processLocally' in rec) rec.processLocally = true;
    this.fired = false;
    let pending: { command: string; at: number } | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    const fire = (command: string) => {
      if (this.fired) return;
      this.fired = true;
      if (settle) clearTimeout(settle);
      this.events.emit('wake', { command });
    };
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i] as unknown as ArrayLike<{ transcript: string }> & { isFinal: boolean };
        for (let k = 0; k < r.length; k++) {
          const w = matchWake(r[k].transcript);
          if (!w.hit) continue;
          if (r.isFinal) return fire(w.rest);
          // Heard the name mid-sentence: wait briefly for the command to finish, then go.
          pending = { command: w.rest, at: performance.now() };
          if (settle) clearTimeout(settle);
          settle = setTimeout(() => pending && fire(pending.command), w.rest ? 1200 : 700);
          break;
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.enabled = false;
        this.events.emit('state', 'denied');
      } else if (e.error === 'language-not-supported' && rec.processLocally) {
        // No on-device Japanese pack: fall back to the platform recogniser.
        (this as unknown as { noLocal: boolean }).noLocal = true;
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.failures++;
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.rec = null;
      // Continuous sessions end on their own (silence, time limits): quietly resume.
      if (this.enabled && !this.paused && !this.fired) {
        const delay = Math.min(10_000, 300 * 2 ** Math.min(this.failures, 5));
        this.restartTimer = setTimeout(() => this.sync(), delay);
      }
    };
    rec.onspeechstart = null;
    if ((this as unknown as { noLocal?: boolean }).noLocal && 'processLocally' in rec) rec.processLocally = false;
    try {
      rec.start();
      this.rec = rec;
      this.failures = 0;
    } catch {
      this.failures++;
    }
  }

  private stop() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.abort();
    } catch {
      /* already stopped */
    }
  }

  dispose() {
    this.setEnabled(false);
  }
}

const WAKE_KEY = 'friday.wake';

/** On by default; the SYSTEM sheet can turn it off (per device). */
export function wakeEnabledSetting(): boolean {
  try {
    return globalThis.localStorage?.getItem(WAKE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveWakeEnabled(on: boolean) {
  try {
    globalThis.localStorage?.setItem(WAKE_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

/** Short rising two-tone chime: "I'm listening". */
export function playWakeChime() {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    for (const [i, f] of [880, 1320].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.18, t + i * 0.09 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.14);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.16);
    }
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio unavailable */
  }
}
