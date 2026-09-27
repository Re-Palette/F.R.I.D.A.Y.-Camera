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

/** Validates / normalises the vision model's identification JSON (model output is untrusted). */
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
