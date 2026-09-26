import { Emitter } from '../../core/events';
import type { VoiceEvents, VoiceService } from '../contracts';

/* Minimal typings for the (still prefixed) Web Speech recognition API. */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  0: SRAlternative;
}
interface SREvent {
  resultIndex: number;
  results: ArrayLike<SRResult>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onspeechstart: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const g = globalThis as unknown as Record<string, unknown>;
  return (g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

/**
 * Browser voice I/O. Recognition stays open while the assistant speaks so the
 * user can barge in: the orchestrator cancels TTS on `speechstart` / partials.
 */
export class WebVoiceService implements VoiceService {
  readonly mode = 'real' as const;
  readonly events = new Emitter<VoiceEvents>();
  readonly sttSupported = recognitionCtor() !== null;
  readonly ttsSupported = typeof speechSynthesis !== 'undefined';
  private rec: SpeechRecognitionLike | null = null;
  private wantListening = false;
  private speakingResolve: (() => void) | null = null;

  startListening(lang = 'ja-JP') {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      this.events.emit('error', 'SpeechRecognition unsupported');
      return;
    }
    this.wantListening = true;
    if (this.rec) return;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onspeechstart = () => this.events.emit('speechstart', undefined);
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) this.events.emit('final', r[0].transcript.trim());
        else interim += r[0].transcript;
      }
      if (interim) {
        this.events.emit('partial', interim.trim());
        this.events.emit('level', Math.min(1, 0.3 + interim.length / 30));
      }
    };
    rec.onerror = (e) => {
      if (e.error !== 'no-speech' && e.error !== 'aborted') this.events.emit('error', e.error);
      if (e.error === 'not-allowed') this.wantListening = false;
    };
    rec.onend = () => {
      this.rec = null;
      // Chrome ends continuous sessions periodically — transparently resume.
      if (this.wantListening) setTimeout(() => this.wantListening && this.startListening(lang), 150);
      else this.events.emit('listening', false);
    };
    this.rec = rec;
    try {
      rec.start();
      this.events.emit('listening', true);
    } catch (err) {
      this.rec = null;
      this.events.emit('error', String(err));
    }
  }

  stopListening() {
    this.wantListening = false;
    this.rec?.stop();
    this.rec = null;
    this.events.emit('listening', false);
  }

  speak(text: string, lang = 'ja-JP'): Promise<void> {
    if (!this.ttsSupported) return Promise.resolve();
    this.cancelSpeech();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang;
      u.rate = 1.05;
      u.pitch = 1.0;
      const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith(lang.slice(0, 2)));
      if (voice) u.voice = voice;
      const done = () => {
        if (this.speakingResolve === resolve) this.speakingResolve = null;
        this.events.emit('speaking', false);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.speakingResolve = resolve;
      this.events.emit('speaking', true);
      speechSynthesis.speak(u);
    });
  }

  cancelSpeech() {
    if (!this.ttsSupported) return;
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    if (this.speakingResolve) {
      const r = this.speakingResolve;
      this.speakingResolve = null;
      this.events.emit('speaking', false);
      r();
    }
  }
}

/** Silent voice: text input only, speech is simulated by duration. */
export class MockVoiceService implements VoiceService {
  readonly mode = 'mock' as const;
  readonly events = new Emitter<VoiceEvents>();
  readonly sttSupported = false;
  readonly ttsSupported = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private resolve: (() => void) | null = null;

  startListening() {
    this.events.emit('listening', true);
  }
  stopListening() {
    this.events.emit('listening', false);
  }
  speak(text: string): Promise<void> {
    this.cancelSpeech();
    this.events.emit('speaking', true);
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.timer = setTimeout(() => this.finish(), Math.min(6000, 600 + text.length * 55));
    });
  }
  private finish() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const r = this.resolve;
    this.resolve = null;
    if (r) {
      this.events.emit('speaking', false);
      r();
    }
  }
  cancelSpeech() {
    this.finish();
  }
}
