import { describe, expect, it } from 'vitest';
import { classifyIntent } from '../orchestrator/intents';

const k = (t: string, focus = true) => classifyIntent(t, focus).kind;

describe('classifyIntent', () => {
  it('identifies deictic "what is this" questions', () => {
    expect(k('これ何？')).toBe('identify');
    expect(k('あれは何ですか')).toBe('identify');
    expect(k("What's this?")).toBe('identify');
  });

  it('routes follow-up questions about the focus', () => {
    const i = classifyIntent('いつできた？', true);
    expect(i.kind).toBe('chat');
    expect(i.referential).toBe(true);
    expect(k('夜に行くなら？')).toBe('search');
  });

  it('extracts search queries', () => {
    const i = classifyIntent('この会社について調べて', true);
    expect(i.kind).toBe('search');
    expect(i.referential).toBe(true);
    expect(classifyIntent('レインボーブリッジの歴史を調べて', false).query).toBe('レインボーブリッジの歴史');
  });

  it('handles camera commands', () => {
    expect(k('写真撮って')).toBe('capture_photo');
    expect(classifyIntent('10秒後に写真撮って', true).params).toEqual({ timer: '10' });
    expect(k('録画開始して')).toBe('record_start');
    expect(k('録画止めて')).toBe('record_stop');
    expect(classifyIntent('3倍にズーム', true).params).toEqual({ zoom: '3' });
    expect(k('カメラを切り替えて')).toBe('switch_camera');
  });

  it('handles weather with day detection', () => {
    const i = classifyIntent('明日の天気を調べて', false);
    expect(i.kind).toBe('weather');
    expect(i.params?.when).toBe('tomorrow');
    expect(classifyIntent('今の気温は？', false).params?.when).toBe('now');
  });

  it('handles navigation and extracts destination', () => {
    const i = classifyIntent('最寄りの駅までナビして', false);
    expect(i.kind).toBe('navigate');
    expect(i.query).toBe('駅');
  });

  it('handles memory search', () => {
    expect(k('去年撮った東京の夜景を見せて')).toBe('memory_search');
    expect(k('Re-Paletteのイベントの写真を探して')).toBe('memory_search');
  });

  it('handles translation, ocr, social, scene', () => {
    expect(k('これ翻訳して')).toBe('translate');
    expect(k('なんて書いてある？')).toBe('translate');
    expect(k('インスタ用のキャプションを作って')).toBe('social');
    expect(k('ここはどこ？')).toBe('scene');
  });

  it('handles vision follow-ups', () => {
    expect(k('公式サイト開いて')).toBe('open_url');
    expect(k('ホームページを見せて')).toBe('open_url');
    expect(k('いくら？')).toBe('product_info');
    const i = classifyIntent('何の建物？', true);
    expect(i.referential).toBe(true);
    expect(classifyIntent('ここについて調べて', true).kind).toBe('search');
  });

  it('strips the wake word', () => {
    expect(classifyIntent('ねえ FRIDAY、写真撮って', false).kind).toBe('capture_photo');
  });
});
