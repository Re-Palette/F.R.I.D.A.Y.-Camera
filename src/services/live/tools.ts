/**
 * What F.R.I.D.A.Y. asks of Gemini Live, and how its structured answers map
 * back onto the HUD's identification model.
 *
 * Current Live models answer with *audio*; anything the HUD must render
 * (names, confidence, evidence) therefore comes through function calls,
 * which are structured regardless of the response modality.
 */
import type { IdentityCandidate, VisualFeature } from '../../core/types';
import { clamp } from '../../core/util';
import type { FunctionDeclaration } from './session';

const CANDIDATE = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: '最も具体的な名称（例: "Apple MacBook Air 13-inch"）。分からない部分は含めない' },
    brand: { type: 'STRING', description: 'メーカー / ブランド（ロゴ・文字・デザインから判断できる場合のみ）' },
    family: { type: 'STRING', description: 'シリーズ / 車種 / 品種（例: "MacBook Air", "Model 3", "ゴールデン・レトリバー"）' },
    model: { type: 'STRING', description: '型番 / サイズ / 容量など（見えている根拠がある場合のみ）' },
    variant: { type: 'STRING', description: '世代・年式・グレード（推測の場合も可。HUD は必ず「可能性」として表示する）' },
    confidence: { type: 'NUMBER', description: '0〜1。画像の根拠の強さ。迷ったら低めに' },
    evidence: { type: 'ARRAY', items: { type: 'STRING' }, description: '根拠（例: "上部ノッチ", "背面3眼カメラ", "ラベルの文字 WH-1000XM5"）' },
  },
  required: ['name', 'confidence'],
};

export const REPORT_IDENTIFICATION: FunctionDeclaration = {
  name: 'report_identification',
  description:
    '[HUD] 識別依頼への回答。対象を1つ識別し、候補を確信度の高い順に報告する。',
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: {
      target_id: { type: 'STRING', description: '依頼に書かれた対象 ID（例: "T12"）' },
      category: { type: 'STRING', description: '大分類（ノートPC / スマートフォン / 乗用車 / 犬 / 料理 / 建物 …）' },
      candidates: { type: 'ARRAY', items: CANDIDATE, description: '候補（1〜4件、確信度の高い順）' },
      visible_text: { type: 'ARRAY', items: { type: 'STRING' }, description: '対象に読める文字（ロゴ・型番・ラベル）。ナンバープレートは絶対に含めない' },
      features: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { label: { type: 'STRING', description: '例: カラー / 素材 / カメラ配置 / 形状' }, value: { type: 'STRING' } },
          required: ['label', 'value'],
        },
        description: '外観から分かった特徴（画像から見えるものだけ）',
      },
      unknown: { type: 'ARRAY', items: { type: 'STRING' }, description: '画像からは判別できない項目（例: CPU, メモリ, 年式）' },
      is_person: { type: 'BOOLEAN', description: '対象が人物なら true（その場合は名前・属性を一切返さない）' },
    },
    required: ['target_id', 'candidates'],
  },
};

export const APP_ACTION: FunctionDeclaration = {
  name: 'app_action',
  description: 'ユーザーがカメラアプリの操作を頼んだときに呼ぶ（写真撮影、録画、対象のロック、公式サイトを開く、モード切替）。',
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: {
      action: {
        type: 'STRING',
        enum: ['take_photo', 'start_recording', 'stop_recording', 'lock_target', 'unlock_target', 'open_official_site', 'mode_translate', 'mode_navigation', 'mode_scan'],
      },
      target_id: { type: 'STRING', description: '対象 ID（分かる場合）' },
    },
    required: ['action'],
  },
};

/** Conversation session: talks with the user, sees the camera, can operate the app. */
export const CONVERSATION_PROMPT = `あなたは F.R.I.D.A.Y.、カメラ越しに現実世界を見ている日本語の AI アシスタントです。
映像は 1〜2 秒ごとに届きます。

話し方:
- ユーザーに話しかけられたときだけ、短く自然な日本語で答える。自分から実況しない。
- 見えていないこと、画像から判断できないこと（CPU・メモリ・年式・価格など）は推測で断定しない。「画像からは判別できません」と言う。
- 確信が低いときは「〜の可能性があります」と言う。
- 「[HUD 補足]」はアプリが付けた注釈（ユーザーが指している対象と識別結果）。「これ」はその対象を指す。

プライバシー:
- 人物は「人物」とだけ扱う。個人の特定、名前、年齢・性別・感情の推定は絶対にしない。
- ナンバープレート、画面上の個人情報は読み上げない。

操作:
- 撮影・録画・ロック・公式サイトを開く・翻訳/ナビへの切替を頼まれたら app_action を呼び、「撮影しました」のように一言だけ返す。`;

/** Identification session: never heard by the user; answers only through report_identification. */
export const IDENTIFY_PROMPT = `あなたはカメラアプリ F.R.I.D.A.Y. の物体識別エンジンです。
入力は「対象の切り抜き画像」と「[HUD] 識別依頼」。必ず report_identification ツールで答え、音声・文章では何も言わない。

- カテゴリー → ブランド → シリーズ → 型番 → 世代 の順に、画像に根拠がある深さまで答える。
- 候補は複数比較し、確信度の高い順に 1〜4 件。迷ったら確信度を低めにする。
- ロゴ・型番・ラベルの文字が読めたら visible_text に入れる。ナンバープレートは絶対に含めない。
- 画像から判別できない仕様（CPU、メモリ、容量、年式など）は unknown に入れ、推測しない。
- 人物は is_person=true とし、名前・年齢・性別・感情など一切返さない。`;

export interface LiveIdentification {
  targetId: string;
  category?: string;
  candidates: IdentityCandidate[];
  features: VisualFeature[];
  text: string[];
  unknown: string[];
  person: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
/** Plate-like strings (「品川 300 さ 12-34」, "ABC-1234") never reach the HUD. */
const PLATE = /([一-鿿]{1,4}\s*\d{2,3}\s*[ぁ-ん]\s*\d{1,2}-?\d{2})|(^[A-Z]{1,3}[- ]?\d{3,4}$)/;

/** Validates / normalises report_identification args (model output is untrusted). */
export function parseIdentification(args: Record<string, unknown>): LiveIdentification | null {
  const targetId = str(args.target_id);
  if (!targetId) return null;
  const person = args.is_person === true;
  const candidates: IdentityCandidate[] = person
    ? []
    : (Array.isArray(args.candidates) ? args.candidates : [])
        .map((c) => c as Record<string, unknown>)
        .map((c) => ({
          name: str(c.name),
          brand: str(c.brand) || undefined,
          family: str(c.family) || undefined,
          model: str(c.model) || undefined,
          variant: str(c.variant) || undefined,
          confidence: clamp(typeof c.confidence === 'number' ? c.confidence : Number(c.confidence) || 0, 0, 0.97),
          evidence: strs(c.evidence).slice(0, 5),
        }))
        .filter((c) => c.name)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 4);
  const features: VisualFeature[] = person
    ? []
    : (Array.isArray(args.features) ? args.features : [])
        .map((f) => f as Record<string, unknown>)
        .filter((f) => str(f.label) && str(f.value))
        .slice(0, 8)
        .map((f) => ({ key: featureKey(str(f.label)), label: str(f.label), value: str(f.value), source: 'visual' as const }));
  return {
    targetId,
    category: str(args.category) || undefined,
    candidates,
    features,
    text: person ? [] : strs(args.visible_text).filter((t) => !PLATE.test(t)).slice(0, 8),
    unknown: strs(args.unknown).slice(0, 6),
    person,
  };
}

function featureKey(label: string): VisualFeature['key'] {
  if (/色|カラー/.test(label)) return 'color';
  if (/素材/.test(label)) return 'material';
  if (/ロゴ/.test(label)) return 'logo';
  if (/配置|レイアウト|ボタン|ポート|カメラ/.test(label)) return 'layout';
  if (/画面|ディスプレイ/.test(label)) return 'display';
  if (/形/.test(label)) return 'shape';
  if (/パッケージ|ラベル/.test(label)) return 'package';
  if (/ブランド|メーカー/.test(label)) return 'brand';
  return 'design';
}

/** The identification request sent as text right after the target's crop. */
export function identifyPrompt(targetId: string, categoryJa: string, bbox: { x: number; y: number; w: number; h: number }): string {
  const pct = (v: number) => Math.round(v * 100);
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const where = `${cy < 0.33 ? '上' : cy > 0.66 ? '下' : '中央'}${cx < 0.33 ? '左' : cx > 0.66 ? '右' : ''}`.replace('中央右', '右').replace('中央左', '左');
  return `[HUD] 対象 ${targetId}（検出: ${categoryJa}）を識別して report_identification で報告。位置: 画面${where}（x ${pct(bbox.x)}–${pct(bbox.x + bbox.w)}%, y ${pct(bbox.y)}–${pct(bbox.y + bbox.h)}%）。直前の画像がこの対象の切り抜き。音声では何も言わない。`;
}
