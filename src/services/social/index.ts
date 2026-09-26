import type { MemoryItem, SocialDraft, SocialPlatform } from '../../core/types';
import { fmtDateJa, sleep } from '../../core/util';
import type { SocialService } from '../contracts';
import { postJson } from '../http';

const tagify = (t: string) => `#${t.replace(/[\s・/]/g, '')}`;

export class MockSocialService implements SocialService {
  readonly mode = 'mock' as const;
  async draft(item: MemoryItem, platform: SocialPlatform): Promise<SocialDraft> {
    await sleep(500);
    const where = item.place ?? item.tags[0] ?? '';
    const scene = item.scene ?? item.tags.slice(0, 2).join('・');
    const when = fmtDateJa(new Date(item.createdAt));
    const hashtags = [...item.tags.map(tagify), ...(platform === 'instagram' ? ['#photooftheday', '#FRIDAYcam'] : [])].slice(0, 8);
    if (platform === 'linkedin')
      return {
        platform,
        caption: `${where}で撮影した一枚。${scene}。\n\n現実の風景をAIが理解し、記憶として整理する — そんな体験を日々試しています。`,
        hashtags: hashtags.slice(0, 4),
      };
    if (platform === 'note')
      return {
        platform,
        caption: `${scene} — ${where}の記録`,
        hashtags: hashtags.slice(0, 5),
        body: `## はじめに\n${when}、${where}を訪れました。\n\n## 見たもの\n${item.tags.map((t) => `- ${t}`).join('\n')}\n\n## 感じたこと\n（ここに感想を追記）`,
      };
    return {
      platform,
      caption: `${scene}\n${where} ・ ${when}`,
      hashtags,
      reelIdea: '0-2秒: 引きの全景 → 2-5秒: 被写体にズーム（HUDオーバーレイ）→ 5-8秒: 夕景のタイムラプス / BGM: ローファイ',
    };
  }
}

/** POST /social/draft { item, platform } → SocialDraft */
export class RemoteSocialService implements SocialService {
  readonly mode = 'real' as const;
  draft(item: MemoryItem, platform: SocialPlatform) {
    const { thumbnail: _omit, ...meta } = item;
    void _omit;
    return postJson<SocialDraft>('/social/draft', { item: meta, platform });
  }
}
