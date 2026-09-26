/**
 * On-device fine classification (ImageNet-1k, EfficientNet-Lite0) → Japanese.
 *
 * The detector says *what kind* of thing it is (COCO: dog, car, bottle…); the
 * classifier, run once on the target's crop, may refine it (breed, body
 * type, dish, bottle type…). A fine label is only accepted when it belongs to
 * the detector's class — the classifier can narrow the answer down, never
 * contradict it.
 */

type Group = { level: string; labels: Record<string, string> };

const DOG_BREEDS: Record<string, string> = {
  Chihuahua: 'チワワ', 'Japanese spaniel': '狆（ちん）', 'Maltese dog': 'マルチーズ', Pekinese: 'ペキニーズ', 'Shih-Tzu': 'シー・ズー',
  'Blenheim spaniel': 'キャバリア・キング・チャールズ・スパニエル', papillon: 'パピヨン', 'toy terrier': 'トイ・テリア', 'Rhodesian ridgeback': 'ローデシアン・リッジバック',
  'Afghan hound': 'アフガン・ハウンド', basset: 'バセット・ハウンド', beagle: 'ビーグル', bloodhound: 'ブラッドハウンド', borzoi: 'ボルゾイ',
  'Irish wolfhound': 'アイリッシュ・ウルフハウンド', 'Italian greyhound': 'イタリアン・グレーハウンド', whippet: 'ウィペット', Saluki: 'サルーキ',
  Weimaraner: 'ワイマラナー', 'Staffordshire bullterrier': 'スタッフォードシャー・ブル・テリア', 'American Staffordshire terrier': 'アメリカン・スタッフォードシャー・テリア',
  'Border terrier': 'ボーダー・テリア', 'Norfolk terrier': 'ノーフォーク・テリア', 'Norwich terrier': 'ノーリッチ・テリア', 'Yorkshire terrier': 'ヨークシャー・テリア',
  'wire-haired fox terrier': 'ワイヤー・フォックス・テリア', Airedale: 'エアデール・テリア', cairn: 'ケアーン・テリア', 'Australian terrier': 'オーストラリアン・テリア',
  'Boston bull': 'ボストン・テリア', 'miniature schnauzer': 'ミニチュア・シュナウザー', 'giant schnauzer': 'ジャイアント・シュナウザー', 'standard schnauzer': 'スタンダード・シュナウザー',
  'Scotch terrier': 'スコティッシュ・テリア', 'Tibetan terrier': 'チベタン・テリア', 'silky terrier': 'シルキー・テリア', 'West Highland white terrier': 'ウエスト・ハイランド・ホワイト・テリア',
  Lhasa: 'ラサ・アプソ', 'flat-coated retriever': 'フラットコーテッド・レトリバー', 'golden retriever': 'ゴールデン・レトリバー', 'Labrador retriever': 'ラブラドール・レトリバー',
  'German short-haired pointer': 'ジャーマン・ショートヘアード・ポインター', vizsla: 'ビズラ', 'English setter': 'イングリッシュ・セター', 'Irish setter': 'アイリッシュ・セター',
  'Brittany spaniel': 'ブリタニー・スパニエル', 'English springer': 'イングリッシュ・スプリンガー・スパニエル', 'cocker spaniel': 'コッカー・スパニエル',
  kuvasz: 'クーバース', schipperke: 'スキッパーキ', groenendael: 'ベルジアン・シェパード（グローネンダール）', malinois: 'ベルジアン・シェパード（マリノア）',
  komondor: 'コモンドール', 'Old English sheepdog': 'オールド・イングリッシュ・シープドッグ', 'Shetland sheepdog': 'シェットランド・シープドッグ', collie: 'コリー',
  'Border collie': 'ボーダー・コリー', Rottweiler: 'ロットワイラー', 'German shepherd': 'ジャーマン・シェパード', Doberman: 'ドーベルマン',
  'miniature pinscher': 'ミニチュア・ピンシャー', 'Bernese mountain dog': 'バーニーズ・マウンテン・ドッグ', boxer: 'ボクサー', 'bull mastiff': 'ブルマスティフ',
  'Tibetan mastiff': 'チベタン・マスティフ', 'French bulldog': 'フレンチ・ブルドッグ', 'Great Dane': 'グレート・デーン', 'Saint Bernard': 'セント・バーナード',
  'Eskimo dog': 'エスキモー・ドッグ', malamute: 'アラスカン・マラミュート', 'Siberian husky': 'シベリアン・ハスキー', dalmatian: 'ダルメシアン',
  affenpinscher: 'アーフェンピンシャー', basenji: 'バセンジー', pug: 'パグ', Leonberg: 'レオンベルガー', Newfoundland: 'ニューファンドランド',
  'Great Pyrenees': 'グレート・ピレニーズ', Samoyed: 'サモエド', Pomeranian: 'ポメラニアン', chow: 'チャウ・チャウ', keeshond: 'キースホンド',
  'Brabancon griffon': 'プチ・ブラバンソン', Pembroke: 'ウェルシュ・コーギー・ペンブローク', Cardigan: 'ウェルシュ・コーギー・カーディガン',
  'toy poodle': 'トイ・プードル', 'miniature poodle': 'ミニチュア・プードル', 'standard poodle': 'スタンダード・プードル', 'Mexican hairless': 'メキシカン・ヘアレス・ドッグ',
  dingo: 'ディンゴ',
};

const GROUPS: Record<string, Group> = {
  dog: { level: '犬種', labels: DOG_BREEDS },
  cat: {
    level: '猫種',
    labels: { tabby: '猫（トラ柄・タビー）', 'tiger cat': '猫（縞模様）', 'Persian cat': 'ペルシャ猫', 'Siamese cat': 'シャム猫', 'Egyptian cat': '猫（エジプシャン・マウ系）' },
  },
  bird: {
    level: '種',
    labels: {
      cock: 'ニワトリ（雄）', hen: 'ニワトリ（雌）', ostrich: 'ダチョウ', goldfinch: 'ゴシキヒワ', robin: 'コマドリ', jay: 'カケス', magpie: 'カササギ', chickadee: 'コガラ',
      kite: 'トビ', 'bald eagle': 'ハクトウワシ', vulture: 'ハゲワシ', 'great grey owl': 'カラフトフクロウ', peacock: 'クジャク', quail: 'ウズラ', 'African grey': 'ヨウム',
      macaw: 'コンゴウインコ', 'sulphur-crested cockatoo': 'キバタン', lorikeet: 'ゴシキセイガイインコ', hummingbird: 'ハチドリ', toucan: 'オオハシ', drake: 'カモ（雄）',
      goose: 'ガチョウ', 'black swan': 'コクチョウ', 'white stork': 'シュバシコウ', flamingo: 'フラミンゴ', 'little blue heron': 'ヒメアカクロサギ', 'American egret': 'ダイサギ',
      crane: 'ツル', pelican: 'ペリカン', 'king penguin': 'キングペンギン', albatross: 'アホウドリ',
    },
  },
  horse: { level: '種', labels: { sorrel: '馬（栗毛）', zebra: 'シマウマ' } },
  sheep: { level: '種', labels: { ram: 'ヒツジ', bighorn: 'ビッグホーン' } },
  cow: { level: '種', labels: { ox: '牛', 'water buffalo': '水牛', bison: 'バイソン' } },
  bear: { level: '種', labels: { 'brown bear': 'ヒグマ', 'American black bear': 'アメリカクロクマ', 'ice bear': 'ホッキョクグマ', 'sloth bear': 'ナマケグマ', 'giant panda': 'ジャイアントパンダ' } },
  elephant: { level: '種', labels: { 'Indian elephant': 'アジアゾウ', 'African elephant': 'アフリカゾウ', tusker: 'ゾウ（牙のある個体）' } },
  zebra: { level: '種', labels: { zebra: 'シマウマ' } },
  car: {
    level: 'タイプ',
    labels: {
      'sports car': 'スポーツカー', convertible: 'オープンカー', 'beach wagon': 'ステーションワゴン', cab: 'タクシー', jeep: 'SUV / クロカン', limousine: 'リムジン',
      minivan: 'ミニバン', 'Model T': 'クラシックカー（Ford Model T 風）', 'passenger car': '乗用車', pickup: 'ピックアップトラック', 'police van': 'パトカー / 警察車両',
      racer: 'レーシングカー', ambulance: '救急車', 'go-kart': 'ゴーカート', golfcart: 'ゴルフカート',
    },
  },
  truck: {
    level: 'タイプ',
    labels: { 'fire engine': '消防車', 'garbage truck': 'ごみ収集車', 'moving van': '引越しトラック / バン', 'tow truck': 'レッカー車', 'trailer truck': 'トレーラー', pickup: 'ピックアップトラック', 'police van': '警察車両', ambulance: '救急車', forklift: 'フォークリフト', tractor: 'トラクター' },
  },
  bus: { level: 'タイプ', labels: { 'school bus': 'スクールバス', minibus: 'マイクロバス', trolleybus: 'トロリーバス', 'recreational vehicle': 'キャンピングカー' } },
  train: { level: 'タイプ', labels: { 'bullet train': '高速鉄道（新幹線など）', 'electric locomotive': '電気機関車', 'steam locomotive': '蒸気機関車', streetcar: '路面電車', 'freight car': '貨車', 'passenger car': '客車' } },
  bicycle: { level: 'タイプ', labels: { 'mountain bike': 'マウンテンバイク', 'bicycle-built-for-two': 'タンデム自転車', tricycle: '三輪車', unicycle: '一輪車' } },
  motorcycle: { level: 'タイプ', labels: { moped: '原付バイク', 'motor scooter': 'スクーター', snowmobile: 'スノーモービル' } },
  boat: { level: 'タイプ', labels: { speedboat: 'モーターボート', canoe: 'カヌー', catamaran: 'カタマラン', schooner: 'スクーナー', yawl: 'ヨット', 'container ship': 'コンテナ船', liner: '客船', fireboat: '消防艇', lifeboat: '救命ボート', gondola: 'ゴンドラ', submarine: '潜水艦', 'aircraft carrier': '空母' } },
  airplane: { level: 'タイプ', labels: { airliner: '旅客機', warplane: '軍用機', airship: '飛行船', 'space shuttle': 'スペースシャトル' } },
  bottle: {
    level: '種類',
    labels: { 'pop bottle': '清涼飲料のペットボトル', 'water bottle': '水のボトル', 'wine bottle': 'ワインボトル', 'beer bottle': 'ビール瓶', 'pill bottle': '薬のボトル', 'whiskey jug': 'ウイスキーボトル', 'water jug': 'ウォータージャグ', lotion: 'ローション / 化粧品ボトル', perfume: '香水', 'hair spray': 'ヘアスプレー', 'soap dispenser': 'ソープディスペンサー', sunscreen: '日焼け止め', 'milk can': 'ミルク缶' },
  },
  cup: { level: '種類', labels: { 'coffee mug': 'マグカップ', cup: 'カップ', espresso: 'エスプレッソ', eggnog: 'ラテ / ミルク系ドリンク', 'beer glass': 'ビールグラス', goblet: 'ゴブレット', teapot: 'ティーポット', pitcher: 'ピッチャー' } },
  'wine glass': { level: '種類', labels: { 'red wine': '赤ワイン', goblet: 'ゴブレット', 'beer glass': 'ビールグラス' } },
  laptop: { level: 'タイプ', labels: { laptop: 'ノートPC', notebook: 'ノートPC（薄型）', 'hand-held computer': 'タブレット / 小型端末', 'desktop computer': 'デスクトップPC' } },
  'cell phone': { level: 'タイプ', labels: { 'cellular telephone': 'スマートフォン / 携帯電話', iPod: '携帯端末（スマートフォン / 音楽プレーヤー）', 'dial telephone': '固定電話', 'pay-phone': '公衆電話', 'hand-held computer': '携帯端末' } },
  tv: { level: 'タイプ', labels: { television: 'テレビ', monitor: 'PCモニター', screen: 'ディスプレイ', 'desktop computer': 'デスクトップPC', 'home theater': 'ホームシアター', 'entertainment center': 'テレビボード' } },
  keyboard: { level: 'タイプ', labels: { 'computer keyboard': 'PCキーボード', 'typewriter keyboard': 'キーボード', 'space bar': 'キーボード', 'grand piano': 'グランドピアノ', upright: 'アップライトピアノ' } },
  mouse: { level: 'タイプ', labels: { mouse: 'マウス' } },
  remote: { level: 'タイプ', labels: { 'remote control': 'リモコン', joystick: 'ジョイスティック / コントローラー', 'cellular telephone': '携帯電話', iPod: '携帯端末' } },
  clock: { level: 'タイプ', labels: { 'analog clock': 'アナログ時計', 'digital clock': 'デジタル時計', 'wall clock': '掛け時計', 'digital watch': 'デジタル腕時計', stopwatch: 'ストップウォッチ' } },
  backpack: { level: 'タイプ', labels: { backpack: 'リュック / バックパック', mailbag: 'メッセンジャーバッグ', 'sleeping bag': '寝袋' } },
  handbag: { level: 'タイプ', labels: { purse: 'ハンドバッグ', wallet: '財布', mailbag: 'ショルダーバッグ', backpack: 'リュック', 'shopping basket': '買い物かご' } },
  umbrella: { level: 'タイプ', labels: { umbrella: '傘', parachute: 'パラシュート' } },
  chair: { level: 'タイプ', labels: { 'folding chair': '折りたたみ椅子', 'rocking chair': 'ロッキングチェア', 'barber chair': '理容椅子', throne: '玉座風の椅子', 'park bench': 'ベンチ' } },
  couch: { level: 'タイプ', labels: { 'studio couch': 'ソファベッド', quilt: 'ソファ（カバー付き）', pillow: 'クッション' } },
  bed: { level: 'タイプ', labels: { 'four-poster': '天蓋付きベッド', crib: 'ベビーベッド', cradle: 'ゆりかご', quilt: 'ベッド（掛け布団）' } },
  'dining table': { level: 'タイプ', labels: { 'dining table': 'ダイニングテーブル', desk: 'デスク', 'pool table': 'ビリヤード台' } },
  book: { level: '種類', labels: { 'book jacket': '本（カバー付き）', 'comic book': 'マンガ / コミック', binder: 'バインダー', menu: 'メニュー', envelope: '封筒', 'crossword puzzle': 'パズル雑誌' } },
  microwave: { level: 'タイプ', labels: { microwave: '電子レンジ' } },
  oven: { level: 'タイプ', labels: { stove: 'コンロ', 'Dutch oven': 'ダッチオーブン', rotisserie: 'ロースター' } },
  toaster: { level: 'タイプ', labels: { toaster: 'トースター', 'waffle iron': 'ワッフルメーカー' } },
  refrigerator: { level: 'タイプ', labels: { refrigerator: '冷蔵庫', 'vending machine': '自動販売機' } },
  vase: { level: '種類', labels: { vase: '花瓶', pot: '植木鉢', pitcher: '水差し' } },
  scissors: { level: '種類', labels: { 'letter opener': 'ペーパーナイフ', cleaver: '包丁' } },
  'teddy bear': { level: '種類', labels: { teddy: 'テディベア' } },
  'hair drier': { level: '種類', labels: { 'hand blower': 'ドライヤー' } },
  'potted plant': { level: '種', labels: { daisy: 'デイジー', "yellow lady's slipper": 'ラン（アツモリソウ）', pot: '鉢植え' } },
  banana: { level: '種類', labels: { banana: 'バナナ' } },
  apple: { level: '品種', labels: { 'Granny Smith': '青りんご（グラニースミス）', pomegranate: 'ザクロ', fig: 'イチジク' } },
  orange: { level: '種類', labels: { orange: 'オレンジ', lemon: 'レモン' } },
  broccoli: { level: '種類', labels: { broccoli: 'ブロッコリー', cauliflower: 'カリフラワー' } },
  pizza: { level: 'メニュー', labels: { pizza: 'ピザ' } },
  sandwich: { level: 'メニュー', labels: { cheeseburger: 'チーズバーガー', hotdog: 'ホットドッグ', burrito: 'ブリトー', bagel: 'ベーグル', 'French loaf': 'バゲット' } },
  'hot dog': { level: 'メニュー', labels: { hotdog: 'ホットドッグ', burrito: 'ブリトー' } },
  donut: { level: 'メニュー', labels: { bagel: 'ベーグル', pretzel: 'プレッツェル' } },
  cake: { level: 'メニュー', labels: { trifle: 'トライフル / パフェ', 'ice cream': 'アイスクリーム', 'chocolate sauce': 'チョコレートケーキ / ソース', potpie: 'パイ' } },
  bowl: { level: 'メニュー', labels: { consomme: 'スープ', 'hot pot': '鍋料理', carbonara: 'カルボナーラ', guacamole: 'ワカモレ', 'mashed potato': 'マッシュポテト', 'soup bowl': 'スープ' } },
  'traffic light': { level: '種類', labels: { 'traffic light': '信号機' } },
  'stop sign': { level: '種類', labels: { 'street sign': '道路標識' } },
};

/** Food detections share the dish vocabulary. */
const DISHES: Record<string, string> = {
  pizza: 'ピザ', cheeseburger: 'チーズバーガー', hotdog: 'ホットドッグ', burrito: 'ブリトー', carbonara: 'カルボナーラ', 'meat loaf': 'ミートローフ',
  potpie: 'ポットパイ', consomme: 'スープ（コンソメ）', 'hot pot': '鍋料理', trifle: 'パフェ / トライフル', 'ice cream': 'アイスクリーム', 'ice lolly': 'アイスキャンディー',
  'French loaf': 'バゲット', bagel: 'ベーグル', pretzel: 'プレッツェル', 'mashed potato': 'マッシュポテト', guacamole: 'ワカモレ', espresso: 'エスプレッソ',
  eggnog: 'ラテ / ミルク系ドリンク', 'red wine': '赤ワイン', 'chocolate sauce': 'チョコレートデザート', dough: 'パン生地', strawberry: 'いちご', 'Granny Smith': '青りんご',
  lemon: 'レモン', orange: 'オレンジ', banana: 'バナナ', pineapple: 'パイナップル', pomegranate: 'ザクロ', fig: 'イチジク', broccoli: 'ブロッコリー', cucumber: 'きゅうり',
  'bell pepper': 'パプリカ', mushroom: 'きのこ', corn: 'とうもろこし', 'head cabbage': 'キャベツ', zucchini: 'ズッキーニ',
};
for (const k of ['banana', 'apple', 'orange', 'sandwich', 'hot dog', 'pizza', 'donut', 'cake', 'broccoli', 'carrot', 'bowl', 'cup']) {
  GROUPS[k] = { level: GROUPS[k]?.level ?? 'メニュー', labels: { ...DISHES, ...(GROUPS[k]?.labels ?? {}) } };
}

export interface FineLabel {
  /** Japanese name for the refined class. */
  ja: string;
  /** Classifier label (English, ImageNet). */
  en: string;
  score: number;
  /** What the refinement is (犬種, タイプ, メニュー…). */
  level: string;
}

/** Refinements consistent with the detector's COCO label, best first. */
export function refine(cocoLabel: string, classes: { label: string; score: number }[]): FineLabel[] {
  const g = GROUPS[cocoLabel];
  if (!g) return [];
  return classes
    .filter((c) => g.labels[c.label])
    .map((c) => ({ ja: g.labels[c.label], en: c.label, score: c.score, level: g.level }))
    .sort((a, b) => b.score - a.score);
}

/** Classifier results worth running at all (a refinement table exists for this class). */
export function refinable(cocoLabel: string): boolean {
  return !!GROUPS[cocoLabel];
}
