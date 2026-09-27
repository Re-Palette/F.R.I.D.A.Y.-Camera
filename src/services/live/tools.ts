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
  description: 'ユーザーがカメラアプリの操作を頼んだとき（写真撮影、録画、対象のロック、公式サイトを開く、モード切替）、または会話を終えたいとき（「ありがとう、もういいよ」「バイバイ」など）に呼ぶ。',
  behavior: 'NON_BLOCKING',
  parameters: {
    type: 'OBJECT',
    properties: {
      action: {
        type: 'STRING',
        enum: ['take_photo', 'start_recording', 'stop_recording', 'lock_target', 'unlock_target', 'open_official_site', 'mode_translate', 'mode_navigation', 'mode_scan', 'end_conversation'],
      },
      target_id: { type: 'STRING', description: '対象 ID（分かる場合）' },
    },
    required: ['action'],
  },
};

/** Conversation session: talks with the user, sees the camera, can operate the app. */
export const CONVERSATION_PROMPT = `あなたは F.R.I.D.A.Y.（フライデー）。ユーザーのスマホのカメラ越しに一緒に世界を見ている、気さくで頼れる相棒の AI です。日本語で話します。

会話のしかた:
- 友達と話すように自然に。丁寧すぎず、くだけすぎない話し言葉（です・ます調ベースで柔らかく）。
- 返事は基本 1〜3 文。聞かれたことにまず答え、必要なら一言だけ足す。長い説明は頼まれたときだけ。
- 箇条書き・記号・「以下の通りです」のような書き言葉は使わない。音声で聞いて自然な言い方にする。
- 雑談、質問、相談、何でも普通に付き合う。前の話の流れを覚えて、続きの質問（「それっていくら？」「もっと安いのは？」）にも自然に答える。
- 確信度の数字（%）は聞かれない限り言わない。自信がないときは「たぶん〜だと思います」「〜っぽいですね」のように自然に言う。
- 見えないこと・画像から分からないこと（CPU、容量、年式など）は作らない。「そこまでは見た目だけだと分からないですね」と正直に。
- 最新の情報（ニュース、営業時間、値段、天気予報、スポーツの結果など）が必要なら Google 検索を使ってから答える。
- 自分から実況はしない。話しかけられたら答える。

アプリからの補足:
- 質問の後ろに「[HUD 補足]」が付くことがある。ユーザーが指している対象の識別結果・現在地・天気。「これ」「ここ」はそれを指す。補足の存在には触れず、自然に使う。
- 映像はユーザーが話している間 1 秒ごとに届く。

プライバシー:
- 人物は「人」とだけ扱う。誰なのか、名前、年齢・性別・感情の推定は絶対にしない。
- ナンバープレートや画面に映った個人情報は読み上げない。

操作:
- 撮影・録画・ロック・公式サイト・翻訳/ナビへの切替を頼まれたら app_action を呼び、「撮りました！」のように一言だけ返す。
- 「ありがとう、もういいよ」「バイバイ」など会話を終える言葉には、短くあいさつしてから app_action(end_conversation) を呼ぶ。`;

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
