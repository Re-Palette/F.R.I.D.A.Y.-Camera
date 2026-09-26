import type { SearchAnswer, SearchSource, SearchStage } from '../../core/types';
import { sleep, uid } from '../../core/util';
import type { SearchService, WorldContext } from '../contracts';
import { postStream } from '../http';
import { MOCK_ENTITIES } from '../mock/knowledgeBase';
import { rankSources } from './ranking';

const daysAgo = (d: number) => new Date(Date.now() - d * 864e5).toISOString();

function src(p: Omit<SearchSource, 'id' | 'trust'> & { trust?: number }): SearchSource {
  return { id: uid('src'), trust: p.trust ?? 0.85, ...p };
}

type Topic = 'night' | 'history' | 'access' | 'hours' | 'price' | 'review' | 'general';

function topicOf(q: string): Topic {
  if (/夜|ライトアップ|夜景|night/i.test(q)) return 'night';
  if (/歴史|いつ|できた|開通|完成|history/i.test(q)) return 'history';
  if (/行き方|アクセス|駅|どうやって|access/i.test(q)) return 'access';
  if (/営業|何時|開いて|hours/i.test(q)) return 'hours';
  if (/値段|価格|いくら|最安|比較|price/i.test(q)) return 'price';
  if (/評判|レビュー|口コミ|評価|review/i.test(q)) return 'review';
  return 'general';
}

/** Topic-aware demo answers for the demo entities; generic otherwise. */
function mockAnswer(query: string, ctx: WorldContext): Omit<SearchAnswer, 'generatedAt'> {
  const focus = ctx.focus;
  if (ctx.focusImage || focus?.identity?.status === 'unknown') {
    return {
      query,
      summary: '画像検索の結果、似た形状の物体として「屋外用の小型機器（センサーボックス等）」が候補に挙がりました。確度は低く、断定はできません。（モックデータ: 実際の画像検索 API を接続すると置き換わります）',
      keyPoints: ['候補: 屋外センサーボックス（低確度）', '候補: 配電用の小型筐体（低確度）', '近づいて撮影すると精度が上がります'],
      sources: [
        src({ title: '類似画像の検索結果', url: 'https://example.com/image-search', publisher: 'Image Search', tier: 'reference', snippet: '形状が類似する画像 8件', publishedAt: daysAgo(1), trust: 0.6 }),
        src({ title: '屋外設備の種類', url: 'https://example.com/equipment', publisher: 'Open Encyclopedia', tier: 'reference', snippet: '屋外設備の一般的な外観', publishedAt: daysAgo(90) }),
      ],
      followUps: ['もっと近くで撮って調べて'],
    };
  }
  if (focus && !focus.product && /値段|価格|いくら|最安/.test(query)) {
    return {
      query,
      summary: `${focus.name}の価格を検索しました。販売店により価格が異なるため、公式ストアと主要ストアの価格を比較してください。（モックデータ: 実際の検索 API を接続すると最新価格に置き換わります）`,
      keyPoints: ['公式ストアの価格を優先', '主要ストア 3件を比較', '価格は日々変動します'],
      sources: [
        src({ title: `${focus.name} 公式ストア`, url: focus.officialUrl ?? 'https://example.com/official', publisher: '公式', tier: 'official', snippet: '公式販売価格', publishedAt: daysAgo(3) }),
        src({ title: '価格比較', url: 'https://example.com/compare', publisher: 'Price Compare', tier: 'reference', snippet: '主要ストアの価格', publishedAt: daysAgo(1) }),
      ],
      followUps: ['公式サイトを開いて', 'レビューは？'],
    };
  }
  const topic = topicOf(query);
  const name = focus?.name ?? query;
  const e = focus ? MOCK_ENTITIES[focus.id] : undefined;
  const slug = focus?.id ?? 'topic';

  if (focus?.product && (topic === 'price' || topic === 'review' || topic === 'general')) {
    const p = focus.product;
    const best = [...p.offers].sort((a, b) => a.priceJPY - b.priceJPY)[0];
    return {
      query,
      summary: `${p.name}（${p.maker}）の希望小売価格は¥${p.priceJPY.toLocaleString()}。現在の最安は${best.store}の¥${best.priceJPY.toLocaleString()}です。レビュー平均は★${p.rating}（${p.reviewCount.toLocaleString()}件）。${p.reviewSummary}`,
      keyPoints: [
        `最安: ${best.store} ¥${best.priceJPY.toLocaleString()}`,
        `評価: ★${p.rating} / ${p.reviewCount.toLocaleString()}件`,
        ...p.specs.slice(0, 2).map((s) => `${s.label}: ${s.value}`),
      ],
      sources: [
        src({ title: `${p.name} 製品情報`, url: p.officialUrl, publisher: `${p.maker} 公式`, tier: 'official', snippet: '仕様・価格・保証の一次情報', publishedAt: daysAgo(20) }),
        src({ title: `${p.name} レビュー`, url: 'https://example.com/review', publisher: 'Gadget Review Weekly', tier: 'news', snippet: '実機レビュー（画面・バッテリー）', publishedAt: daysAgo(12) }),
        src({ title: '価格比較', url: 'https://example.com/compare', publisher: 'Price Compare', tier: 'reference', snippet: '主要ストア 3件の価格', publishedAt: daysAgo(1) }),
        src({ title: 'ユーザーの声', url: 'https://example.com/forum', publisher: 'User Forum', tier: 'community', snippet: '重量についての指摘', publishedAt: daysAgo(4), trust: 0.6 }),
      ],
      followUps: ['類似製品と比較して', 'スペックを詳しく', '公式サイトを開いて'],
    };
  }

  if (slug === 'rainbow-bridge' || slug === 'tokyo-tower' || slug === 'big-sight') {
    const official = src({ title: `${name} 公式情報`, url: focus?.officialUrl ?? `https://example.com/${slug}`, publisher: `${name} 公式`, tier: 'official', snippet: '営業時間・ライトアップ・アクセス', publishedAt: daysAgo(6) });
    const gov = src({ title: '港区 観光ガイド', url: 'https://example.com/minato-guide', publisher: 'Minato City Guide', tier: 'government', snippet: '周辺観光・イベント情報', publishedAt: daysAgo(15) });
    const news = src({ title: e?.news[0]?.title ?? `${name} 関連ニュース`, url: e?.news[0]?.url ?? 'https://example.com/news', publisher: e?.news[0]?.source ?? 'Metro News', tier: 'news', snippet: '最新の関連報道', publishedAt: daysAgo(1) });
    const ref = src({ title: `${name} - 百科事典`, url: 'https://example.com/encyclopedia', publisher: 'Open Encyclopedia', tier: 'reference', snippet: '構造・歴史の概要', publishedAt: daysAgo(200) });
    const blog = src({ title: 'お台場 夜景スポットまとめ', url: 'https://example.com/blog', publisher: 'Travel Blog', tier: 'community', snippet: '撮影スポットの体験談', publishedAt: daysAgo(40), trust: 0.55 });
    const bank: Record<Topic, Pick<SearchAnswer, 'summary' | 'keyPoints' | 'followUps'>> = {
      night: {
        summary: `夜の${name}はライトアップが日没から24時まで。お台場海浜公園の砂浜からの眺めが定番で、19:00/20:30発の夜景クルーズも人気です。週末は20時前後が混雑のピークです。`,
        keyPoints: ['ライトアップ: 日没〜24:00', 'ベスト: お台場海浜公園', 'クルーズ 19:00 / 20:30', '混雑ピーク: 週末20時前後'],
        followUps: ['周辺のおすすめカフェは？', 'クルーズの予約方法', 'そこまでナビして'],
      },
      history: {
        summary: focus?.facts.find((f) => f.key === 'opened')
          ? `${name}は${focus.facts.find((f) => f.key === 'opened')!.value}に${slug === 'tokyo-tower' ? '完成' : slug === 'big-sight' ? '開業' : '開通'}しました。${focus.summary}`
          : focus?.summary ?? '',
        keyPoints: focus?.facts.map((f) => `${f.label}: ${f.value}`) ?? [],
        followUps: ['夜に行くなら？', '名前の由来は？'],
      },
      access: {
        summary: slug === 'big-sight' ? `${name}の最寄りは、りんかい線「国際展示場駅」とゆりかもめ「東京ビッグサイト駅」です。` : `${name}の最寄りはゆりかもめ「お台場海浜公園駅」。徒歩約15分で遊歩道の入口（芝浦側）へ行けます。`,
        keyPoints: ['最寄り: お台場海浜公園駅', '徒歩: 約15分', '遊歩道は芝浦側・台場側の2か所'],
        followUps: ['駅までナビして'],
      },
      hours: {
        summary: `${name}の遊歩道は9:00–21:00（夏季）/10:00–18:00（冬季）。ライトアップは日没〜24:00です。`,
        keyPoints: ['遊歩道 夏季 9:00–21:00', '遊歩道 冬季 10:00–18:00', 'ライトアップ 日没–24:00'],
        followUps: ['今の混雑状況は？'],
      },
      price: { summary: `${name}の遊歩道は無料で利用できます。`, keyPoints: ['入場無料'], followUps: [] },
      review: { summary: `${name}は★4.5（1.8万件）。夕景と夜景の評価が特に高いスポットです。`, keyPoints: ['★4.5 / 18,240件'], followUps: [] },
      general: {
        summary: focus?.summary ?? `${name}についての要約です。`,
        keyPoints: focus?.facts.map((f) => `${f.label}: ${f.value}`) ?? [],
        followUps: ['いつできた？', '夜に行くなら？', '行き方は？'],
      },
    };
    const t = slug === 'big-sight' && (topic === 'night' || topic === 'hours' || topic === 'price') ? 'general' : topic;
    return { query, ...bank[t], sources: [official, gov, news, ref, blog] };
  }

  return {
    query,
    summary: focus
      ? `${focus.name}について、公式・公的機関・報道の情報を優先して要約しました。${focus.summary}`
      : `「${query}」について、信頼性の高い情報源を優先して要約しました。（モックデータ: 実際の検索APIを接続すると最新情報に置き換わります）`,
    keyPoints: focus?.facts.slice(0, 4).map((f) => `${f.label}: ${f.value}`) ?? ['公式情報を優先', '複数ソースで照合済み'],
    sources: [
      src({ title: `${name} — 公式`, url: 'https://example.com/official', publisher: 'Official Site', tier: 'official', snippet: '一次情報', publishedAt: daysAgo(10) }),
      src({ title: `${name} — 解説`, url: 'https://example.com/ref', publisher: 'Open Encyclopedia', tier: 'reference', snippet: '概要', publishedAt: daysAgo(120) }),
      src({ title: `${name} — 最新ニュース`, url: 'https://example.com/news', publisher: 'Metro News', tier: 'news', snippet: '関連報道', publishedAt: daysAgo(2) }),
    ],
    followUps: ['もっと詳しく', '最新ニュースは？'],
  };
}

export class MockSearchService implements SearchService {
  readonly mode = 'mock' as const;
  async search(query: string, ctx: WorldContext, onStage: (s: SearchStage, d?: string) => void, signal?: AbortSignal) {
    const q = ctx.focus && !query.includes(ctx.focus.name) ? `${ctx.focus.name} ${query}` : query;
    onStage('query', q);
    await sleep(380, signal);
    onStage('retrieve', '14 sources');
    await sleep(620, signal);
    onStage('rank', 'official › government › news');
    await sleep(420, signal);
    onStage('crosscheck', '5 sources agree');
    await sleep(460, signal);
    onStage('summarize');
    await sleep(380, signal);
    const a = mockAnswer(query, ctx);
    onStage('done');
    return { ...a, sources: rankSources(a.sources), generatedAt: new Date().toISOString() };
  }
}

/**
 * POST /search (NDJSON stream)
 *   ← {"type":"stage","stage":"retrieve","detail":"14 sources"}
 *   ← {"type":"answer","answer":SearchAnswer}
 * The gateway performs web search, fetches pages, and asks the LLM to
 * cross-check and summarise. Sources are re-ranked client-side by trust tier.
 */
export class RemoteSearchService implements SearchService {
  readonly mode = 'real' as const;
  async search(query: string, ctx: WorldContext, onStage: (s: SearchStage, d?: string) => void, signal?: AbortSignal) {
    let answer: SearchAnswer | null = null;
    await postStream(
      '/search',
      {
        query,
        focus: ctx.focus ? { id: ctx.focus.id, name: ctx.focus.name, keywords: ctx.focus.keywords, identity: ctx.focus.identity } : null,
        // Image search for things the vision tier couldn't identify.
        image: ctx.focusImage,
        location: ctx.location?.name,
        scene: ctx.scene?.summary,
        geo: ctx.geo,
        locale: 'ja-JP',
      },
      (e) => {
        if (e.type === 'stage') onStage(e.stage as SearchStage, e.detail as string | undefined);
        if (e.type === 'answer') answer = e.answer as SearchAnswer;
      },
      signal,
    );
    if (!answer) throw new Error('search: no answer');
    const a = answer as SearchAnswer;
    onStage('done');
    return { ...a, sources: rankSources(a.sources) };
  }
}
