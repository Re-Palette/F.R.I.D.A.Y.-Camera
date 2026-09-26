import { DEMO_MENU_LINES, DEMO_OBJECTS, applySway, streetCarBox, sway } from '../../camera/demo/geometry';
import type { Detection, OcrResult, SceneAnalysis } from '../../core/types';
import { clamp } from '../../core/util';
import type { DemoScene, FrameSource, VisionContext, VisionService } from '../contracts';
import { MOCK_ENTITIES } from '../mock/knowledgeBase';

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
  desk: {
    summary: 'デスクの上のノートPCとスマートフォンです',
    tags: ['PC', 'ガジェット', 'デスク', '作業中'],
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

/**
 * Deterministic vision that "sees" the procedural demo feed. Objects are
 * acquired one after another with a confidence ramp, which exercises the
 * HUD's scanning → identified → panel flow exactly like a real model would.
 */
export class MockVisionService implements VisionService {
  readonly mode = 'mock' as const;
  private t0 = performance.now();

  async init() {}

  private clock(ctx: VisionContext) {
    if (ctx.demoClock) return ctx.demoClock;
    const s = (performance.now() - this.t0) / 1000;
    return { time: s, sceneTime: s };
  }

  async detect(_frame: FrameSource, ctx: VisionContext): Promise<Detection[]> {
    const scene = ctx.demoScene ?? 'odaiba';
    const { time, sceneTime } = this.clock(ctx);
    const tr = ctx.demoClock ? sway(time) : { dx: 0, dy: 0, s: 1 };
    const out: Detection[] = [];
    for (const obj of DEMO_OBJECTS[scene]) {
      if (sceneTime < obj.acquireAt) continue;
      const e = MOCK_ENTITIES[obj.key];
      const since = sceneTime - obj.acquireAt;
      const ramp = clamp(0.5 + since / 2.2, 0, 1);
      const jitter = Math.sin(time * 2.1 + obj.acquireAt) * 0.008;
      const base = obj.key === 'car' ? streetCarBox(time) : obj.bbox;
      out.push({
        id: `mock-${obj.key}`,
        label: e.label,
        displayName: e.profile.name,
        subtitle: e.profile.subtitle,
        category: e.profile.category,
        confidence: clamp(e.confidence * ramp + jitter, 0.3, 0.995),
        bbox: applySway(base, tr),
        entityId: obj.key,
      });
    }
    return out;
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
    if (scene === 'street') {
      const b = { id: 'ocr-sign', text: 'CAFÉ LUMEN', lang: 'fr', bbox: applySway({ x: 0.06, y: 0.215, w: 0.28, h: 0.09 }, tr) };
      return { blocks: [b], fullText: b.text, language: 'fr' };
    }
    return { blocks: [], fullText: '', language: 'und' };
  }

  dispose() {}
}
