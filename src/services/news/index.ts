import type { GeoFix, NewsItem } from '../../core/types';
import type { NewsService } from '../contracts';
import { postJson } from '../http';
import { MOCK_ENTITIES } from '../mock/knowledgeBase';

const GENERAL = [
  { title: '湾岸エリアで週末に花火イベント、交通規制も', source: 'Metro News', tier: 'news' as const, url: 'https://example.com/news/fireworks', topic: 'イベント', minutesAgo: 95 },
  { title: '都心の気温、平年より高めの推移続く', source: 'Weather Desk', tier: 'news' as const, url: 'https://example.com/news/weather', topic: '天気', minutesAgo: 140 },
];

export class MockNewsService implements NewsService {
  readonly mode = 'mock' as const;
  async forContext(topic: { keywords: string[]; geo?: GeoFix | null }): Promise<NewsItem[]> {
    const pool = Object.values(MOCK_ENTITIES)
      .filter((e) => e.profile.keywords.some((k) => topic.keywords.includes(k)))
      .flatMap((e) => e.news);
    const list = pool.length ? pool : GENERAL;
    const now = Date.now();
    return list.map((n, i) => ({
      id: `news-${i}-${n.url}`,
      title: n.title,
      source: n.source,
      tier: n.tier,
      url: n.url,
      topic: n.topic,
      publishedAt: new Date(now - n.minutesAgo * 60000).toISOString(),
    }));
  }
}

/** POST /news { keywords, geo } → NewsItem[] */
export class RemoteNewsService implements NewsService {
  readonly mode = 'real' as const;
  forContext(topic: { keywords: string[]; geo?: GeoFix | null }) {
    return postJson<NewsItem[]>('/news', topic).catch(() => []);
  }
}
