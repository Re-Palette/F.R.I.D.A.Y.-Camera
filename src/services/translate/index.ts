import type { Translation } from '../../core/types';
import { sleep } from '../../core/util';
import type { TranslateService } from '../contracts';
import { postJson } from '../http';

const DICT: Record<string, string> = {
  'CAFÉ DU PONT': 'カフェ・デュ・ポン（橋のカフェ）',
  'Croissant au beurre — 3,50 €': 'バタークロワッサン — 3.50ユーロ',
  'Soupe à l’oignon gratinée — 9,00 €': 'オニオングラタンスープ — 9.00ユーロ',
  'Quiche lorraine & salade — 12,50 €': 'キッシュ・ロレーヌとサラダ — 12.50ユーロ',
  'Tarte Tatin maison — 6,00 €': '自家製タルト・タタン — 6.00ユーロ',
  'Café crème — 4,20 €': 'カフェ・クレーム（ミルクコーヒー） — 4.20ユーロ',
  'Service compris. Merci !': 'サービス料込み。ありがとうございます！',
  'CAFÉ LUMEN': 'カフェ・ルーメン（光のカフェ）',
};

export class MockTranslateService implements TranslateService {
  readonly mode = 'mock' as const;
  async translate(texts: { id: string; text: string; lang?: string }[], targetLang: string): Promise<Translation[]> {
    await sleep(450);
    return texts.map((t) => ({
      id: t.id,
      source: t.text,
      target: DICT[t.text] ?? `〔訳〕${t.text}`,
      sourceLang: t.lang ?? 'fr',
      targetLang,
    }));
  }
}

/** POST /translate { items:[{id,text,lang}], target } → Translation[] */
export class RemoteTranslateService implements TranslateService {
  readonly mode = 'real' as const;
  translate(texts: { id: string; text: string; lang?: string }[], targetLang: string) {
    return postJson<Translation[]>('/translate', { items: texts, target: targetLang });
  }
}
