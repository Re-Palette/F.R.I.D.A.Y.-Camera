import { describe, expect, it } from 'vitest';
import type { EntityProfile, Identification } from '../core/types';
import { identityPhrase, noteSentence, specAnswer } from '../services/llm';

function profile(id: Partial<Identification>, extra: Partial<EntityProfile> = {}): EntityProfile {
  return {
    id: 'x',
    name: id.name ?? 'Apple MacBook Air 13-inch',
    subtitle: 'ノートPC',
    category: 'product',
    summary: 'Apple の薄型ノートPC。',
    facts: [],
    keywords: [],
    identity: { status: 'identified', kind: 'product', name: 'Apple MacBook Air 13-inch', confidence: 0.92, source: 'mock', at: 0, attributes: { ブランド: 'Apple' }, ...id },
    ...extra,
  } as EntityProfile;
}

describe('graded spoken answers', () => {
  it('turns the grading note into a sentence', () => {
    expect(noteSentence('モデル：16 Proの可能性')).toBe('モデルは16 Proの可能性があります。');
    expect(noteSentence('正確なモデルは判別できません')).toBe('正確なモデルは判別できません。');
    expect(noteSentence(undefined)).toBe('');
  });

  it('says possible with % and keeps web evidence separate', () => {
    const p = profile({ status: 'possible', name: 'Apple iPhone Pro', confidence: 0.73, note: 'モデル：16 Proの可能性', verification: { status: 'partial', matched: [], sources: [], facts: [], at: 0 } }, { name: 'Apple iPhone Pro' });
    const s = identityPhrase(p);
    expect(s).toContain('可能性があります（確信度73%）');
    expect(s).toContain('モデルは16 Proの可能性があります');
    expect(s).toContain('一部のみ一致');
  });

  it('never asserts a spec the image cannot show', () => {
    const p = profile({ unknown: ['CPU / SoC', 'メモリ', 'ストレージ'] });
    expect(specAnswer(p, 'CPUは？')).toContain('CPU / SoCは画像からは判別できません');
    expect(specAnswer(p, 'スペックは？')).toBe('CPU / SoC・メモリ・ストレージは画像からは判別できません。');
  });

  it('answers from label text when it was read', () => {
    const p = profile({ name: 'Coca-Cola Original Taste 500ml' }, { facts: [{ key: 'size', label: '容量表記', value: '500ml（ラベル）' }] });
    expect(specAnswer(p, '容量は？')).toBe('容量表記は500ml（ラベル）です。');
  });

  it('never names people', () => {
    expect(identityPhrase(profile({ kind: 'person' }, { category: 'person' }))).toContain('個人の特定は行いません');
  });
});
