/**
 * Demo knowledge base for the mock services.
 *
 * Landmark facts are real public facts. Products, stores and news publishers
 * are fictional so the mock never impersonates real companies or outlets.
 */
import type { EntityProfile, NewsItem, ObjectCategory, PlaceInfo, RelatedInfo } from '../../core/types';

export type MockNews = Omit<NewsItem, 'id' | 'publishedAt'> & { minutesAgo: number };

export interface MockEntity {
  profile: EntityProfile;
  label: string;
  confidence: number;
  related: RelatedInfo[];
  news: MockNews[];
}

const place = (p: Omit<PlaceInfo, 'id'> & { id?: string }): PlaceInfo => ({ id: p.id ?? p.name, ...p });

function entity(
  id: string,
  label: string,
  category: ObjectCategory,
  confidence: number,
  p: Omit<EntityProfile, 'id' | 'category'>,
  related: RelatedInfo[] = [],
  news: MockEntity['news'] = [],
): MockEntity {
  return { profile: { id, category, ...p }, label, confidence, related, news };
}

export const MOCK_ENTITIES: Record<string, MockEntity> = {
  'rainbow-bridge': entity(
    'rainbow-bridge',
    'bridge',
    'landmark',
    0.95,
    {
      name: 'レインボーブリッジ',
      nameEn: 'Rainbow Bridge',
      subtitle: '橋 / 建造物',
      summary:
        '東京都港区芝浦とお台場を結ぶ吊り橋。1993年8月26日に開通し、上層に首都高速11号台場線、下層にゆりかもめ・一般道・遊歩道が通る二層構造です。',
      facts: [
        { key: 'opened', label: '開通', value: '1993年8月26日' },
        { key: 'length', label: '全長', value: '798 m（吊橋部）' },
        { key: 'height', label: '主塔高', value: '126 m' },
        { key: 'type', label: '構造', value: '2層吊り橋' },
        { key: 'walk', label: '遊歩道', value: '9:00–21:00（夏季）' },
      ],
      place: place({
        id: 'rainbow-bridge',
        name: 'レインボーブリッジ',
        kind: 'landmark',
        address: '東京都港区海岸3丁目〜台場1丁目',
        lat: 35.6365,
        lon: 139.7632,
        rating: 4.5,
        reviewCount: 18240,
        openNow: true,
        hours: 'ライトアップ 日没〜24:00',
        crowd: 'moderate',
      }),
      keywords: ['東京', 'お台場', 'レインボーブリッジ', '夜景', '東京湾', '夕焼け'],
    },
    [
      { id: 'r1', kind: 'history', title: 'レインボーブリッジの歴史', detail: '1987年着工、1993年開通。愛称は公募で決定。' },
      { id: 'r2', kind: 'nearby', title: '周辺のおすすめカフェ', detail: 'お台場海浜公園周辺に夜景の見えるカフェ 12件' },
      { id: 'r3', kind: 'crowd', title: '今の時間の混雑状況', detail: '遊歩道: やや混雑（夕景ピーク）' },
      { id: 'r4', kind: 'event', title: '週末のイベント', detail: 'お台場 夜景クルーズ 19:00 / 20:30 出航' },
    ],
    [
      { title: '東京の観光地、訪日観光客数が過去最高を更新', source: 'Metro News', tier: 'news', url: 'https://example.com/news/tourism', topic: '観光', minutesAgo: 62 },
      { title: 'お台場エリア、夜間ライトアップを期間延長', source: 'Bay City Official', tier: 'official', url: 'https://example.com/official/lightup', topic: 'イベント', minutesAgo: 190 },
      { title: '首都高 台場線、週末夜間に一部車線規制', source: 'Road Traffic Info', tier: 'government', url: 'https://example.com/traffic', topic: '交通', minutesAgo: 320 },
    ],
  ),
  'tokyo-tower': entity(
    'tokyo-tower',
    'tower',
    'landmark',
    0.91,
    {
      name: '東京タワー',
      nameEn: 'Tokyo Tower',
      subtitle: '電波塔 / 観光地',
      summary: '1958年に完成した高さ333mの総合電波塔。メインデッキ（150m）とトップデッキ（250m）から東京を一望できます。',
      facts: [
        { key: 'opened', label: '完成', value: '1958年12月23日' },
        { key: 'height', label: '高さ', value: '333 m' },
        { key: 'deck', label: '展望台', value: '150 m / 250 m' },
        { key: 'hours', label: '営業', value: '9:00–23:00' },
      ],
      place: place({
        id: 'tokyo-tower',
        name: '東京タワー',
        kind: 'landmark',
        address: '東京都港区芝公園4-2-8',
        lat: 35.6586,
        lon: 139.7454,
        rating: 4.4,
        reviewCount: 52310,
        openNow: true,
        hours: '9:00–23:00',
        crowd: 'high',
      }),
      keywords: ['東京タワー', '東京', '夜景', '港区'],
    },
    [
      { id: 't1', kind: 'official', title: '展望台チケット', detail: 'メインデッキ 大人 1,500円〜' },
      { id: 't2', kind: 'history', title: '東京タワーの歴史', detail: '1958年竣工、2012年まで主要電波塔' },
    ],
    [{ title: '東京タワー、秋の特別ライトアップを発表', source: 'Bay City Official', tier: 'official', url: 'https://example.com/tower', topic: 'イベント', minutesAgo: 240 }],
  ),
  yakatabune: entity('yakatabune', 'boat', 'boat', 0.82, {
    name: '屋形船',
    nameEn: 'Yakatabune cruise',
    subtitle: '船舶 / 観光クルーズ',
    summary: '東京湾を周遊する屋形船。夕景〜夜景の時間帯に運航が集中します。',
    facts: [
      { key: 'speed', label: '推定速度', value: '4 kn' },
      { key: 'heading', label: '進行方向', value: '南西' },
    ],
    keywords: ['屋形船', 'クルーズ', '東京湾'],
  }),
  laptop: entity(
    'laptop',
    'laptop',
    'computer',
    0.97,
    {
      name: 'Nova Book Pro 14',
      nameEn: 'Nova Book Pro 14',
      subtitle: 'ノートPC / Aether Labs',
      summary: '14インチのクリエイター向けノートPC（デモ用の架空製品データ）。',
      facts: [
        { key: 'maker', label: 'メーカー', value: 'Aether Labs' },
        { key: 'cpu', label: 'CPU', value: 'A-Series X4 (12 core)' },
      ],
      product: {
        name: 'Nova Book Pro 14',
        maker: 'Aether Labs',
        priceJPY: 248800,
        officialUrl: 'https://example.com/aether/nova-book-pro-14',
        specs: [
          { key: 'cpu', label: 'CPU', value: '12コア' },
          { key: 'mem', label: 'メモリ', value: '32 GB' },
          { key: 'ssd', label: 'SSD', value: '1 TB' },
          { key: 'display', label: 'ディスプレイ', value: '14.2" 120Hz' },
          { key: 'weight', label: '重量', value: '1.55 kg' },
          { key: 'battery', label: 'バッテリー', value: '最大18時間' },
        ],
        rating: 4.6,
        reviewCount: 1284,
        reviewSummary: '画面品質とバッテリー持ちの評価が高く、重量と価格に不満の声がある。',
        similar: [
          { name: 'Orbit Slim 14', priceJPY: 189800 },
          { name: 'Vertex Studio 15', priceJPY: 279000 },
        ],
        offers: [
          { store: '公式ストア', priceJPY: 248800 },
          { store: 'Store A', priceJPY: 239980 },
          { store: 'Store B', priceJPY: 244500 },
        ],
      },
      keywords: ['ノートPC', 'Nova Book', 'Aether Labs', 'PC'],
    },
    [{ id: 'l1', kind: 'official', title: '公式サポート / 保証', detail: '購入後1年間のメーカー保証' }],
  ),
  smartphone: entity('smartphone', 'cell phone', 'phone', 0.93, {
    name: 'Aether Phone 9',
    subtitle: 'スマートフォン / Aether Labs',
    summary: 'デモ用の架空スマートフォン。',
    facts: [{ key: 'maker', label: 'メーカー', value: 'Aether Labs' }],
    product: {
      name: 'Aether Phone 9',
      maker: 'Aether Labs',
      priceJPY: 139800,
      officialUrl: 'https://example.com/aether/phone-9',
      specs: [
        { key: 'display', label: '画面', value: '6.3" OLED' },
        { key: 'camera', label: 'カメラ', value: '48MP ×3' },
        { key: 'storage', label: 'ストレージ', value: '256 GB' },
      ],
      rating: 4.3,
      reviewCount: 842,
      reviewSummary: 'カメラ性能の評価が高い。発熱に関する指摘が一部ある。',
      similar: [{ name: 'Orbit Phone S', priceJPY: 119800 }],
      offers: [
        { store: '公式ストア', priceJPY: 139800 },
        { store: 'Store A', priceJPY: 132000 },
      ],
    },
    keywords: ['スマートフォン', 'Aether Phone'],
  }),
  coffee: entity('coffee', 'cup', 'food', 0.88, {
    name: 'カフェラテ',
    subtitle: '飲み物 / 推定 180 kcal',
    summary: 'ミルクを使ったエスプレッソドリンクと推定。',
    facts: [
      { key: 'kcal', label: '推定カロリー', value: '約180 kcal' },
      { key: 'caffeine', label: 'カフェイン', value: '約75 mg' },
    ],
    keywords: ['コーヒー', 'カフェ'],
  }),
  menu: entity('menu', 'menu', 'text', 0.96, {
    name: 'フランス語のメニュー',
    subtitle: 'テキスト / French',
    summary: 'カフェのメニュー。7行のテキストを検出しました。',
    facts: [
      { key: 'lang', label: '言語', value: 'フランス語' },
      { key: 'lines', label: '行数', value: '7' },
    ],
    keywords: ['メニュー', 'フランス語'],
  }),
  car: entity('car', 'car', 'vehicle', 0.94, {
    name: '乗用車',
    subtitle: '車両 / 接近中',
    summary: 'こちらに接近している車両。',
    facts: [
      { key: 'type', label: '車種', value: 'セダン' },
      { key: 'motion', label: '動き', value: '接近' },
    ],
    keywords: ['車'],
  }),
  cone: entity('cone', 'traffic cone', 'road', 0.9, {
    name: '工事用コーン',
    subtitle: '道路 / 工事区域',
    summary: '工事区域を示すカラーコーン。',
    facts: [{ key: 'zone', label: '区域', value: '歩道一部規制' }],
    keywords: ['工事'],
  }),
  'cafe-lumen': entity(
    'cafe-lumen',
    'storefront',
    'store',
    0.89,
    {
      name: 'Café Lumen',
      subtitle: '店舗 / カフェ',
      summary: '深夜まで営業する自家焙煎カフェ（デモ用の架空店舗）。',
      facts: [
        { key: 'hours', label: '営業時間', value: '8:00–24:00' },
        { key: 'rating', label: '評価', value: '★4.4 (612件)' },
        { key: 'price', label: '価格帯', value: '¥1,000–1,999' },
      ],
      place: place({
        id: 'cafe-lumen',
        name: 'Café Lumen',
        kind: 'cafe',
        address: '東京都港区台場1-7-1',
        lat: 35.6296,
        lon: 139.7751,
        rating: 4.4,
        reviewCount: 612,
        openNow: true,
        hours: '8:00–24:00',
        crowd: 'low',
      }),
      keywords: ['カフェ', 'Café Lumen'],
    },
    [
      { id: 'c1', kind: 'hours', title: '本日の営業: 8:00–24:00', detail: '現在営業中' },
      { id: 'c2', kind: 'crowd', title: '混雑: 空いています', detail: '待ち時間 0–5分' },
    ],
  ),
  pedestrian: entity('pedestrian', 'person', 'person', 0.87, {
    name: '人物',
    subtitle: '歩行者',
    summary: '人物を検出しました。プライバシー保護のため個人の特定は行いません。',
    facts: [{ key: 'motion', label: '動き', value: '歩行中' }],
    keywords: ['人物'],
  }),
};

/** Points of interest around the mock location (Odaiba). */
export const MOCK_PLACES: PlaceInfo[] = [
  place({ id: 'st-daiba', name: '台場駅', kind: 'station', address: '東京都港区台場2丁目', lat: 35.6258, lon: 139.7713, openNow: true, hours: '5:30–24:30' }),
  place({ id: 'st-odaiba-kaihinkoen', name: 'お台場海浜公園駅', kind: 'station', address: '東京都港区台場1丁目', lat: 35.6297, lon: 139.7788, openNow: true }),
  place({ id: 'cafe-lumen', name: 'Café Lumen', kind: 'cafe', address: '東京都港区台場1-7-1', lat: 35.6296, lon: 139.7751, rating: 4.4, reviewCount: 612, openNow: true, hours: '8:00–24:00' }),
  place({ id: 'seaside-mall', name: 'Seaside Mall', kind: 'store', address: '東京都港区台場1-6-1', lat: 35.6289, lon: 139.7738, rating: 4.1, openNow: true, hours: '11:00–21:00' }),
  place({ id: 'rainbow-bridge', name: 'レインボーブリッジ', kind: 'landmark', address: '東京都港区海岸3丁目', lat: 35.6365, lon: 139.7632 }),
  place({ id: 'tokyo-tower', name: '東京タワー', kind: 'landmark', address: '東京都港区芝公園4-2-8', lat: 35.6586, lon: 139.7454 }),
  place({ id: 'odaiba-park', name: 'お台場海浜公園', kind: 'park', address: '東京都港区台場1-4', lat: 35.6303, lon: 139.7762, openNow: true }),
];

export const MOCK_GEO = { lat: 35.6284, lon: 139.7737, altitude: 12, accuracy: 8, speed: 0.4, placeName: '東京湾 港区', area: 'お台場' };
