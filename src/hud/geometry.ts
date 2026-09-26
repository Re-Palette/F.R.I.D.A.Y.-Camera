import type { BBox } from '../core/types';
import { frameToView } from '../core/util';
import type { FridayState } from '../store/useFriday';

/** Frame-normalised box → pixel box on screen (cover crop, mirroring, digital zoom). */
export function boxToScreen(b: BBox, s: Pick<FridayState, 'frameSize' | 'viewSize' | 'feedCss' | 'feed' | 'camera'>): BBox {
  const mirror = s.feed === 'camera' && s.camera.facing === 'user';
  const v = frameToView(b, s.frameSize, s.viewSize, mirror);
  const z = s.feedCss.zoom || 1;
  const x = (v.x - 0.5) * z + 0.5;
  const y = (v.y - 0.5) * z + 0.5;
  return { x: x * s.viewSize.w, y: y * s.viewSize.h, w: v.w * z * s.viewSize.w, h: v.h * z * s.viewSize.h };
}
