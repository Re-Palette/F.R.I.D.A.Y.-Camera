import type { MemoryHit, MemoryItem, MemoryQuery, TimeOfDay } from '../../core/types';
import { haversine } from '../../core/util';

/** Synonym groups — a lightweight stand-in for embedding search. */
const SYNONYMS: string[][] = [
  ['海', 'ビーチ', '海辺', '東京湾', '湾', 'sea', 'beach', 'ocean'],
  ['夜景', '夜', 'ライトアップ', 'night'],
  ['夕焼け', '夕暮れ', '夕方', '夕景', 'sunset', 'dusk'],
  ['東京', 'tokyo', 'お台場', '港区'],
  ['イベント', 'event', 'カンファレンス', 'ミートアップ', '展示会'],
  ['re-palette', 'repalette', 'リパレット'],
  ['橋', 'ブリッジ', 'レインボーブリッジ', 'bridge'],
  ['カフェ', 'cafe', 'コーヒー', 'coffee'],
  ['パリ', 'paris', 'フランス', 'france'],
  ['ご飯', '食事', '料理', 'メニュー', 'food'],
  ['pc', 'パソコン', 'ノートpc', 'デスク', '仕事'],
];

const TIME_WORDS: [RegExp, TimeOfDay[]][] = [
  [/朝|morning/i, ['dawn', 'morning']],
  [/昼|日中|daytime/i, ['day']],
  [/夕方|夕暮れ|夕焼け|夕景|sunset|dusk/i, ['dusk']],
  [/夜景|夜|night/i, ['night']],
];

const STOP = /(撮った|撮影した|とった|写真|画像|動画|見せて|探して|検索して|出して|ください|ある|あった|の時の|のとき|だった)/g;

function expand(term: string): string[] {
  const t = term.toLowerCase();
  const group = SYNONYMS.find((g) => g.some((w) => w === t || t.includes(w)));
  return group ? [...new Set([t, ...group])] : [t];
}

export function parseMemoryQuery(text: string, now = new Date()): MemoryQuery {
  let rest = text.trim();
  const q: MemoryQuery = { text, terms: [] };
  const y = now.getFullYear();
  const take = (re: RegExp) => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };

  let m: RegExpMatchArray | null;
  if (take(/去年|昨年|last year/i)) {
    q.from = new Date(y - 1, 0, 1);
    q.to = new Date(y, 0, 1);
  } else if (take(/一昨年/)) {
    q.from = new Date(y - 2, 0, 1);
    q.to = new Date(y - 1, 0, 1);
  } else if (take(/今年|this year/i)) {
    q.from = new Date(y, 0, 1);
    q.to = now;
  } else if (take(/先月|last month/i)) {
    q.from = new Date(y, now.getMonth() - 1, 1);
    q.to = new Date(y, now.getMonth(), 1);
  } else if (take(/今月/)) {
    q.from = new Date(y, now.getMonth(), 1);
    q.to = now;
  } else if (take(/先週|last week/i)) {
    q.from = new Date(now.getTime() - 14 * 864e5);
    q.to = new Date(now.getTime() - 7 * 864e5);
  } else if (take(/昨日|yesterday/i)) {
    const d = new Date(y, now.getMonth(), now.getDate());
    q.from = new Date(d.getTime() - 864e5);
    q.to = d;
  } else if (take(/今日|today/i)) {
    q.from = new Date(y, now.getMonth(), now.getDate());
    q.to = now;
  } else if ((m = take(/(\d+)\s*(年|ヶ月|か月|カ月)前/))) {
    const n = Number(m[1]);
    const back = new Date(now);
    if (m[2] === '年') back.setFullYear(y - n);
    else back.setMonth(now.getMonth() - n);
    q.from = new Date(back.getTime() - 20 * 864e5);
    q.to = new Date(back.getTime() + 20 * 864e5);
  } else if ((m = take(/(\d{1,2})月/))) {
    const month = Number(m[1]) - 1;
    const yr = month > now.getMonth() ? y - 1 : y;
    q.from = new Date(yr, month, 1);
    q.to = new Date(yr, month + 1, 1);
  }

  for (const [re, tods] of TIME_WORDS) {
    if (re.test(rest)) {
      q.timeOfDay = [...(q.timeOfDay ?? []), ...tods];
      // keep 夜景 as a subject term as well — it is also a tag.
      if (!/夜景/.test(rest)) rest = rest.replace(re, ' ');
    }
  }
  if (take(/この場所|ここで|ここの|この辺|near here/i)) q.nearHere = true;

  rest = rest.replace(STOP, ' ');
  q.terms = rest
    .split(/[\sのをでにはがとへ、。,.!?！？]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(こと|もの|やつ|時|とき)$/.test(s));
  return q;
}

export function scoreMemories(items: MemoryItem[], q: MemoryQuery, here?: { lat: number; lon: number } | null): MemoryHit[] {
  const hits: MemoryHit[] = [];
  for (const item of items) {
    const created = new Date(item.createdAt);
    if (q.from && created < q.from) continue;
    if (q.to && created >= q.to) continue;
    if (q.timeOfDay && (!item.timeOfDay || !q.timeOfDay.includes(item.timeOfDay))) continue;
    const reasons: string[] = [];
    let score = 0.1;
    if (q.nearHere) {
      if (!here || item.lat == null || item.lon == null) continue;
      const d = haversine(here.lat, here.lon, item.lat, item.lon);
      if (d > 1500) continue;
      score += 1.5;
      reasons.push('この場所');
    }
    const hay = [...item.tags, ...item.entities, item.place ?? '', item.scene ?? '', item.caption ?? ''].join(' ').toLowerCase();
    let missing = 0;
    for (const term of q.terms) {
      const hit = expand(term).find((w) => hay.includes(w));
      if (hit) {
        score += 1;
        reasons.push(`#${hit}`);
      } else missing += 1;
    }
    if (q.terms.length && missing === q.terms.length) continue;
    score -= missing * 0.4;
    if (q.from) reasons.unshift('期間一致');
    if (q.timeOfDay) reasons.push(q.timeOfDay.includes('night') ? '夜' : q.timeOfDay.includes('dusk') ? '夕方' : '時間帯');
    hits.push({ item, score, reasons });
  }
  return hits.sort((a, b) => b.score - a.score || b.item.createdAt.localeCompare(a.item.createdAt));
}
