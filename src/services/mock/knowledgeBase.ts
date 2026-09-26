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
      name: 'Apple MacBook Air 13-inch',
      nameEn: 'Apple MacBook Air 13-inch',
      subtitle: 'ノートPC / Apple',
      summary: 'Apple の薄型ノートPC。ディスプレイ上部のノッチとフラットな筐体から、2022年以降の世代と推定されます。',
      facts: [
        { key: 'brand', label: 'ブランド', value: 'Apple' },
        { key: 'family', label: 'シリーズ', value: 'MacBook Air' },
      ],
      officialUrl: 'https://www.apple.com/jp/macbook-air/',
      keywords: ['MacBook Air', 'Apple', 'ノートPC'],
    },
    [{ id: 'l1', kind: 'official', title: 'Apple 公式製品ページ', detail: 'apple.com/jp/macbook-air' }],
  ),
  smartphone: entity('smartphone', 'cell phone', 'phone', 0.93, {
    name: 'Apple iPhone Pro',
    subtitle: 'スマートフォン / Apple',
    summary: '背面の3眼カメラ（三角配置）とフラットなフレームから iPhone Pro 系と推定されます。世代は画像だけでは確定できません。',
    facts: [{ key: 'brand', label: 'ブランド', value: 'Apple' }],
    officialUrl: 'https://www.apple.com/jp/iphone/',
    keywords: ['iPhone', 'Apple', 'スマートフォン'],
  }),
  cola: entity('cola', 'bottle', 'product', 0.92, {
    name: 'Coca-Cola Original Taste 500ml',
    subtitle: '飲料 / 炭酸飲料',
    summary: 'コカ・コーラのペットボトル（500ml）。ラベルの文字と配色から識別しました。',
    facts: [
      { key: 'brand', label: 'ブランド', value: 'Coca-Cola' },
      { key: 'size', label: '容量表記', value: '500ml（ラベル）' },
    ],
    officialUrl: 'https://www.cocacola.co.jp/',
    keywords: ['コカ・コーラ', 'Coca-Cola', '飲料'],
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
  // ─── City scene (Ariake) ───────────────────────────────────────────────
  'big-sight': entity(
    'big-sight',
    'building',
    'building',
    0.9,
    {
      name: '東京ビッグサイト',
      nameEn: 'Tokyo Big Sight',
      subtitle: '建物 / 国際展示場',
      summary: '正式名称は東京国際展示場。展示会・見本市・イベントに利用される日本最大級の展示施設で、逆三角形を4つ並べた会議棟が象徴的です。',
      facts: [
        { key: 'official', label: '正式名称', value: '東京国際展示場' },
        { key: 'opened', label: '開業', value: '1996年4月' },
        { key: 'use', label: '用途', value: '展示会・イベント・会議' },
        { key: 'address', label: '所在地', value: '東京都江東区有明3-11-1' },
      ],
      place: place({
        id: 'big-sight',
        name: '東京ビッグサイト',
        kind: 'landmark',
        address: '東京都江東区有明3-11-1',
        lat: 35.6298,
        lon: 139.7942,
        website: 'https://www.bigsight.jp/',
        hours: 'イベントにより異なる',
      }),
      officialUrl: 'https://www.bigsight.jp/',
      keywords: ['東京ビッグサイト', '有明', '展示会', 'イベント', '東京'],
    },
    [
      { id: 'bs1', kind: 'event', title: '本日のイベント', detail: '開催中の展示会は公式サイトで確認できます' },
      { id: 'bs2', kind: 'nearby', title: '最寄り駅', detail: 'りんかい線 国際展示場駅 / ゆりかもめ 東京ビッグサイト駅' },
      { id: 'bs3', kind: 'history', title: '会議棟の建築', detail: '逆三角形を4つ組み合わせた特徴的な外観' },
    ],
    [{ title: '有明エリアで大型展示会、臨海部の交通に混雑見込み', source: 'Metro News', tier: 'news', url: 'https://example.com/news/ariake', topic: 'イベント', minutesAgo: 48 }],
  ),
  'car-tesla': entity('car-tesla', 'car', 'vehicle', 0.93, {
    name: 'Tesla Model 3',
    nameEn: 'Tesla Model 3',
    subtitle: '車両 / 電気自動車（セダン）',
    summary: 'Tesla の電気自動車（EV）セダン。外観シルエットからの推定です。',
    facts: [
      { key: 'maker', label: 'メーカー', value: 'Tesla' },
      { key: 'type', label: '種別', value: '電気自動車（EV）セダン' },
      { key: 'motion', label: '動き', value: '走行中（左→右）' },
    ],
    keywords: ['Tesla', 'Model 3', 'EV', '車'],
  }),
  'car-prius': entity('car-prius', 'car', 'vehicle', 0.91, {
    name: 'Toyota Prius',
    nameEn: 'Toyota Prius',
    subtitle: '車両 / ハイブリッド車',
    summary: 'トヨタのハイブリッド車の可能性があります（停車中・側面のみのため確信度は中程度）。',
    facts: [
      { key: 'maker', label: 'メーカー', value: 'トヨタ自動車' },
      { key: 'type', label: '種別', value: 'ハイブリッド車' },
      { key: 'motion', label: '動き', value: '停車中' },
    ],
    keywords: ['Prius', 'トヨタ', '車'],
  }),
  bicycle: entity('bicycle', 'bicycle', 'vehicle', 0.86, {
    name: '自転車',
    subtitle: '車両 / 自転車',
    summary: '自転車を検出しました。',
    facts: [{ key: 'motion', label: '動き', value: '停車中' }],
    keywords: ['自転車'],
  }),
  'traffic-light': entity('traffic-light', 'traffic light', 'road', 0.84, {
    name: '信号機',
    subtitle: '道路 / 交通信号',
    summary: '車両用の交通信号機です。',
    facts: [{ key: 'kind', label: '種別', value: '車両用信号' }],
    keywords: ['信号'],
  }),
  'sign-bigsight': entity('sign-bigsight', 'sign', 'sign', 0.9, {
    name: '案内標識',
    subtitle: '標識 / 日本語・英語',
    summary: '「東京ビッグサイト Tokyo Big Sight →」「有明 Ariake」と書かれた案内標識です。',
    facts: [
      { key: 'text', label: '文字', value: '東京ビッグサイト / Tokyo Big Sight →' },
      { key: 'lang', label: '言語', value: '日本語・英語' },
    ],
    keywords: ['標識', '東京ビッグサイト', '有明'],
  }),
  'unknown-box': entity('unknown-box', 'object', 'other', 0.52, {
    name: '不明な物体',
    subtitle: '物体 / 未識別',
    summary: '形状からは何か特定できませんでした。「これについて調べて」で画像検索できます。',
    facts: [],
    keywords: [],
  }),
  'person-1': entity('person-1', 'person', 'person', 0.9, { name: '人物', subtitle: '人物', summary: '人物を検出しました。個人の特定は行いません。', facts: [], keywords: [] }),
  'person-2': entity('person-2', 'person', 'person', 0.88, { name: '人物', subtitle: '人物', summary: '人物を検出しました。個人の特定は行いません。', facts: [], keywords: [] }),
  'person-3': entity('person-3', 'person', 'person', 0.86, { name: '人物', subtitle: '人物', summary: '人物を検出しました。個人の特定は行いません。', facts: [], keywords: [] }),
  // ─── Desk / street additions ───────────────────────────────────────────
  headphones: entity('headphones', 'headphones', 'product', 0.9, {
    name: 'SONY WH-1000XM6',
    nameEn: 'Sony WH-1000XM6',
    subtitle: '商品 / ワイヤレスヘッドホン',
    summary: 'ソニーのワイヤレス・ノイズキャンセリングヘッドホン。価格は「いくら？」で検索します。',
    facts: [
      { key: 'maker', label: 'ブランド', value: 'SONY' },
      { key: 'model', label: '型番', value: 'WH-1000XM6' },
      { key: 'category', label: 'カテゴリー', value: 'ノイズキャンセリングヘッドホン' },
    ],
    officialUrl: 'https://www.sony.jp/headphone/',
    keywords: ['SONY', 'WH-1000XM6', 'ヘッドホン'],
  }),
  monstera: entity('monstera', 'potted plant', 'plant', 0.88, {
    name: 'モンステラ',
    nameEn: 'Monstera deliciosa',
    subtitle: '植物 / サトイモ科',
    summary: '切れ込みの入った大きな葉が特徴の観葉植物。原産は中南米の熱帯地域です。',
    facts: [
      { key: 'sci', label: '学名', value: 'Monstera deliciosa' },
      { key: 'family', label: '科', value: 'サトイモ科' },
      { key: 'origin', label: '原産', value: '中南米' },
    ],
    keywords: ['モンステラ', '観葉植物'],
  }),
  cat: entity('cat', 'cat', 'animal', 0.95, {
    name: '猫',
    nameEn: 'Cat',
    subtitle: '動物 / イエネコ',
    summary: '猫（イエネコ）を検出しました。',
    facts: [{ key: 'sci', label: '学名', value: 'Felis catus' }],
    keywords: ['猫'],
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
  place({ id: 'big-sight', name: '東京ビッグサイト', kind: 'landmark', address: '東京都江東区有明3-11-1', lat: 35.6298, lon: 139.7942, website: 'https://www.bigsight.jp/' }),
];

export const MOCK_GEO = { lat: 35.6284, lon: 139.7737, altitude: 12, accuracy: 8, speed: 0.4, placeName: '東京湾 港区', area: 'お台場' };

/**
 * Tier-1 (what the fast detector says) → tier-2 (what identification says)
 * for each demo object. `delayMs` simulates cloud identification latency.
 */
export interface MockIdentitySpec {
  generic: string;
  kind: import('../../core/types').IdentityKind;
  name: string;
  nameEn?: string;
  confidence: number;
  detail?: string;
  candidates?: import('../../core/types').IdentityCandidate[];
  attributes?: Record<string, string>;
  /** Text the mock OCR reads on the target. */
  ocr?: string[];
  /** LEVEL 2 appearance analysis. */
  features?: import('../../core/types').VisualFeature[];
  /** What a web check against official pages would return (mock). */
  verification?: Omit<import('../../core/types').Verification, 'at'>;
  delayMs: number;
}

const V = (key: import('../../core/types').VisualFeature['key'], label: string, value: string, source: 'visual' | 'ocr' = 'visual') => ({ key, label, value, source });

export const MOCK_IDENTITY: Record<string, MockIdentitySpec> = {
  'rainbow-bridge': { generic: '橋', kind: 'landmark', name: 'レインボーブリッジ', nameEn: 'Rainbow Bridge', confidence: 0.95, detail: '吊り橋 / 1993年開通', delayMs: 900 },
  'tokyo-tower': { generic: '塔', kind: 'landmark', name: '東京タワー', nameEn: 'Tokyo Tower', confidence: 0.91, detail: '電波塔 / 333 m', delayMs: 1200 },
  yakatabune: { generic: '船', kind: 'vehicle', name: '屋形船', confidence: 0.74, detail: '観光クルーズ船の可能性', delayMs: 1400 },
  'big-sight': { generic: '建物', kind: 'building', name: '東京ビッグサイト', nameEn: 'Tokyo Big Sight', confidence: 0.94, detail: '国際展示場 / 江東区有明', delayMs: 1500 },
  'car-tesla': {
    generic: '乗用車',
    kind: 'vehicle',
    name: 'Tesla Model 3',
    confidence: 0.89,
    features: [
      V('design', 'フロント', 'グリルレス・薄型ヘッドライト'),
      V('shape', 'シルエット', 'ファストバックのセダン'),
      V('color', 'カラー', 'ホワイト'),
      V('other', 'ナンバープレート', '読み取り・保存しません'),
    ],
    candidates: [
      { name: 'Tesla Model 3', brand: 'Tesla', family: 'Model 3', variant: '2024 refresh / Highland', confidence: 0.89, evidence: ['薄型ヘッドライト', 'グリルレス'] },
      { name: 'Tesla Model Y', brand: 'Tesla', family: 'Model Y', confidence: 0.31, evidence: ['フロント形状'] },
    ],
    verification: {
      status: 'verified',
      matched: ['Tesla 公式の Model 3 外観（薄型ライト）と一致（モック照合）'],
      sources: [{ title: 'Model 3 | Tesla', url: 'https://www.tesla.com/ja_jp/model3', publisher: 'Tesla', tier: 'official' }],
      facts: [{ key: 'type', label: '種別', value: '電気自動車（セダン）' }],
    },
    delayMs: 1200,
  },
  'car-prius': {
    generic: '乗用車',
    kind: 'vehicle',
    name: 'Toyota Prius',
    confidence: 0.62,
    detail: 'ハイブリッド車の可能性',
    candidates: [
      { name: 'Toyota Prius', confidence: 0.62 },
      { name: 'Toyota Aqua', confidence: 0.21 },
    ],
    delayMs: 1300,
  },
  bicycle: { generic: '自転車', kind: 'vehicle', name: '自転車', confidence: 0.86, detail: 'シティサイクル', delayMs: 800 },
  'traffic-light': { generic: '信号機', kind: 'generic', name: '信号機', confidence: 0.84, detail: '車両用', delayMs: 700 },
  'sign-bigsight': { generic: '標識', kind: 'text', name: '東京ビッグサイト Tokyo Big Sight →', confidence: 0.9, detail: '日本語 / 英語', delayMs: 600 },
  'unknown-box': { generic: '物体', kind: 'generic', name: '', confidence: 0.31, detail: '形状から特定できません', delayMs: 1600 },
  laptop: {
    generic: 'ノートPC',
    kind: 'product',
    name: 'Apple MacBook Air 13-inch',
    confidence: 0.9,
    ocr: [],
    features: [
      V('design', 'デザイン', 'フラットな薄型アルミニウム筐体（Apple 系の設計）'),
      V('display', 'ディスプレイ', '上部中央にノッチ・狭額縁'),
      V('color', 'カラー', 'ミッドナイト（濃紺）'),
      V('material', '素材', 'アルミニウム（外観から推定）'),
      V('layout', 'キーボード', 'フルハイトのファンクションキー列'),
    ],
    candidates: [
      { name: 'Apple MacBook Air 13-inch', brand: 'Apple', family: 'MacBook Air', model: '13-inch', variant: 'M2 / M3 / M4 世代', confidence: 0.9, evidence: ['ノッチ付きディスプレイ', 'フラット筐体', 'ミッドナイト色'] },
      { name: 'Apple MacBook Pro 14-inch', brand: 'Apple', family: 'MacBook Pro', model: '14-inch', confidence: 0.46, evidence: ['ノッチ付きディスプレイ'] },
      { name: 'Microsoft Surface Laptop', brand: 'Microsoft', family: 'Surface Laptop', confidence: 0.12 },
    ],
    verification: {
      status: 'verified',
      matched: ['Apple 公式製品ページの外観（ノッチ付き 13.6 インチ・ミッドナイト）と一致（モック照合）'],
      sources: [{ title: 'MacBook Air - Apple（日本）', url: 'https://www.apple.com/jp/macbook-air/', publisher: 'Apple', tier: 'official' }],
      facts: [
        { key: 'display', label: 'ディスプレイ', value: '13.6 インチ Liquid Retina（13-inch モデル）' },
        { key: 'color', label: 'カラー展開', value: 'ミッドナイトを含む' },
      ],
    },
    delayMs: 1500,
  },
  headphones: {
    generic: 'ヘッドホン',
    kind: 'product',
    name: 'Sony WH-1000XM6',
    confidence: 0.86,
    ocr: ['SONY'],
    features: [
      V('design', 'デザイン', 'オーバーイヤー・ヘッドバンド型'),
      V('color', 'カラー', 'ブラック'),
      V('layout', 'ボタン配置', '左ハウジングに物理ボタン'),
    ],
    candidates: [
      { name: 'Sony WH-1000XM6', brand: 'Sony', family: 'WH-1000X', model: 'WH-1000XM6', confidence: 0.86, evidence: ['ハウジング形状', 'ヘッドバンド形状'] },
      { name: 'Sony WH-1000XM5', brand: 'Sony', family: 'WH-1000X', model: 'WH-1000XM5', confidence: 0.58, evidence: ['ハウジング形状'] },
      { name: 'Bose QuietComfort Ultra Headphones', brand: 'Bose', confidence: 0.1 },
    ],
    verification: {
      status: 'verified',
      matched: ['ソニー公式ヘッドホンページの製品外観と一致（モック照合）'],
      sources: [{ title: 'ヘッドホン | ソニー', url: 'https://www.sony.jp/headphone/', publisher: 'Sony', tier: 'official' }],
      facts: [{ key: 'cat', label: 'カテゴリー', value: 'ワイヤレス・ノイズキャンセリングヘッドホン' }],
    },
    delayMs: 1300,
  },
  smartphone: {
    generic: 'スマートフォン',
    kind: 'product',
    name: 'Apple iPhone Pro',
    confidence: 0.71,
    ocr: [],
    features: [
      V('layout', 'カメラ配置', '背面左上に3眼（三角配置）＋フラッシュ'),
      V('logo', 'ロゴ', '背面中央に Apple ロゴ'),
      V('design', 'フレーム', 'フラットエッジ'),
      V('color', 'カラー', 'シルバー系'),
    ],
    candidates: [
      { name: 'Apple iPhone 16 Pro', brand: 'Apple', family: 'iPhone Pro', model: '16 Pro', confidence: 0.71, evidence: ['3眼・三角配置', 'フラットエッジ'] },
      { name: 'Apple iPhone 15 Pro', brand: 'Apple', family: 'iPhone Pro', model: '15 Pro', confidence: 0.52, evidence: ['3眼・三角配置'] },
      { name: 'Samsung Galaxy S25 Ultra', brand: 'Samsung', family: 'Galaxy S', model: 'S25 Ultra', confidence: 0.08 },
    ],
    verification: {
      status: 'partial',
      matched: ['Apple 公式ページ: 3眼・三角配置は複数世代で共通のため世代は確定できません（モック照合）'],
      sources: [{ title: 'iPhone - Apple（日本）', url: 'https://www.apple.com/jp/iphone/', publisher: 'Apple', tier: 'official' }],
      facts: [],
    },
    delayMs: 1400,
  },
  cola: {
    generic: 'ボトル',
    kind: 'product',
    name: 'Coca-Cola Original Taste 500ml',
    confidence: 0.88,
    ocr: ['Coca-Cola', 'Original Taste', '500ml'],
    features: [
      V('package', 'パッケージ', 'ペットボトル・赤いラベル'),
      V('logo', 'ロゴ', '白い筆記体ロゴ'),
      V('shape', '形状', 'くびれのあるボトル形状'),
    ],
    candidates: [
      { name: 'Coca-Cola Original Taste 500ml', brand: 'Coca-Cola', family: 'Coca-Cola', model: 'Original Taste 500ml', confidence: 0.88, evidence: ['赤ラベル', '筆記体ロゴ'] },
      { name: 'Coca-Cola Zero Sugar 500ml', brand: 'Coca-Cola', family: 'Coca-Cola', model: 'Zero Sugar 500ml', confidence: 0.21, evidence: ['ボトル形状'] },
    ],
    verification: {
      status: 'verified',
      matched: ['コカ・コーラ公式サイトの製品ラベルと一致（モック照合）'],
      sources: [{ title: 'コカ・コーラ 公式サイト', url: 'https://www.cocacola.co.jp/', publisher: 'Coca-Cola Japan', tier: 'official' }],
      facts: [],
    },
    delayMs: 1100,
  },
  coffee: {
    generic: 'カップ',
    kind: 'food',
    name: 'カフェラテ',
    confidence: 0.64,
    detail: '推定材料: エスプレッソ・スチームミルク',
    candidates: [
      { name: 'カフェラテ', confidence: 0.64 },
      { name: 'カプチーノ', confidence: 0.24 },
    ],
    delayMs: 900,
  },
  monstera: {
    generic: '観葉植物',
    kind: 'plant',
    name: 'モンステラ・デリシオーサ',
    nameEn: 'Monstera deliciosa',
    confidence: 0.91,
    features: [V('shape', '葉', '深い切れ込みと穴のある大型の葉'), V('other', '生育', '鉢植え')],
    candidates: [
      { name: 'モンステラ・デリシオーサ', brand: 'サトイモ科', family: 'モンステラ属', model: 'Monstera deliciosa', confidence: 0.91, evidence: ['葉の切れ込み'] },
      { name: 'ヒメモンステラ', brand: 'サトイモ科', family: 'ラフィドフォラ属', confidence: 0.18 },
    ],
    delayMs: 1300,
  },
  cat: { generic: '猫', kind: 'animal', name: '猫', nameEn: 'Cat', confidence: 0.99, detail: 'イエネコ', delayMs: 500 },
  menu: { generic: 'テキスト', kind: 'text', name: 'CAFÉ DU PONT メニュー', confidence: 0.96, detail: 'フランス語', delayMs: 600 },
  car: { generic: '乗用車', kind: 'vehicle', name: 'セダン', confidence: 0.58, detail: 'ヘッドライトのみで車種は判別困難', delayMs: 1000 },
  cone: { generic: 'コーン', kind: 'generic', name: '工事用コーン', confidence: 0.9, delayMs: 600 },
  'cafe-lumen': { generic: '看板', kind: 'building', name: 'Café Lumen', confidence: 0.89, detail: 'カフェ（デモ用架空店舗）', delayMs: 900 },
};
