import type { Detection, EntityProfile, RelatedInfo } from '../../core/types';
import type { KnowledgeService, VisionContext } from '../contracts';
import { postJson } from '../http';
import { MOCK_ENTITIES } from '../mock/knowledgeBase';

function genericProfile(d: Detection): EntityProfile {
  return {
    id: d.entityId ?? d.id,
    name: d.displayName,
    subtitle: d.subtitle ?? d.category,
    category: d.category,
    summary: `${d.displayName}を認識しました（信頼度 ${Math.round(d.confidence * 100)}%）。「これについて調べて」で詳細を検索できます。`,
    facts: [{ key: 'label', label: 'ラベル', value: d.label }],
    keywords: [d.displayName],
  };
}

export class MockKnowledgeService implements KnowledgeService {
  readonly mode = 'mock' as const;
  async profile(d: Detection): Promise<EntityProfile | null> {
    const e = d.entityId ? MOCK_ENTITIES[d.entityId] : undefined;
    return e ? e.profile : genericProfile(d);
  }
  async related(p: EntityProfile): Promise<RelatedInfo[]> {
    return MOCK_ENTITIES[p.id]?.related ?? [];
  }
}

/** POST /knowledge/profile { detection, geo } → EntityProfile | null ; POST /knowledge/related { id } → RelatedInfo[] */
export class RemoteKnowledgeService implements KnowledgeService {
  readonly mode = 'real' as const;
  async profile(d: Detection, ctx: VisionContext): Promise<EntityProfile | null> {
    try {
      return (await postJson<EntityProfile | null>('/knowledge/profile', { detection: d, geo: ctx.geo })) ?? genericProfile(d);
    } catch {
      return genericProfile(d);
    }
  }
  async related(p: EntityProfile): Promise<RelatedInfo[]> {
    return postJson<RelatedInfo[]>('/knowledge/related', { id: p.id, name: p.name }).catch(() => []);
  }
}
