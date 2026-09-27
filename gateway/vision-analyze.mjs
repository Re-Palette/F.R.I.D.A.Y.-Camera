/**
 * POST /vision/analyze — identify ONE target from its crop with a fast vision
 * model (default gemini-3.8-flash), structured JSON out.
 *
 *   { image: dataURL (crop), label, category, ocr[], bbox, area, nearby[], scene }
 *   → { result: { category, is_person, candidates[], features[], visible_text[], unknown[] }, model, ms }
 *
 * GET → { ready, model } (lets the app switch Gemini on automatically).
 * The app re-validates everything (confidence caps, plates, people).
 */
import { guard } from './live-token.mjs';

export const DEFAULT_VISION_MODEL = 'gemini-3.8-flash';
const API = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM = `あなたはカメラアプリの物体識別エンジンです。渡された「対象の切り抜き画像」を1つだけ識別し、JSON で返します。
- カテゴリー → メーカー/ブランド → シリーズ → 型番 → 世代 の順に、画像に根拠がある深さまで答える。ロゴ・文字・形状・ボタン/カメラ/端子の配置・素材・色を根拠に使う。
- 候補は複数比較し、確信度（0〜1）の高い順に 1〜4 件。迷ったら確信度を下げる。断定できない細部は variant に「〜の可能性」として入れる。
- 製品名は公式表記（例: "Apple MacBook Air 13-inch", "Sony WH-1000XM5", "Coca-Cola 500ml"）。動物は品種、植物は種、料理は料理名、建物は施設名。
- 読める文字（ロゴ・型番・ラベル）は visible_text に。ナンバープレートや個人情報は絶対に含めない。
- 画像から判別できない仕様（CPU、メモリ、容量、年式、価格など）は unknown に入れ、推測しない。
- 人物なら is_person=true、candidates は空。名前・年齢・性別・感情は一切返さない。
- 文字列は日本語（固有名詞・製品名は公式表記のまま）。`;

const CANDIDATE = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    brand: { type: 'string' },
    family: { type: 'string' },
    model: { type: 'string' },
    variant: { type: 'string' },
    confidence: { type: 'number' },
    evidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'confidence'],
};

export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    is_person: { type: 'boolean' },
    candidates: { type: 'array', items: CANDIDATE },
    features: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] } },
    visible_text: { type: 'array', items: { type: 'string' } },
    unknown: { type: 'array', items: { type: 'string' } },
  },
  required: ['candidates'],
};

function prompt(b) {
  const lines = [`検出器の判定: ${b.category ?? ''}（${b.label ?? ''}）`];
  if (Array.isArray(b.ocr) && b.ocr.length) lines.push(`端末で読めた文字: ${b.ocr.slice(0, 8).join(' / ')}`);
  if (b.area) lines.push(`撮影場所（GPS）: ${b.area}`);
  if (Array.isArray(b.nearby) && b.nearby.length) lines.push(`近くの施設: ${b.nearby.slice(0, 6).map((n) => n.name).join('、')}`);
  if (b.scene) lines.push(`シーン: ${b.scene}`);
  lines.push('この切り抜きの対象を識別してください。');
  return lines.join('\n');
}

/** generationConfig variants, richest first: unsupported fields on a given model fall away on 400. */
const CONFIGS = [
  { responseMimeType: 'application/json', responseJsonSchema: RESULT_SCHEMA, thinkingConfig: { thinkingLevel: 'low' }, mediaResolution: 'MEDIA_RESOLUTION_HIGH' },
  { responseMimeType: 'application/json', responseJsonSchema: RESULT_SCHEMA, thinkingConfig: { thinkingLevel: 'low' } },
  { responseMimeType: 'application/json', responseJsonSchema: RESULT_SCHEMA },
  { responseMimeType: 'application/json' },
];

export function parseModelJson(text) {
  const t = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in model output');
  return JSON.parse(t.slice(start, end + 1));
}

export async function analyze(body, { apiKey, model = DEFAULT_VISION_MODEL, fetchImpl = fetch }) {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(body.image ?? '');
  if (!m) throw Object.assign(new Error('image (data URL) required'), { status: 400 });
  const contents = [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: prompt(body) }] }];
  let lastErr = '';
  for (const generationConfig of CONFIGS) {
    const res = await fetchImpl(`${API}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents, generationConfig: { ...generationConfig, maxOutputTokens: 1024 } }),
    });
    if (res.ok) {
      const j = await res.json();
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
      return parseModelJson(text);
    }
    lastErr = `${res.status}: ${(await res.text()).slice(0, 300)}`;
    // Only an unsupported-parameter 400 is worth retrying with a simpler config.
    if (res.status !== 400) throw Object.assign(new Error(`generateContent → HTTP ${lastErr}`), { status: 502 });
  }
  throw Object.assign(new Error(`generateContent → HTTP ${lastErr}`), { status: 502 });
}

export async function handleVisionAnalyze(request, env, fetchImpl = fetch) {
  const { json, reject } = guard(request, env, ['GET', 'POST']);
  const model = env.GEMINI_VISION_MODEL || DEFAULT_VISION_MODEL;
  if (request.method === 'GET') return reject && reject.status !== 503 ? reject : json(200, { ready: !!env.GEMINI_API_KEY, model });
  if (reject) return reject;
  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid JSON' });
  }
  const t0 = Date.now();
  try {
    const result = await analyze(body, { apiKey: env.GEMINI_API_KEY, model, fetchImpl });
    return json(200, { result, model, ms: Date.now() - t0 });
  } catch (e) {
    return json(e.status ?? 502, { error: String(e.message ?? e) });
  }
}
