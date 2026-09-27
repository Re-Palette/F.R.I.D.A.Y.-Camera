import { beforeEach, describe, expect, it } from 'vitest';
import { WakeWordListener, matchWake } from '../services/voice/wake';

describe('wake word 「フライデー」', () => {
  it('spots the name in the ways recognisers write it, and keeps the command', () => {
    expect(matchWake('フライデー、これは何？')).toEqual({ hit: true, rest: 'これは何？' });
    expect(matchWake('ねえ フライデー')).toEqual({ hit: true, rest: '' });
    expect(matchWake('ふらいでー 写真撮って').rest).toBe('写真撮って');
    expect(matchWake('Friday what is this').hit).toBe(true);
    expect(matchWake('フライディ').hit).toBe(true);
    expect(matchWake('フライパンを買う').hit).toBe(false);
    expect(matchWake('プライドが高い').hit).toBe(false);
  });
});

class FakeRec {
  static last: FakeRec | null = null;
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally?: boolean = false;
  started = false;
  aborted = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onspeechstart: (() => void) | null = null;
  constructor() {
    FakeRec.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {}
  abort() {
    this.aborted = true;
  }
  say(text: string, isFinal: boolean) {
    const result = Object.assign([{ transcript: text }], { isFinal });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
}

let listeners: Record<string, () => void> = {};

describe('WakeWordListener', () => {
  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    g.webkitSpeechRecognition = FakeRec;
    listeners = {};
    g.document = {
      visibilityState: 'visible',
      addEventListener(t: string, f: () => void) {
        listeners[t] = f;
      },
      removeEventListener() {},
    };
  });

  it('listens on-device when possible, fires with the command, and releases the mic when paused', () => {
    const w = new WakeWordListener();
    const woke: string[] = [];
    w.events.on('wake', ({ command }) => woke.push(command));
    w.setEnabled(true);
    const rec = FakeRec.last!;
    expect(rec.started && rec.continuous && rec.lang === 'ja-JP').toBe(true);
    expect(rec.processLocally).toBe(true);
    rec.say('今日はいい天気', true);
    expect(woke).toEqual([]);
    rec.say('フライデー これは何', true);
    expect(woke).toEqual(['これは何']);
    expect(w.state).toBe('listening');
    w.setPaused(true);
    expect(rec.aborted).toBe(true);
    expect(w.state).toBe('paused');
  });

  it('on mobile: waits for a tap when refused before any gesture, and falls back from on-device', async () => {
    const w = new WakeWordListener();
    w.setEnabled(true);
    let rec = FakeRec.last!;
    // No on-device Japanese pack → retry with the platform recogniser.
    rec.onerror?.({ error: 'service-not-allowed' });
    rec.onend?.();
    await new Promise((r) => setTimeout(r, 400));
    rec = FakeRec.last!;
    expect(rec.processLocally).toBe(false);
    expect(rec.started).toBe(true);
    // Refused because nobody touched the page yet → wait for a tap, don't give up.
    rec.onerror?.({ error: 'not-allowed' });
    rec.onend?.();
    expect(w.state).toBe('tap');
    const before = FakeRec.last;
    listeners.pointerdown();
    expect(FakeRec.last).not.toBe(before);
    expect(FakeRec.last!.started).toBe(true);
    expect(w.state).toBe('listening');
  });
});
