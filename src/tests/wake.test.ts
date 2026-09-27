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

describe('WakeWordListener', () => {
  beforeEach(() => {
    const g = globalThis as Record<string, unknown>;
    g.webkitSpeechRecognition = FakeRec;
    g.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
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
});
