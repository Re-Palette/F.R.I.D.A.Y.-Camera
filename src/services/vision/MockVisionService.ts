import { DEMO_CITY_TEXT, DEMO_MENU_LINES, DEMO_OBJECTS, applySway, cityCarBox, cityWalkerBox, streetCarBox, sway } from '../../camera/demo/geometry';
import type { BBox, Detection, Identification, OcrResult, SceneAnalysis } from '../../core/types';
import { clamp } from '../../core/util';
import type { DemoScene, FrameSource, IdentifyRequest, VisionCapabilities, VisionContext, VisionFrame, VisionProvider } from '../contracts';
import { MOCK_ENTITIES, MOCK_IDENTITY } from '../mock/knowledgeBase';
import { IdentificationPipeline } from './identify/pipeline';
import { mockIdentification, mockOCR, mockUnderstanding, mockVerification } from './identify/providers';

const SCENES: Record<DemoScene, Omit<SceneAnalysis, 'confidence'>> = {
  odaiba: {
    summary: '東京・お台場付近の夕暮れです',
    tags: ['東京', 'レインボーブリッジ', '夕焼け', '東京湾'],
    location: '東京都港区 台場',
    timeOfDay: 'dusk',
    weather: '晴れ',
    crowd: 'moderate',
    environment: '屋外 / 水辺 / 都市景観',
  },
  city: {
    summary: '東京・有明の都市部。夕方の道路に車両と歩行者がいます',
    tags: ['東京', '有明', '都市部', '展示場'],
    location: '東京都江東区 有明',
    timeOfDay: 'dusk',
    weather: '晴れ',
    crowd: 'moderate',
    environment: 'URBAN AREA / 道路 / 商業施設',
  },
  desk: {
    summary: 'デスクの上のノートPC・スマートフォン・ヘッドホン・飲料ボトルです',
    tags: ['PC', 'ガジェット', 'デスク', '作業中', '飲料'],
    timeOfDay: 'night',
    environment: '屋内 / オフィス',
    crowd: 'low',
  },
  menu: {
    summary: 'フランス語のカフェメニューを読み取れます',
    tags: ['メニュー', 'フランス語', '翻訳', 'カフェ'],
    timeOfDay: 'day',
    environment: '屋内 / 飲食店',
    crowd: 'low',
  },
  street: {
    summary: '夜の市街地。前方から車両が接近しています',
    tags: ['市街地', '夜', '交通', '工事区域'],
    location: '東京都港区 台場1丁目',
    timeOfDay: 'night',
    weather: '晴れ',
    crowd: 'moderate',
    environment: '屋外 / 道路',
  },
};

function movingBox(key: string, t: number): BBox | null {
  if (key === 'car') return streetCarBox(t);
  if (key === 'car-tesla') return cityCarBox(t);
  if (key === 'person-3') return cityWalkerBox(t);
  return null;
}

/**
 * MockVisionProvider — deterministic vision that "sees" the procedural demo
 * feed. Tier 1 (fast detection) returns generic classes with a confidence
 * ramp; tier 2 (`identify`) answers after a realistic delay with the
 * scripted specific identity — including POSSIBLE and UNKNOWN cases — so the
 * whole detect → identify → search flow can be exercised with no API.
 */
export class MockVisionService implements VisionProvider {
  readonly mode = 'mock' as const;
  readonly needsPixels = false;
  readonly inputSize = 0;
  readonly capabilities: VisionCapabilities = { detect: 'mock', identify: 'mock', scene: 'mock', text: 'mock', identifyNeedsCrop: false, maxInflightIdentify: 2 };
  lastInferMs = 0;
  private t0 = performance.now();

  async init() {}

  private clock(ctx: VisionContext) {
    if (ctx.demoClock) return ctx.demoClock;
    const s = (performance.now() - this.t0) / 1000;
    return { time: s, sceneTime: s };
  }

  async detect(frame: VisionFrame, ctx: VisionContext): Promise<Detection[]> {
    const scene = ctx.demoScene ?? 'odaiba';
    const { time, sceneTime } = this.clock(ctx);
    const tr = ctx.demoClock ? sway(time) : { dx: 0, dy: 0, s: 1 };
    const out: Detection[] = [];
    for (const obj of DEMO_OBJECTS[scene]) {
      if (sceneTime < obj.acquireAt) continue;
      const e = MOCK_ENTITIES[obj.key];
      const spec = MOCK_IDENTITY[obj.key];
      const since = sceneTime - obj.acquireAt;
      const ramp = clamp(0.5 + since / 2.2, 0, 1);
      const jitter = Math.sin(time * 2.1 + obj.acquireAt) * 0.008;
      const base = movingBox(obj.key, time) ?? obj.bbox;
      const b = applySway(base, tr);
      if (b.x + b.w < 0 || b.x > 1) continue; // left the frame
      out.push({
        id: `mock-${obj.key}`,
        label: e.label,
        displayName: spec?.generic ?? e.profile.name,
        subtitle: e.profile.subtitle.split('/')[0].trim(),
        category: e.profile.category,
        confidence: clamp(e.confidence * ramp + jitter, 0.3, 0.995),
        bbox: b,
        entityId: obj.key,
        timestamp: frame.capturedAt,
        source: 'mock',
      });
    }
    return out;
  }

  /** OCR → features → candidates → (web check) with scripted, realistic latency. */
  private readonly pipe = new IdentificationPipeline({ ocr: mockOCR, understanding: mockUnderstanding, identification: mockIdentification, verification: mockVerification });
  readonly pipeline = this.pipe.where;

  identify(req: IdentifyRequest): Promise<Identification> {
    return this.pipe.run(req);
  }

  verifyIdentity(req: IdentifyRequest, current: Identification): Promise<Identification> {
    return this.pipe.verifyIdentity(req, current);
  }

  async analyzeScene(_frame: FrameSource, detections: Detection[], ctx: VisionContext): Promise<SceneAnalysis> {
    const scene = SCENES[ctx.demoScene ?? 'odaiba'];
    return { ...scene, confidence: detections.length ? 0.93 : 0.71 };
  }

  async ocr(_frame: FrameSource, ctx: VisionContext): Promise<OcrResult> {
    const scene = ctx.demoScene ?? 'odaiba';
    const tr = ctx.demoClock ? sway(ctx.demoClock.time) : { dx: 0, dy: 0, s: 1 };
    if (scene === 'menu') {
      const blocks = DEMO_MENU_LINES.map((l, i) => ({
        id: `ocr-${i}`,
        text: l.text,
        lang: 'fr',
        bbox: applySway({ x: 0.16, y: l.y - 0.022, w: 0.68, h: 0.044 }, tr),
      }));
      return { blocks, fullText: blocks.map((b) => b.text).join('\n'), language: 'fr' };
    }
    if (scene === 'city') {
      const blocks = DEMO_CITY_TEXT.map((b) => ({ ...b, bbox: applySway(b.bbox, tr) }));
      return { blocks, fullText: blocks.map((b) => b.text).join('\n'), language: 'ja' };
    }
    if (scene === 'street') {
      const b = { id: 'ocr-sign', text: 'CAFÉ LUMEN', lang: 'fr', bbox: applySway({ x: 0.06, y: 0.215, w: 0.28, h: 0.09 }, tr) };
      return { blocks: [b], fullText: b.text, language: 'fr' };
    }
    return { blocks: [], fullText: '', language: 'und' };
  }

  dispose() {}
}

export { MockVisionService as MockVisionProvider };
