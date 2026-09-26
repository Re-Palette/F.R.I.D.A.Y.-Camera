/**
 * Pipeline 2 entry: samples camera frames for AI without ever touching the
 * preview path (pipeline 1 is <video> → compositor → screen).
 *
 *  - Driven by requestVideoFrameCallback (one callback per *camera* frame),
 *    falling back to the shared frame loop for the demo canvas.
 *  - Latest-frame-wins: while the AI is busy, frames are simply skipped —
 *    nothing is queued, so results never describe stale video.
 *  - Frames are GPU-downscaled with createImageBitmap(resize*) and handed to
 *    the engine; the full-resolution frame is never read by JavaScript.
 *  - Adaptive rate: the AI rate backs off when the display drops frames.
 */
import { perf } from '../perf/metrics';
import { onFrame } from '../perf/frameLoop';
import type { FrameSource, VisionFrame } from '../services/contracts';

export interface SamplerTarget {
  source: FrameSource;
  /** Does the engine need pixels? Mock engines don't — skip the bitmap copy. */
  needsPixels: boolean;
  inputSize: number;
}

type VideoFrameMeta = { presentedFrames: number; captureTime?: number; expectedDisplayTime: number; width: number; height: number };
type RVFCVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number; cancelVideoFrameCallback?: (h: number) => void };

const isVideo = (s: unknown): s is RVFCVideo => typeof HTMLVideoElement !== 'undefined' && s instanceof HTMLVideoElement;

export class FrameSampler {
  /** AI frames per second the sampler aims for (auto-adapted within [min, max]). */
  targetFps = 12;
  minFps = 5;
  maxFps = 15;
  /** Hard cap (e.g. lowered while recording to leave headroom for the encoder). */
  capFps = 15;

  private busy = false;
  private lastDispatch = -Infinity;
  private running = false;
  private stopLoop: (() => void) | null = null;
  private rvfcHandle = 0;
  private rvfcVideo: RVFCVideo | null = null;
  private camFrames = 0;
  private camWindow = 0;
  private lastPresented = 0;
  private aiDone = 0;
  private aiWindow = 0;
  private healthy = 0;

  constructor(
    private readonly target: () => SamplerTarget,
    private readonly run: (frame: VisionFrame) => Promise<void>,
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.bind();
  }

  stop() {
    this.running = false;
    this.unbind();
  }

  /** Re-attach after the feed changes (camera ↔ demo, facing switch). */
  rebind() {
    if (!this.running) return;
    this.unbind();
    this.lastPresented = 0;
    this.bind();
  }

  private bind() {
    const src = this.target().source as RVFCVideo;
    if (isVideo(src) && src.requestVideoFrameCallback) {
      this.rvfcVideo = src;
      const cb = (now: number, meta: VideoFrameMeta) => {
        if (!this.running || this.rvfcVideo !== src) return;
        this.onCameraFrame(now, meta);
        this.rvfcHandle = src.requestVideoFrameCallback!(cb);
      };
      this.rvfcHandle = src.requestVideoFrameCallback(cb);
    } else {
      // Demo canvas / browsers without rVFC: sample from the shared frame loop.
      this.stopLoop = onFrame((now) => this.offer(now, now));
    }
  }

  private unbind() {
    if (this.rvfcVideo?.cancelVideoFrameCallback && this.rvfcHandle) this.rvfcVideo.cancelVideoFrameCallback(this.rvfcHandle);
    this.rvfcVideo = null;
    this.rvfcHandle = 0;
    this.stopLoop?.();
    this.stopLoop = null;
  }

  private onCameraFrame(now: number, meta: VideoFrameMeta) {
    // Preview health (measured, never influenced by AI work).
    if (this.lastPresented && meta.presentedFrames - this.lastPresented > 1) perf.camDropped += meta.presentedFrames - this.lastPresented - 1;
    this.lastPresented = meta.presentedFrames;
    this.camFrames++;
    if (!this.camWindow) this.camWindow = now;
    if (now - this.camWindow >= 1000) {
      perf.camFps = (this.camFrames * 1000) / (now - this.camWindow);
      this.camFrames = 0;
      this.camWindow = now;
    }
    if (meta.captureTime) perf.camLatencyMs = Math.max(0, meta.expectedDisplayTime - meta.captureTime);
    perf.camRes = `${meta.width}×${meta.height}`;
    this.offer(now, meta.captureTime ?? now);
  }

  /** A new frame is available. Dispatches it if due and the engine is idle; otherwise drops it. */
  offer(now: number, capturedAt: number) {
    const interval = 1000 / Math.min(this.targetFps, this.capFps);
    if (now - this.lastDispatch < interval) return;
    if (this.busy) {
      perf.aiSkipped++; // latest-frame-wins: drop, never queue
      return;
    }
    this.lastDispatch = now;
    void this.dispatch(capturedAt);
  }

  private async dispatch(capturedAt: number) {
    this.busy = true;
    const t = this.target();
    const t0 = performance.now();
    try {
      let bitmap: ImageBitmap | null = null;
      const w = isVideo(t.source) ? t.source.videoWidth : t.source.width;
      const h = isVideo(t.source) ? t.source.videoHeight : t.source.height;
      if (!w || !h) return;
      if (t.needsPixels) {
        const k = Math.min(1, t.inputSize / Math.max(w, h));
        bitmap = await createImageBitmap(t.source, { resizeWidth: Math.round(w * k), resizeHeight: Math.round(h * k), resizeQuality: 'low' });
      }
      await this.run({ source: t.source, bitmap, width: w, height: h, capturedAt });
      perf.aiLatencyMs = performance.now() - capturedAt;
      this.adapt(performance.now() - t0);
    } catch {
      /* engine error — the next frame will retry */
    } finally {
      this.busy = false;
    }
  }

  private adapt(roundTripMs: number) {
    this.aiDone++;
    const now = performance.now();
    if (!this.aiWindow) this.aiWindow = now;
    if (now - this.aiWindow >= 1000) {
      perf.aiFps = (this.aiDone * 1000) / (now - this.aiWindow);
      this.aiDone = 0;
      this.aiWindow = now;
      // Display first: back off AI when the HUD can't hold its refresh rate.
      const displayOk = perf.fps === 0 || perf.fps >= perf.refreshHz * 0.9;
      const canKeepUp = roundTripMs < 1000 / this.targetFps;
      if (!displayOk) {
        this.targetFps = Math.max(this.minFps, this.targetFps - 3);
        this.healthy = 0;
      } else if (canKeepUp && ++this.healthy >= 3) {
        this.targetFps = Math.min(this.maxFps, this.targetFps + 1);
        this.healthy = 0;
      }
    }
    perf.aiTargetFps = Math.min(this.targetFps, this.capFps);
  }
}
