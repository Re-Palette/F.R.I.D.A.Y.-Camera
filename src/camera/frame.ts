import type { FrameSource } from '../services/contracts';

export function frameSize(frame: FrameSource): { w: number; h: number } {
  if (frame instanceof HTMLVideoElement) return { w: frame.videoWidth, h: frame.videoHeight };
  return { w: frame.width, h: frame.height };
}

export function frameReady(frame: FrameSource): boolean {
  if (frame instanceof HTMLVideoElement) return frame.readyState >= 2 && frame.videoWidth > 0;
  return frame.width > 2;
}

let scratch: HTMLCanvasElement | null = null;

/** Downscale a frame into a reusable canvas (for encoding or pixel stats). */
export function snapshot(frame: FrameSource, maxSide = 640): HTMLCanvasElement {
  const { w, h } = frameSize(frame);
  const k = Math.min(1, maxSide / Math.max(w, h || 1));
  scratch = scratch ?? document.createElement('canvas');
  scratch.width = Math.max(1, Math.round(w * k));
  scratch.height = Math.max(1, Math.round(h * k));
  scratch.getContext('2d')!.drawImage(frame, 0, 0, scratch.width, scratch.height);
  return scratch;
}

export function toJpegDataUrl(frame: FrameSource, maxSide = 640, quality = 0.72): string {
  return snapshot(frame, maxSide).toDataURL('image/jpeg', quality);
}

/** Full-resolution still (optionally mirrored for the selfie camera). */
export function captureStill(frame: FrameSource, mirror = false, filter?: string): Promise<Blob> {
  const { w, h } = frameSize(frame);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  if (filter) ctx.filter = filter;
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(frame, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.92),
  );
}

/** Mean luminance 0‥1 — cheap exposure / time-of-day heuristic. */
export function meanLuma(frame: FrameSource): number {
  const c = snapshot(frame, 48);
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (d.length / 4) / 255;
}
