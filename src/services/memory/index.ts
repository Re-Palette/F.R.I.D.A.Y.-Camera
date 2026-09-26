import { renderDemoStill } from '../../camera/demo/DemoFeed';
import type { MemoryHit, MemoryItem } from '../../core/types';
import type { MemoryService, WorldContext } from '../contracts';
import { MOCK_GEO } from '../mock/knowledgeBase';
import { parseMemoryQuery, scoreMemories } from './query';

interface Store {
  put(item: MemoryItem, blob?: Blob): Promise<void>;
  all(): Promise<MemoryItem[]>;
  blob(id: string): Promise<Blob | null>;
  del(id: string): Promise<void>;
}

abstract class BaseMemoryService implements MemoryService {
  abstract readonly mode: 'mock' | 'real';
  protected abstract store: Store;
  async init() {}
  save(item: MemoryItem, blob?: Blob) {
    return this.store.put(item, blob);
  }
  async list(limit = 60) {
    const all = await this.store.all();
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  async search(text: string, ctx: WorldContext): Promise<MemoryHit[]> {
    const q = parseMemoryQuery(text, ctx.now);
    return scoreMemories(await this.store.all(), q, ctx.geo ?? null);
  }
  async recall(ctx: WorldContext): Promise<MemoryHit | null> {
    const keys = new Set([...(ctx.focus?.keywords ?? []), ...(ctx.scene?.tags ?? [])].map((k) => k.toLowerCase()));
    if (!keys.size) return null;
    const weekAgo = ctx.now.getTime() - 7 * 864e5;
    let best: MemoryHit | null = null;
    for (const item of await this.store.all()) {
      if (new Date(item.createdAt).getTime() > weekAgo) continue;
      const tags = [...item.tags, ...item.entities].map((t) => t.toLowerCase());
      const shared = tags.filter((t) => keys.has(t));
      let score = shared.length;
      if (ctx.scene?.timeOfDay && item.timeOfDay === ctx.scene.timeOfDay) score += 0.5;
      if (score >= 2 && (!best || score > best.score)) best = { item, score, reasons: shared.map((s) => `#${s}`) };
    }
    return best;
  }
  getBlob(id: string) {
    return this.store.blob(id);
  }
  remove(id: string) {
    return this.store.del(id);
  }
}

// ─── In-memory store with seeded demo memories ─────────────────────────────

class RamStore implements Store {
  items = new Map<string, MemoryItem>();
  blobs = new Map<string, Blob>();
  async put(item: MemoryItem, blob?: Blob) {
    this.items.set(item.id, item);
    if (blob) this.blobs.set(item.id, blob);
  }
  async all() {
    return [...this.items.values()];
  }
  async blob(id: string) {
    return this.blobs.get(id) ?? null;
  }
  async del(id: string) {
    this.items.delete(id);
    this.blobs.delete(id);
  }
}

function daysAgo(n: number, hour: number, minute = 0): string {
  const d = new Date(Date.now() - n * 864e5);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

export class MockMemoryService extends BaseMemoryService {
  readonly mode = 'mock' as const;
  protected store = new RamStore();
  private seeded = false;

  async init() {
    if (this.seeded || typeof document === 'undefined') return;
    this.seeded = true;
    const W = 320;
    const H = 400;
    const seeds: (Omit<MemoryItem, 'thumbnail' | 'kind'> & { still: Parameters<typeof renderDemoStill> })[] = [
      {
        id: 'mem-odaiba-sunset',
        createdAt: daysAgo(76, 19, 3),
        tags: ['東京', 'お台場', 'レインボーブリッジ', '夕焼け', '東京湾'],
        entities: ['rainbow-bridge', 'レインボーブリッジ'],
        place: 'お台場海浜公園',
        scene: '東京・お台場付近の夕暮れ',
        timeOfDay: 'dusk',
        lat: MOCK_GEO.lat,
        lon: MOCK_GEO.lon,
        still: ['odaiba', W, H, { t: 2 }],
      },
      {
        id: 'mem-odaiba-dusk-2',
        createdAt: daysAgo(76, 18, 48),
        tags: ['東京', 'お台場', '夕焼け', '東京湾', '海'],
        entities: ['レインボーブリッジ'],
        place: 'お台場海浜公園',
        scene: '夕焼けの東京湾',
        timeOfDay: 'dusk',
        lat: MOCK_GEO.lat,
        lon: MOCK_GEO.lon,
        still: ['odaiba', W, H, { t: 6, tint: 'rgba(255,150,120,0.9)' }],
      },
      {
        id: 'mem-tokyo-night',
        createdAt: new Date(new Date().getFullYear() - 1, 11, 14, 21, 12).toISOString(),
        tags: ['東京', '夜景', '東京タワー', 'レインボーブリッジ', '東京湾'],
        entities: ['tokyo-tower', '東京タワー'],
        place: '港区 芝浦',
        scene: '東京湾の夜景',
        timeOfDay: 'night',
        lat: 35.6405,
        lon: 139.7556,
        still: ['odaiba', W, H, { t: 9, tint: 'rgba(40,60,150,0.95)' }],
      },
      {
        id: 'mem-summer-sea',
        createdAt: new Date(new Date().getFullYear() - 1, 7, 9, 17, 40).toISOString(),
        tags: ['海', 'ビーチ', 'お台場', '夏', '東京湾'],
        entities: [],
        place: 'お台場ビーチ',
        scene: '夏の海辺',
        timeOfDay: 'dusk',
        lat: 35.6303,
        lon: 139.7762,
        still: ['odaiba', W, H, { t: 4, tint: 'rgba(120,200,255,0.9)' }],
      },
      {
        id: 'mem-repalette-event',
        createdAt: daysAgo(34, 19, 30),
        tags: ['Re-Palette', 'イベント', 'ミートアップ', '渋谷', 'ネットワーキング'],
        entities: ['Re-Palette'],
        place: '渋谷',
        scene: 'Re-Palette コミュニティイベント',
        timeOfDay: 'night',
        caption: 'Re-Palette meetup vol.12',
        still: ['street', W, H, { t: 1, tint: 'rgba(255,120,60,0.85)' }],
      },
      {
        id: 'mem-paris-menu',
        createdAt: new Date(new Date().getFullYear() - 1, 4, 22, 12, 15).toISOString(),
        tags: ['パリ', 'フランス', 'カフェ', 'メニュー', '旅行'],
        entities: ['CAFÉ DU PONT'],
        place: 'Paris',
        scene: 'パリのカフェのメニュー',
        timeOfDay: 'day',
        still: ['menu', W, H, {}],
      },
      {
        id: 'mem-desk',
        createdAt: daysAgo(3, 23, 5),
        tags: ['デスク', 'PC', '仕事', 'ガジェット'],
        entities: ['MacBook Air'],
        place: '自宅',
        scene: '夜の作業デスク',
        timeOfDay: 'night',
        still: ['desk', W, H, {}],
      },
    ];
    for (const { still, ...s } of seeds) {
      await this.store.put({ ...s, kind: 'photo', thumbnail: renderDemoStill(...still) });
    }
  }
}

// ─── IndexedDB store (persistent, on-device) ───────────────────────────────

const DB_NAME = 'friday-memory';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('items', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
      db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const r = fn(t);
    t.oncomplete = () => resolve((r ? r.result : undefined) as T);
    t.onerror = () => reject(t.error);
  });
}

class IdbStore implements Store {
  private db: Promise<IDBDatabase> | null = null;
  private get conn() {
    this.db = this.db ?? openDb();
    return this.db;
  }
  async put(item: MemoryItem, blob?: Blob) {
    await tx(await this.conn, ['items', 'blobs'], 'readwrite', (t) => {
      t.objectStore('items').put(item);
      if (blob) t.objectStore('blobs').put(blob, item.id);
    });
  }
  async all() {
    return tx<MemoryItem[]>(await this.conn, ['items'], 'readonly', (t) => t.objectStore('items').getAll());
  }
  async blob(id: string) {
    return (await tx<Blob | undefined>(await this.conn, ['blobs'], 'readonly', (t) => t.objectStore('blobs').get(id))) ?? null;
  }
  async del(id: string) {
    await tx(await this.conn, ['items', 'blobs'], 'readwrite', (t) => {
      t.objectStore('items').delete(id);
      t.objectStore('blobs').delete(id);
    });
  }
}

/**
 * Persistent on-device memory. Semantic tags are produced at capture time by
 * the orchestrator (scene + detections + place + time). A remote embedding
 * index can later replace `search` without changing callers.
 */
export class IndexedDbMemoryService extends BaseMemoryService {
  readonly mode = 'real' as const;
  protected store = new IdbStore();
}
