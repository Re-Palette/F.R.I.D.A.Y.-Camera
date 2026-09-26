import { describe, expect, it } from 'vitest';
import type { Detection, Identification, NavTarget } from '../core/types';
import { IdentificationManager } from '../orchestrator/identification';
import type { VisionProvider } from '../services/contracts';
import {
  attachText,
  countObjects,
  detectLang,
  estimateLocation,
  geoAnchors,
  headline,
  pickToIdentify,
  rankForHud,
  reassociate,
  sanitize,
  shownName,
  statusFor,
  type TrackMeta,
} from '../services/vision/perception';

const det = (p: Partial<Detection> & { id: string }): Detection => ({
  label: 'car',
  displayName: '乗用車',
  category: 'vehicle',
  confidence: 0.9,
  bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
  ...p,
});
const ident = (p: Partial<Identification>): Identification => ({ status: 'identified', kind: 'vehicle', name: 'Tesla Model 3', confidence: 0.87, source: 'mock', at: 0, ...p });

describe('confidence policy', () => {
  it('never overstates', () => {
    expect(statusFor(0.87)).toBe('identified');
    expect(statusFor(0.62)).toBe('possible');
    expect(statusFor(0.31)).toBe('unknown');
  });

  it('produces the HUD headline for every stage', () => {
    expect(headline(det({ id: 'a' }))).toBe('TARGET DETECTED');
    expect(headline(det({ id: 'a', identity: ident({ status: 'identifying' }) }))).toBe('IDENTIFYING…');
    expect(headline(det({ id: 'a', identity: ident({}) }))).toBe('VEHICLE IDENTIFIED');
    expect(headline(det({ id: 'a', identity: ident({ status: 'possible', confidence: 0.62 }) }))).toBe('POSSIBLE MATCH');
    expect(headline(det({ id: 'a', identity: ident({ status: 'unknown', name: '' }) }))).toBe('UNKNOWN OBJECT');
    expect(headline(det({ id: 'a', category: 'food', identity: ident({ kind: 'food', status: 'possible' }) }))).toBe('POSSIBLE DISH');
    expect(headline(det({ id: 'a', category: 'building', identity: ident({ kind: 'building', name: '東京ビッグサイト' }) }))).toBe('BUILDING IDENTIFIED');
    expect(headline(det({ id: 'a', category: 'person' }))).toBe('PERSON DETECTED');
  });

  it('shows the generic class until something specific is known', () => {
    expect(shownName(det({ id: 'a' }))).toBe('乗用車');
    expect(shownName(det({ id: 'a', identity: ident({}) }))).toBe('Tesla Model 3');
    expect(shownName(det({ id: 'a', identity: ident({ status: 'unknown', name: '' }) }))).toBe('不明な物体');
  });
});

describe('privacy', () => {
  it('strips any identity or attributes from people', () => {
    const p = sanitize(det({ id: 'p', category: 'person', displayName: 'John', attributes: { age: '30' }, identity: ident({ kind: 'person', name: 'John' }) }));
    expect(p.displayName).toBe('人物');
    expect(p.attributes).toBeUndefined();
    expect(p.identity?.name).toBe('');
    expect(p.identity?.status).toBe('detected');
  });
});

describe('scheduling', () => {
  const meta = (firstSeen: number, extra: Partial<TrackMeta> = {}): TrackMeta => ({ firstSeen, lastSeen: 1000, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 }, category: 'vehicle', ...extra });

  it('identifies stable targets, locked first, within the in-flight budget, never people', () => {
    const dets = [det({ id: 'a' }), det({ id: 'b', confidence: 0.95 }), det({ id: 'c' }), det({ id: 'p', category: 'person' }), det({ id: 'new' })];
    const m = new Map<string, TrackMeta>([
      ['a', meta(0)],
      ['b', meta(0)],
      ['c', meta(0)],
      ['p', meta(0, { category: 'person' })],
      ['new', meta(900)],
    ]);
    const picked = pickToIdentify(dets, m, { now: 1000, inflight: 0, maxInflight: 2, stableMs: 500, lockedId: 'c' });
    expect(picked.map((d) => d.id)[0]).toBe('c');
    expect(picked).toHaveLength(2);
    expect(picked.some((d) => d.id === 'p' || d.id === 'new')).toBe(false);
    expect(pickToIdentify(dets, m, { now: 1000, inflight: 2, maxInflight: 2, stableMs: 500 })).toHaveLength(0);
  });

  it('carries an identity across a tracker id change', () => {
    const lost = [{ id: 'old', lostAt: 900, meta: { firstSeen: 0, lastSeen: 900, bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, category: 'vehicle' as const, identity: ident({}) } }];
    expect(reassociate(det({ id: 'new', bbox: { x: 0.42, y: 0.41, w: 0.2, h: 0.2 } }), lost, 1200)?.identity?.name).toBe('Tesla Model 3');
    expect(reassociate(det({ id: 'new', bbox: { x: 0.9, y: 0.9, w: 0.05, h: 0.05 } }), lost, 1200)).toBeNull();
    expect(reassociate(det({ id: 'new' }), lost, 9000)).toBeNull();
  });

  it('limits labels to the most important objects', () => {
    const dets = Array.from({ length: 10 }, (_, i) => det({ id: `d${i}`, confidence: 0.5 + i * 0.04 }));
    const { labelled } = rankForHud(dets, 'd0', 3);
    expect(labelled.size).toBe(3);
    expect(labelled.has('d0')).toBe(true);
  });

  it('summarises multiple objects', () => {
    const c = countObjects([det({ id: '1' }), det({ id: '2' }), det({ id: '3', category: 'person', label: 'person' }), det({ id: '4', label: 'bicycle' })]);
    expect(c.find((x) => x.key === 'CAR')?.n).toBe(2);
    expect(c.find((x) => x.key === 'PERSON')?.n).toBe(1);
    expect(c.find((x) => x.key === 'BICYCLE')?.n).toBe(1);
  });
});

describe('IdentificationManager', () => {
  it('runs detect → identifying → identified once per track and caches it', async () => {
    let calls = 0;
    const vision = {
      capabilities: { detect: 'mock', identify: 'mock', scene: 'mock', text: 'none', identifyNeedsCrop: false, maxInflightIdentify: 2 },
      identify: async () => {
        calls++;
        return ident({});
      },
    } as unknown as VisionProvider;
    const m = new IdentificationManager({ vision: () => vision, crop: async () => null, ctx: () => ({ now: new Date() }), scene: () => null, nearby: () => [] });
    const d = det({ id: 't1' });
    expect(m.process([d], 0, null, null)[0].identity).toBeUndefined(); // just detected
    const identifying = m.process([d], 600, null, null)[0];
    expect(identifying.identity).toBeUndefined(); // scheduled this tick
    expect(m.process([d], 650, null, null)[0].identity?.status).toBe('identifying');
    await new Promise((r) => setTimeout(r, 0));
    expect(m.process([d], 700, null, null)[0].identity?.name).toBe('Tesla Model 3');
    m.process([d], 5000, null, null);
    expect(calls).toBe(1);
  });
});

describe('geo + location', () => {
  const poi = (p: Partial<NavTarget>): NavTarget => ({ id: 'bs', name: '東京ビッグサイト', kind: 'landmark', lat: 0, lon: 0, bearingDeg: 90, distanceM: 600, eta: { walkMin: 8, bikeMin: 3, carMin: 2 }, ...p });
  const geo = { lat: 35.6284, lon: 139.7737, accuracy: 10, area: 'お台場' };

  it('projects landmarks in the field of view as estimates only', () => {
    const a = geoAnchors([poi({})], geo, 85, { hfov: 55, now: 0 });
    expect(a).toHaveLength(1);
    expect(a[0].source).toBe('geo');
    expect(a[0].identity!.confidence).toBeLessThanOrEqual(0.78);
    expect(a[0].bbox.x + a[0].bbox.w / 2).toBeGreaterThan(0.5); // to the right of centre
    expect(geoAnchors([poi({})], geo, 270, { hfov: 55, now: 0 })).toHaveLength(0); // behind us
  });

  it('marks location as 推定 unless an image-based landmark confirms GPS', () => {
    expect(estimateLocation({ geo })!.estimated).toBe(true);
    const viaGeo = estimateLocation({ geo, landmark: { name: '東京ビッグサイト', confidence: 0.7, source: 'geo' } })!;
    expect(viaGeo.estimated).toBe(true);
    const confirmed = estimateLocation({ geo, landmark: { name: '東京ビッグサイト', confidence: 0.94, source: 'cloud', area: '東京都江東区 有明' } })!;
    expect(confirmed.estimated).toBe(false);
    expect(confirmed.name).toBe('東京都江東区 有明');
    expect(confirmed.basis).toEqual(['gps', 'landmark']);
    expect(estimateLocation({ geo: null })).toBeNull();
  });
});

describe('text', () => {
  it('attaches OCR to the sign containing it and detects scripts', () => {
    const sign = det({ id: 's', category: 'sign', bbox: { x: 0, y: 0, w: 0.5, h: 0.2 } });
    const { byId, free } = attachText([sign], [
      { text: 'STARBUCKS', bbox: { x: 0.1, y: 0.05, w: 0.2, h: 0.05 } },
      { text: '有明', bbox: { x: 0.7, y: 0.7, w: 0.1, h: 0.05 } },
    ]);
    expect(byId.get('s')).toBe('STARBUCKS');
    expect(free.map((f) => f.text)).toEqual(['有明']);
    expect(detectLang('東京ビッグサイト')).toBe('ja');
    expect(detectLang('星巴克咖啡')).toBe('zh');
    expect(detectLang('스타벅스')).toBe('ko');
    expect(detectLang('STARBUCKS')).toBe('en');
  });
});
