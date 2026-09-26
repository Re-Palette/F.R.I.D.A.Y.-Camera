import { describe, expect, it } from 'vitest';
import type { Detection } from '../core/types';
import type { IdentifyRequest } from '../services/contracts';
import { refine } from '../services/vision/finelabels';
import { IdentificationPipeline } from '../services/vision/identify/pipeline';
import { LocalIdentification, fineConfidence } from '../services/vision/identify/providers';
import { headline, shownName } from '../services/vision/perception';

const det = (label: string, displayName: string, category: Detection['category'], confidence = 0.9): Detection =>
  ({ id: 't1', label, displayName, subtitle: '', category, confidence, bbox: { x: 0.3, y: 0.3, w: 0.4, h: 0.3 }, timestamp: 0, source: 'local' }) as Detection;

const req = (d: Detection): IdentifyRequest => ({ detection: d, crop: null, ctx: { now: new Date() } } as unknown as IdentifyRequest);

const none = { where: 'local' as const, readCrop: async () => [] };
const noFeatures = { where: 'local' as const, analyze: async () => [] };
const noVerify = { where: 'none' as const, verify: async () => ({ status: 'skipped' as const, matched: [], sources: [], facts: [], at: 0 }) };

describe('category-level fallback (never "unknown" for a known class)', () => {
  it('a laptop with no model evidence stays a laptop, with the detector confidence', async () => {
    const p = new IdentificationPipeline({ ocr: none, understanding: noFeatures, identification: { where: 'local', candidates: async () => [] }, verification: noVerify });
    const d = det('laptop', 'ノートPC', 'computer', 0.97);
    const id = await p.run(req(d));
    expect(id.status).toBe('detected');
    expect(id.name).toBe('ノートPC');
    expect(id.confidence).toBeCloseTo(0.97);
    expect(id.note).toBe('メーカー・モデルは判別できません');
    const shown = { ...d, identity: id };
    expect(shownName(shown)).toBe('ノートPC');
    expect(headline(shown)).toBe('PRODUCT DETECTED');
  });

  it('says so when the identification service is unreachable', async () => {
    const p = new IdentificationPipeline({
      ocr: none,
      understanding: { where: 'cloud', analyze: async () => Promise.reject(new Error('HTTP 502')) },
      identification: { where: 'cloud', candidates: async () => Promise.reject(new Error('HTTP 502')) },
      verification: noVerify,
    });
    const id = await p.run(req(det('car', '乗用車', 'vehicle')));
    expect(id.status).toBe('detected');
    expect(id.note).toContain('接続できません');
  });

  it('a truly unknown thing is still unknown', async () => {
    const p = new IdentificationPipeline({ ocr: none, understanding: noFeatures, identification: { where: 'local', candidates: async () => [] }, verification: noVerify });
    const id = await p.run(req(det('thing', 'thing', 'other')));
    expect(id.status).toBe('unknown');
  });
});

describe('on-device fine classification', () => {
  it('keeps only refinements consistent with the detector class', () => {
    const cls = [
      { label: 'golden retriever', score: 0.7 },
      { label: 'tennis ball', score: 0.2 },
      { label: 'Labrador retriever', score: 0.05 },
    ];
    expect(refine('dog', cls).map((f) => f.ja)).toEqual(['ゴールデン・レトリバー', 'ラブラドール・レトリバー']);
    expect(refine('cat', cls)).toEqual([]);
  });

  it('names a breed with confidence when the classifier is sure, offers it as a possibility when not', async () => {
    const make = (score: number) =>
      new IdentificationPipeline({
        ocr: none,
        understanding: noFeatures,
        identification: new LocalIdentification(async () => [{ label: 'golden retriever', score }]),
        verification: noVerify,
      });
    const crop = { close() {} } as unknown as ImageBitmap;
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => crop;
    const r = (d: Detection) => ({ ...req(d), crop });
    const sure = await make(0.8).run(r(det('dog', '犬', 'animal', 0.95)));
    expect(sure.status).toBe('identified');
    expect(sure.name).toBe('ゴールデン・レトリバー');
    const unsure = await make(0.25).run(r(det('dog', '犬', 'animal', 0.95)));
    expect(unsure.status).toBe('possible');
    expect(unsure.name).toBe('犬');
    expect(unsure.note).toBe('品種：ゴールデン・レトリバーの可能性');
  });

  it('a car body type is a type, not a model', async () => {
    const p = new IdentificationPipeline({
      ocr: none,
      understanding: noFeatures,
      identification: new LocalIdentification(async () => [{ label: 'sports car', score: 0.85 }]),
      verification: noVerify,
    });
    const crop = { close() {} } as unknown as ImageBitmap;
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => crop;
    const id = await p.run({ ...req(det('car', '乗用車', 'vehicle', 0.9)), crop });
    expect(id.name).toBe('スポーツカー');
    expect(id.note).toBe('メーカー・モデルは判別できません');
  });

  it('compresses 1000-way softmax scores', () => {
    expect(fineConfidence(0.81, 1)).toBeCloseTo(0.9);
    expect(fineConfidence(0.04, 1)).toBeCloseTo(0.2);
  });
});
