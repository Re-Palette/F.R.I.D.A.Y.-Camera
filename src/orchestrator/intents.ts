import type { Intent, IntentKind } from '../core/types';

interface Rule {
  kind: IntentKind;
  re: RegExp;
  /** Extracts the subject of the request (search terms, destination, …). */
  query?: (text: string, m: RegExpMatchArray) => string | undefined;
  params?: (text: string, m: RegExpMatchArray) => Record<string, string>;
}

const strip = (s: string) =>
  s
    .replace(/^(ねえ|ねぇ|ヘイ|hey|ok|オーケー)?\s*(friday|フライデー)[、,\s]*/i, '')
    .replace(/[。！？!?]+$/, '')
    .trim();

/** Words that point at "the thing I'm looking at" / previous topic. */
const DEICTIC = /(これ|それ|あれ|この|その|あの|ここ|そこ|あそこ|こいつ|this|that|it\b)/i;
/** Questions that only make sense about the current focus (follow-ups). */
const FOLLOW_UP = /^(いつ|何年|どのくらい|どれくらい|高さ|長さ|値段|価格|いくら|評価|営業|何時|誰が|なぜ|どうして|夜に|昼に|名前の由来|何の|なんの|用途|どこの|メーカー|学名)/;

const RULES: Rule[] = [
  { kind: 'record_stop', re: /(録画|撮影|動画).*(止め|停止|終わ|ストップ)|stop recording/i },
  { kind: 'record_start', re: /(録画|動画).*(開始|始め|撮って|スタート|回して)|start recording|record (a )?video/i },
  {
    kind: 'capture_photo',
    re: /(写真|シャッター|スクショ)を?(撮って|撮る|とって|切って|お願い)|撮影して|^撮って|take (a )?(photo|picture)|^(はい)?チーズ/i,
    params: (t): Record<string, string> => {
      const m = t.match(/(\d+)\s*秒/);
      return m ? { timer: m[1] } : {};
    },
  },
  { kind: 'open_url', re: /(公式)?(サイト|ホームページ|HP|ウェブページ|webサイト).*(開いて|開く|見せて|表示)|open (the )?(official )?(site|website|page)/i },
  { kind: 'switch_camera', re: /(カメラ|インカメ|自撮り).*(切り替|切替|反転|変え)|selfie|flip camera/i },
  {
    kind: 'zoom',
    re: /(ズーム|拡大|zoom)/i,
    params: (t) => {
      const m = t.match(/(\d+(?:\.\d+)?)\s*(倍|x)/i);
      return { zoom: m ? m[1] : /戻|リセット|解除|out/i.test(t) ? '1' : '2' };
    },
  },
  { kind: 'unlock', re: /(ロック|追跡).*(解除|やめ|外して)|unlock|release target/i },
  { kind: 'lock', re: /(ロック|追跡|ターゲット).*(して|オン|開始)|lock on|track (this|it)/i },
  {
    kind: 'translate',
    re: /(翻訳|訳して|日本語にして|何て書いて|なんて書いて|translate)/i,
    params: (t) => ({ target: /英語|english/i.test(t) ? 'en' : 'ja' }),
  },
  { kind: 'ocr', re: /(文字|テキスト).*(読んで|読み取|認識)|読み上げて|(書類|文書|レシート|画面|メニュー|看板|本|ページ).*(要約|説明)|read (this|the text)/i },
  {
    kind: 'weather',
    re: /(天気|気温|雨|傘|湿度|風速|紫外線|UV|日没|weather)/i,
    params: (t) => ({ when: /明日|あした|tomorrow/i.test(t) ? 'tomorrow' : 'now' }),
  },
  {
    kind: 'navigate',
    re: /(ナビ|案内|道順|行き方|連れて|どっち|方向|navigate|directions)/i,
    query: (t) =>
      t
        .replace(/(まで|へ|に)?(の)?(ナビして|ナビ|案内して|案内|道順|行き方を?教えて|行き方|連れてって|連れて行って|はどっち|どっち|方向|を教えて)/g, '')
        .replace(/^(最寄りの|近くの|一番近い)/, '')
        .trim() || undefined,
  },
  {
    kind: 'memory_search',
    re: /(写真|画像|動画|アルバム|思い出|メモリー).*(探して|見せて|検索|出して|どこ|ある)|(撮った|撮影した).*(写真|画像|動画|見せて|探して|出して)|photos? (of|from)/i,
    query: (t) => t,
  },
  {
    kind: 'social',
    re: /(インスタ|instagram|linkedin|リンクトイン|note|ノート記事|投稿文|キャプション|ハッシュタグ|リール)/i,
    params: (t) => ({ platform: /linkedin|リンクトイン/i.test(t) ? 'linkedin' : /note|ノート/i.test(t) ? 'note' : 'instagram' }),
  },
  { kind: 'scene', re: /(周り|周囲|景色|状況|ここはどこ|今どこ|混雑|混んで|what.*around)/i },
  { kind: 'product_info', re: /(値段|価格|いくら|最安|スペック|仕様|レビュー|口コミ|メーカー|CPU|チップ|メモリ|ストレージ|容量|年式|グレード)/i },
  { kind: 'place_info', re: /(営業時間|何時まで|開いて|住所|評価|星いくつ)/i },
  {
    kind: 'search',
    re: /(調べて|検索|ググって|教えて|について|最新|ニュース|search|look up)/i,
    query: (t) =>
      t
        .replace(/(について)?(を)?(調べて|検索して|検索|ググって|詳しく教えて|教えて)(ください)?/g, '')
        .trim() || undefined,
  },
  { kind: 'identify', re: /(これ|それ|あれ|この|あの).*(何|なに|なん|誰|どこ)|^(何|なに)(これ|それ)|what('?s| is) (this|that)|identify/i },
];

/**
 * Rule-based intent router (Japanese-first, English aware). Runs locally and
 * instantly; a model-based classifier (`LLMService.classify`) can override it.
 */
export function classifyIntent(raw: string, hasFocus: boolean): Intent {
  const text = strip(raw);
  const referential = DEICTIC.test(text) || FOLLOW_UP.test(text);
  for (const r of RULES) {
    const m = text.match(r.re);
    if (!m) continue;
    // "これについて調べて" / "夜に行くなら？" are searches about the focus.
    return {
      kind: r.kind,
      text,
      query: r.query?.(text, m),
      params: r.params?.(text, m),
      referential,
    };
  }
  if (hasFocus && (referential || /(行くなら|おすすめ|周辺|近く|歴史|由来)/.test(text))) {
    const needsWeb = /(行くなら|おすすめ|周辺|近く|なら[？?]?$|歴史|由来|最新)/.test(text);
    return { kind: needsWeb ? 'search' : 'chat', text, query: text, referential: true };
  }
  return { kind: 'chat', text, referential };
}
