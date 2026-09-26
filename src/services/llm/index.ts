import type { EntityProfile, Identification, Intent } from '../../core/types';
import { cardinal, fmtDateJa, fmtDistance, relativeJa, sleep } from '../../core/util';
import type { Grounding, LLMRequest, LLMService, WorldContext } from '../contracts';
import { postJson, postStream } from '../http';

const DIR_JA: Record<string, string> = { N: '北', NE: '北東', E: '東', SE: '南東', S: '南', SW: '南西', W: '西', NW: '北西' };

function factAnswer(p: EntityProfile, text: string): string | null {
  const f = (k: string) => p.facts.find((x) => x.key === k)?.value;
  if (/いつ|何年|できた|開通|完成|建て/.test(text)) {
    const v = f('opened');
    if (v) return `${p.name}は${v}に${p.id === 'tokyo-tower' ? '完成' : p.id === 'big-sight' ? '開業' : '開通'}しました。`;
  }
  if (/高さ|高い|何メートル/.test(text) && f('height')) return `${p.name}の高さは${f('height')}です。`;
  if (/長さ|全長|長い/.test(text) && f('length')) return `${p.name}の全長は${f('length')}です。`;
  if (/営業|何時|開いて/.test(text)) {
    const h = f('hours') ?? p.place?.hours;
    if (h) return `${p.name}の営業時間は${h}です。${p.place?.openNow ? '現在営業中です。' : ''}`;
  }
  if (/値段|価格|いくら/.test(text) && p.product) return `${p.product.name}は¥${p.product.priceJPY.toLocaleString()}です。最安は${[...p.product.offers].sort((a, b) => a.priceJPY - b.priceJPY)[0].store}です。`;
  if (/評価|レビュー|評判/.test(text)) {
    if (p.product) return `レビュー平均は★${p.product.rating}（${p.product.reviewCount}件）。${p.product.reviewSummary}`;
    if (p.place?.rating) return `評価は★${p.place.rating}（${p.place.reviewCount?.toLocaleString()}件）です。`;
  }
  if (/メーカー|どこの/.test(text) && p.product) return `${p.product.maker}の製品です。`;
  if (/メーカー|どこの|ブランド/.test(text) && (f('maker') || p.identity?.attributes?.['ブランド'] || p.identity?.attributes?.['メーカー']))
    return `${f('maker') ?? p.identity?.attributes?.['ブランド'] ?? p.identity?.attributes?.['メーカー']}の製品です。`;
  if (/何の|なんの|用途|何に使/.test(text)) {
    const use = f('use');
    return use ? `${p.summary.split('。')[0]}。主な用途は${use}です。` : `${p.summary.split('。')[0]}。`;
  }
  if (/学名/.test(text) && (f('sci') || p.identity?.attributes?.['学名'])) return `学名は${f('sci') ?? p.identity?.attributes?.['学名']}です。`;
  return null;
}

/**
 * Uncertainty-aware naming. Never overstates: IDENTIFIED → 推定されます,
 * POSSIBLE → 可能性があります (with %), UNKNOWN → 特定できません. People are
 * only ever "人物".
 */
export function identityPhrase(p: EntityProfile): string {
  const id = p.identity;
  const pct = id ? Math.round(id.confidence * 100) : 0;
  if (p.category === 'person' || id?.kind === 'person') return '人物を検出しました。個人の特定は行いません。';
  if (!id) return `${p.name}を検出しています。`;
  if (id.status === 'detected') return `${p.name}を検出しています（確信度${Math.round(id.confidence * 100)}%）。${noteSentence(id.note)}`;
  if (id.status === 'identifying') return `${p.name}を識別中です。`;
  if (id.status === 'unknown') return `何かは特定できませんでした（確信度${pct}%）。「これについて調べて」と言えば画像検索します。`;
  const brand = id.attributes?.['ブランド'];
  const label = brand && !p.name.toUpperCase().startsWith(brand.toUpperCase()) ? `${brand}の${p.name}` : p.name;
  const head = id.status === 'possible' ? `${label}の可能性があります（確信度${pct}%）。` : `${label}と推定されます。`;
  return `${head}${noteSentence(id.note)}${webSentence(id)}`;
}

/** "モデル：16 Proの可能性" → "モデルは16 Proの可能性があります。" */
export function noteSentence(note?: string): string {
  if (!note) return '';
  const n = note.replace(/^(.+?)：/, '$1は');
  return /の可能性$/.test(n) ? `${n}があります。` : `${n}。`;
}

/** What the web check added — kept apart from what was inferred from the image. */
function webSentence(id: Identification): string {
  switch (id.verification?.status) {
    case 'verified':
      return '公式情報とも一致しました。';
    case 'partial':
      return '公式情報とは一部のみ一致しています。';
    case 'contradicted':
      return 'ただし、Web上の公式情報とは一致しない点があります。';
    default:
      return '';
  }
}

const SPEC_ASKS: { re: RegExp; unknown: string[]; fact?: string }[] = [
  { re: /CPU|チップ|SoC|プロセッサ/i, unknown: ['CPU / SoC'] },
  { re: /メモリ|RAM/i, unknown: ['メモリ'] },
  { re: /ストレージ|SSD/i, unknown: ['ストレージ', 'ストレージ容量'] },
  { re: /容量/, unknown: ['ストレージ容量', 'ストレージ'], fact: 'size' },
  { re: /年式|何年式|世代/, unknown: ['正確な年式'] },
  { re: /グレード|トリム/, unknown: ['グレード'] },
];

/**
 * Spec questions: answer only what the image, its text or a web source
 * showed — anything else is said to be unknown, never guessed.
 */
export function specAnswer(p: EntityProfile, text: string): string | null {
  const id = p.identity;
  if (!id || p.category === 'person') return null;
  const unknown = id.unknown ?? [];
  for (const a of SPEC_ASKS) {
    if (!a.re.test(text)) continue;
    const fact = a.fact && p.facts.find((x) => x.key === a.fact);
    if (fact) return `${fact.label}は${fact.value}です。`;
    if (/世代/.test(text) && id.note) return `${noteSentence(id.note)}画像だけでは世代を確定できません。`;
    const hit = unknown.find((u) => a.unknown.includes(u));
    if (hit) return `${hit}は画像からは判別できません。${id.officialUrl ? '公式サイトで確認できます。' : '「詳しく調べて」と言えば検索します。'}`;
  }
  if (/スペック|仕様/.test(text) && !p.product) {
    const web = id.verification?.status === 'verified' || id.verification?.status === 'partial' ? id.verification.facts : [];
    const seen = web.length ? `公式情報で確認できた内容：${web.map((f) => `${f.label} ${f.value}`).join('、')}。` : '';
    const unk = unknown.length ? `${unknown.join('・')}は画像からは判別できません。` : '';
    return seen || unk ? `${seen}${unk}` : null;
  }
  return null;
}

/** Turns grounded tool output into a short, spoken-style Japanese answer. */
export function verbalize(intent: Intent, g: Grounding | undefined, ctx: WorldContext): string {
  const focus = ctx.focus;
  switch (g?.kind) {
    case 'profile': {
      const p = g.profile;
      if (!p) return '対象を特定できませんでした。もう少し近づけてみてください。';
      const spec = intent.kind !== 'identify' ? specAnswer(p, intent.text) : null;
      if (spec) return spec;
      if (intent.kind === 'identify' || intent.kind === 'place_info' || intent.kind === 'product_info') {
        const extra = p.product ? `価格は¥${p.product.priceJPY.toLocaleString()}前後です。` : p.place?.hours ? `営業時間は${p.place.hours}。` : '';
        return `${identityPhrase(p)}${p.identity?.status === 'identified' || p.identity?.status === 'possible' ? p.summary.split('。')[0] + '。' : ''}${extra}`;
      }
      return factAnswer(p, intent.text) ?? `${identityPhrase(p)}${p.summary}`;
    }
    case 'link':
      if (!g.url) return '公式サイトが見つかりませんでした。「詳しく調べて」で検索できます。';
      return g.opened ? `${g.label}を開きます。` : `${g.label}のリンクを表示しました。タップして開いてください。`;
    case 'search':
      return g.answer.summary;
    case 'weather': {
      const r = g.report;
      if (g.when === 'tomorrow') {
        const t = r.tomorrow;
        return `明日の${r.locationLabel}は${t.condition}の予報です。最高気温は${t.maxC}°C、最低気温は${t.minC}°Cです。降水確率は${t.precipProb}%です。`;
      }
      return `現在の${r.locationLabel}は${r.now.condition}、${r.now.tempC}°Cです。湿度${r.now.humidity}%、風速${r.now.windMs}m/s。日没は${r.now.sunset}です。`;
    }
    case 'memory': {
      if (!g.hits.length) return '条件に合う写真は見つかりませんでした。';
      const top = g.hits[0].item;
      return `${g.hits.length}枚見つかりました。いちばん近いのは${relativeJa(top.createdAt)}、${fmtDateJa(new Date(top.createdAt))}に${top.place ?? ''}で撮った写真です。`;
    }
    case 'nav': {
      const t = g.target;
      if (!t) return `「${g.query}」の目的地が見つかりませんでした。`;
      return `${t.name}は${DIR_JA[cardinal(t.bearingDeg)]}に${fmtDistance(t.distanceM)}、徒歩${t.eta.walkMin}分です。矢印の方向へ進んでください。`;
    }
    case 'translation': {
      if (!g.items.length) return '翻訳できる文字が見つかりませんでした。';
      if (intent.kind === 'ocr') {
        const lines = g.items.map((i) => i.target.split('—')[0].trim()).filter((t, i) => i > 0 && t.length < 30);
        return `${g.items[0].target.split('—')[0].trim()}の内容です。${lines.slice(0, 5).join('、')}などが載っています。`;
      }
      const first = g.items.find((i) => /—/.test(i.source)) ?? g.items[0];
      return `${g.items.length}行を日本語に翻訳しました。たとえば「${first.source.split('—')[0].trim()}」は「${first.target.split('—')[0].trim()}」です。`;
    }
    case 'capture': {
      const tags = g.item.tags.slice(0, 3).join('・');
      return `撮影しました。「${tags}」としてメモリーに保存しました。`;
    }
    case 'record':
      return g.recording ? '録画を開始しました。' : '録画を停止して保存しました。';
    case 'scene':
      return g.scene ? `${g.scene.summary}。${g.scene.environment ?? ''}${g.scene.crowd ? `、混雑は${{ low: '少なめ', moderate: '普通', high: '多め' }[g.scene.crowd]}` : ''}です。` : '周囲を解析中です。';
    case 'social':
      return `${{ instagram: 'Instagram', linkedin: 'LinkedIn', note: 'note' }[g.draft.platform]}用の投稿案を作りました。${g.draft.caption.split('\n')[0]}`;
    case 'ack':
      return g.action;
    default:
      break;
  }
  if (focus) {
    const f = factAnswer(focus, intent.text);
    if (f) return f;
  }
  if (/こんにちは|おはよう|こんばんは|hello|hi\b/i.test(intent.text)) return 'F.R.I.D.A.Y.です。カメラを向けるか、話しかけてください。';
  if (/ありがとう|thanks/i.test(intent.text)) return 'どういたしまして。';
  if (/何ができる|使い方|help/i.test(intent.text))
    return '見ているものの識別、検索、翻訳、ナビ、撮影、写真の検索ができます。「これは何？」と聞いてみてください。';
  return focus ? `${focus.name}について、ほかに知りたいことはありますか？` : 'すみません、もう一度お願いします。';
}

export class MockLLMService implements LLMService {
  readonly mode = 'mock' as const;
  async respond(req: LLMRequest, onToken: (c: string) => void, signal?: AbortSignal) {
    const text = verbalize(req.intent, req.grounding, req.context);
    // Simulated streaming so the HUD's typing / SPEAKING states behave like a real model.
    for (let i = 0; i < text.length; i += 3) {
      onToken(text.slice(i, i + 3));
      await sleep(22, signal);
    }
    return text;
  }
}

/**
 * POST /llm/respond (NDJSON: {"type":"token","text":"…"}) — the gateway calls
 * the LLM (e.g. Claude) with the conversation history, compact world context
 * and grounding, and streams tokens back.
 * POST /llm/classify → Intent | null (optional model-based intent routing).
 */
export class RemoteLLMService implements LLMService {
  readonly mode = 'real' as const;
  async respond(req: LLMRequest, onToken: (c: string) => void, signal?: AbortSignal) {
    let full = '';
    await postStream(
      '/llm/respond',
      {
        utterance: req.utterance,
        intent: req.intent,
        history: req.history.slice(-12).map(({ role, text }) => ({ role, text })),
        context: compactContext(req.context),
        grounding: req.grounding,
      },
      (e) => {
        if (e.type === 'token' && typeof e.text === 'string') {
          full += e.text;
          onToken(e.text);
        }
      },
      signal,
    );
    return full;
  }
  classify(utterance: string, context: WorldContext) {
    return postJson<Intent | null>('/llm/classify', { utterance, context: compactContext(context) }).catch(() => null);
  }
}

function compactContext(c: WorldContext) {
  return {
    now: c.now.toISOString(),
    focus: c.focus ? { id: c.focus.id, name: c.focus.name, subtitle: c.focus.subtitle, facts: c.focus.facts } : null,
    detections: c.detections.slice(0, 8).map((d) => ({ name: d.displayName, category: d.category, confidence: +d.confidence.toFixed(2) })),
    scene: c.scene ? { summary: c.scene.summary, tags: c.scene.tags, timeOfDay: c.scene.timeOfDay } : null,
    geo: c.geo ? { lat: c.geo.lat, lon: c.geo.lon, place: c.geo.placeName } : null,
    weather: c.weather ? { tempC: c.weather.now.tempC, condition: c.weather.now.condition } : null,
  };
}
