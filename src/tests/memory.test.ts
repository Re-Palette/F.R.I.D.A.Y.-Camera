import { describe, expect, it } from 'vitest';
import type { MemoryItem } from '../core/types';
import { parseMemoryQuery, scoreMemories } from '../services/memory/query';

const NOW = new Date(2026, 8, 26, 18, 0);

const item = (p: Partial<MemoryItem> & { id: string; createdAt: string }): MemoryItem => ({
  kind: 'photo',
  thumbnail: '',
  tags: [],
  entities: [],
  ...p,
});

const ITEMS = [
  item({ id: 'night-2025', createdAt: new Date(2025, 11, 14, 21).toISOString(), tags: ['東京', '夜景', '東京タワー'], timeOfDay: 'night' }),
  item({ id: 'sea-2025', createdAt: new Date(2025, 7, 9, 17).toISOString(), tags: ['海', 'お台場'], timeOfDay: 'dusk', lat: 35.63, lon: 139.776 }),
  item({ id: 'event', createdAt: new Date(2026, 7, 23, 19).toISOString(), tags: ['Re-Palette', 'イベント'], timeOfDay: 'night' }),
  item({ id: 'sunset-2026', createdAt: new Date(2026, 6, 12, 19).toISOString(), tags: ['東京', '夕焼け', '東京湾'], timeOfDay: 'dusk', lat: 35.6284, lon: 139.7737 }),
];

const ids = (text: string, here?: { lat: number; lon: number }) =>
  scoreMemories(ITEMS, parseMemoryQuery(text, NOW), here).map((h) => h.item.id);

describe('parseMemoryQuery', () => {
  it('parses last year + subject', () => {
    const q = parseMemoryQuery('去年撮った東京の夜景', NOW);
    expect(q.from?.getFullYear()).toBe(2025);
    expect(q.terms).toEqual(['東京', '夜景']);
    expect(q.timeOfDay).toEqual(['night']);
  });

  it('parses near-here and time of day', () => {
    expect(parseMemoryQuery('この場所で撮った写真', NOW).nearHere).toBe(true);
    expect(parseMemoryQuery('夕方の写真', NOW).timeOfDay).toEqual(['dusk']);
  });
});

describe('scoreMemories', () => {
  it('finds last year night views of Tokyo', () => {
    expect(ids('去年撮った東京の夜景')).toEqual(['night-2025']);
  });
  it('expands synonyms (海 → 東京湾)', () => {
    expect(ids('去年撮った海の写真')).toEqual(['sea-2025']);
  });
  it('matches events by name', () => {
    expect(ids('Re-Paletteのイベント写真')[0]).toBe('event');
  });
  it('filters by time of day', () => {
    expect(ids('夕方の写真').sort()).toEqual(['sea-2025', 'sunset-2026']);
  });
  it('filters by location', () => {
    expect(ids('この場所で撮った写真', { lat: 35.6284, lon: 139.7737 }).sort()).toEqual(['sea-2025', 'sunset-2026']);
  });
});
