import type { SearchSource, SourceTier } from '../../core/types';

export const TIER_WEIGHT: Record<SourceTier, number> = {
  official: 1,
  government: 0.95,
  news: 0.82,
  corporate: 0.76,
  reference: 0.66,
  community: 0.4,
};

export const TIER_LABEL: Record<SourceTier, string> = {
  official: '公式',
  government: '公的機関',
  news: 'ニュース',
  corporate: '企業公式',
  reference: '参考資料',
  community: 'コミュニティ',
};

/**
 * Trust score = tier weight × recency decay × model-reported trust.
 * Sources are ordered so official / public-sector information is surfaced
 * first, as required by the AI search UX.
 */
export function rankSources(sources: SearchSource[], now = Date.now()): SearchSource[] {
  return sources
    .map((s) => {
      const ageDays = s.publishedAt ? Math.max(0, (now - new Date(s.publishedAt).getTime()) / 864e5) : 30;
      const recency = 0.75 + 0.25 * Math.exp(-ageDays / 90);
      const trust = Math.min(1, TIER_WEIGHT[s.tier] * recency * (0.6 + 0.4 * (s.trust || 0.8)));
      return { ...s, trust };
    })
    .sort((a, b) => b.trust - a.trust);
}
