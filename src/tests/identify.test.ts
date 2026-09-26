import { describe, expect, it } from 'vitest';
import { applyVerification, candidatesFromText, colorName, gradeIdentity, mergeCandidates, needsVerification, unknownFields } from '../services/vision/perception';

const mb = { name: 'Apple MacBook Air 13-inch', brand: 'Apple', family: 'MacBook Air', model: '13-inch', variant: 'M2 / M3系' };

describe('gradeIdentity (LEVEL 3 naming)', () => {
  it('names the full model only when confident', () => {
    const g = gradeIdentity([{ ...mb, confidence: 0.96 }], 'product', 'ノートPC');
    expect(g.status).toBe('identified');
    expect(g.name).toBe('Apple MacBook Air 13-inch');
  });

  it('backs off to brand + family with the model as a possibility', () => {
    const g = gradeIdentity([{ ...mb, confidence: 0.72 }], 'product', 'ノートPC');
    expect(g.status).toBe('possible');
    expect(g.name).toBe('Apple MacBook Air');
    expect(g.note).toBe('モデル：13-inch / M2 / M3系の可能性');
  });

  it('says "…系" and refuses a model when weak', () => {
    const g = gradeIdentity([{ ...mb, confidence: 0.41 }], 'product', 'ノートPC');
    expect(g.name).toBe('MacBook Air系ノートPC');
    expect(g.note).toBe('正確なモデルは判別できません');
  });

  it('is unknown below 40%', () => {
    expect(gradeIdentity([{ ...mb, confidence: 0.3 }], 'product', 'ノートPC').status).toBe('unknown');
    expect(gradeIdentity([], 'product', 'ノートPC').note).toBe('詳細モデルを特定できません');
  });

  it('never picks a model when two candidates are close', () => {
    const g = gradeIdentity(
      [
        { name: 'Apple MacBook Air', brand: 'Apple', family: 'MacBook Air', confidence: 0.92 },
        { name: 'Apple MacBook Pro', brand: 'Apple', family: 'MacBook Pro', confidence: 0.88 },
      ],
      'product',
      'ノートPC',
    );
    expect(g.status).toBe('possible');
    expect(g.confidence).toBeLessThanOrEqual(0.75);
  });

  it('uses kind-appropriate wording', () => {
    const g = gradeIdentity([{ name: 'Monstera deliciosa', brand: 'サトイモ科', family: 'モンステラ属', model: 'deliciosa', confidence: 0.65 }], 'plant', '観葉植物');
    expect(g.note).toContain('種：');
  });
});

describe('verification policy', () => {
  it('searches only when it can change the answer', () => {
    expect(needsVerification([{ name: 'A', confidence: 0.95 }], 'product')).toBe(false);
    expect(needsVerification([{ name: 'A', confidence: 0.72 }], 'product')).toBe(true);
    expect(needsVerification([{ name: 'A', confidence: 0.95 }, { name: 'B', confidence: 0.85 }], 'product')).toBe(true);
    expect(needsVerification([{ name: 'A', confidence: 0.72 }], 'animal')).toBe(false);
    expect(needsVerification([{ name: 'A', confidence: 0.2 }], 'product')).toBe(false);
  });

  it('adjusts confidence by web evidence, capped', () => {
    const v = (status: 'verified' | 'contradicted') => ({ status, matched: [], sources: [], facts: [], at: 0 });
    expect(applyVerification(0.95, v('verified'))).toBe(0.98);
    expect(applyVerification(0.8, v('contradicted'))).toBeCloseTo(0.55);
  });

  it('lists what the image cannot tell', () => {
    expect(unknownFields('product', 'laptop')).toEqual(['CPU / SoC', 'メモリ', 'ストレージ']);
  });
});

describe('OCR + evidence fusion', () => {
  it('extracts brands and models from text', () => {
    expect(candidatesFromText(['SONY', 'WH-1000XM5'])[0].name).toBe('Sony WH-1000XM5');
    expect(candidatesFromText(['EOS R6'])[0].name).toBe('Canon EOS R6');
    expect(candidatesFromText(['GeForce RTX 5070'])[0].name).toBe('NVIDIA GeForce RTX 5070');
    expect(candidatesFromText(['Coca-Cola', 'Original Taste', '500ml'])[0].name).toBe('Coca-Cola 500ml');
  });

  it('reinforces agreeing evidence', () => {
    const merged = mergeCandidates(
      [{ name: 'Sony WH-1000XM5', brand: 'Sony', confidence: 0.7, evidence: ['外観'] }],
      [{ name: 'Sony WH-1000XM5', brand: 'Sony', model: 'WH-1000XM5', confidence: 0.72, evidence: ['OCR: WH-1000XM5'] }],
      [{ name: 'Bose QC45', confidence: 0.2 }],
    );
    expect(merged[0].name).toBe('Sony WH-1000XM5');
    expect(merged[0].confidence).toBeGreaterThan(0.8);
    expect(merged[0].evidence).toEqual(['外観', 'OCR: WH-1000XM5']);
  });

  it('names colours', () => {
    expect(colorName(30, 36, 58)).toBe('ミッドナイト（濃紺）');
    expect(colorName(200, 200, 205)).toBe('シルバー');
    expect(colorName(210, 20, 30)).toBe('レッド');
  });
});
