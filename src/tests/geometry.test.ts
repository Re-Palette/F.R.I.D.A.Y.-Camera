import { describe, expect, it } from 'vitest';
import { rankSources } from '../services/search/ranking';
import { IouTracker } from '../services/vision/tracker';
import { frameToView, viewToFrame } from '../core/util';
import type { SearchSource } from '../core/types';

describe('frameToView', () => {
  it('maps a 16:9 frame onto a portrait viewport with cover cropping', () => {
    const b = frameToView({ x: 0.5, y: 0.25, w: 0.1, h: 0.5 }, { w: 1920, h: 1080 }, { w: 390, h: 844 });
    expect(b.y).toBeCloseTo(0.25);
    expect(b.h).toBeCloseTo(0.5);
  });
  it('round-trips points', () => {
    const src = { w: 1280, h: 720 };
    const view = { w: 390, h: 844 };
    const p = viewToFrame({ x: 0.3, y: 0.7 }, src, view);
    const b = frameToView({ x: p.x, y: p.y, w: 0, h: 0 }, src, view);
    expect(b.x).toBeCloseTo(0.3);
    expect(b.y).toBeCloseTo(0.7);
  });
});

describe('IouTracker', () => {
  it('keeps ids stable across frames and drops stale tracks', () => {
    const t = new IouTracker({ iouThreshold: 0.3, maxAgeMs: 500, smoothing: 0.5, minHits: 1 });
    const a = t.update([{ label: 'car', score: 0.9, bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }], 0);
    const b = t.update([{ label: 'car', score: 0.9, bbox: { x: 0.12, y: 0.1, w: 0.2, h: 0.2 } }], 100);
    expect(b[0].id).toBe(a[0].id);
    expect(t.update([], 1000)).toHaveLength(0);
  });
});

describe('rankSources', () => {
  it('prioritises official and public sources over community', () => {
    const s = (tier: SearchSource['tier']): SearchSource => ({ id: tier, tier, title: '', url: '', publisher: '', snippet: '', trust: 0.9 });
    expect(rankSources([s('community'), s('news'), s('official'), s('government')]).map((x) => x.tier)).toEqual([
      'official',
      'government',
      'news',
      'community',
    ]);
  });
});

