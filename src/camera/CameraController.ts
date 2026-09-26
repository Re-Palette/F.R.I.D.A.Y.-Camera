import type { CameraCapabilities, CameraSettings, Facing } from '../core/types';
import { clamp } from '../core/util';
import type { DemoScene, FrameSource } from '../services/contracts';
import { DemoFeed } from './demo/DemoFeed';
import { captureStill } from './frame';

type ExtCaps = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step: number };
  torch?: boolean;
  exposureCompensation?: { min: number; max: number; step: number };
  focusMode?: string[];
  frameRate?: { max?: number };
};

interface ImageCaptureLike {
  takePhoto(settings?: { imageWidth?: number; imageHeight?: number; fillLightMode?: string }): Promise<Blob>;
  getPhotoCapabilities(): Promise<{ imageWidth?: { max: number }; imageHeight?: { max: number }; fillLightMode?: string[] }>;
}
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

const PREVIEW = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
} as const;

/**
 * Camera layer — "見る" と "撮る" を分離:
 *
 *  PREVIEW (pipeline 1): a modest-resolution, high-fps MediaStream played by a
 *  <video> element. The browser composites it on the GPU; no JavaScript ever
 *  touches preview pixels, so AI or HUD work cannot make it stutter.
 *
 *  CAPTURE: on shutter only — ImageCapture.takePhoto() at the sensor's full
 *  resolution (the ISP applies its own HDR / noise reduction), falling back to
 *  a preview frame where ImageCapture is unavailable.
 *
 *  RECORD: MediaRecorder on the camera stream itself (hardware encoder), fully
 *  independent from the HUD and from AI.
 */
export class CameraController {
  readonly video: HTMLVideoElement;
  readonly demo: DemoFeed;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private imageCapture: ImageCaptureLike | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  source: 'camera' | 'demo' = 'demo';
  facing: Facing = 'environment';
  caps: CameraCapabilities | null = null;
  /** Called whenever the preview element changes (so the sampler can re-bind). */
  onFeedElementChange: (() => void) | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.disablePictureInPicture = true;
    this.video.setAttribute('playsinline', '');
    this.demo = new DemoFeed();
  }

  get frame(): FrameSource {
    return this.source === 'camera' ? this.video : this.demo.canvas;
  }

  get mirrored(): boolean {
    return this.source === 'camera' && this.facing === 'user';
  }

  get frameSize() {
    return this.source === 'camera'
      ? { w: this.video.videoWidth, h: this.video.videoHeight }
      : { w: this.demo.canvas.width, h: this.demo.canvas.height };
  }

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  async startCamera(settings: CameraSettings): Promise<void> {
    this.stopStream();
    const res = PREVIEW[settings.preview];
    // Portrait phones deliver rotated frames; ask for the long side on width and
    // let the browser pick the orientation. `max` stops drivers from choosing a
    // heavy 4K mode that would cost frame rate.
    // Only `ideal` (soft) constraints plus a `max` cap: a hard `min` frame rate
    // makes getUserMedia fail outright on cameras that can't reach it.
    const video: MediaTrackConstraints = {
      facingMode: { ideal: settings.facing },
      width: { ideal: res.width, max: 1920 },
      height: { ideal: res.height, max: 1920 },
      frameRate: { ideal: settings.fps },
      // Hint for Chrome: scale down in the capture pipeline rather than pick a heavy native mode.
      ...({ resizeMode: 'crop-and-scale' } as object),
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (err) {
      if ((err as Error).name !== 'OverconstrainedError') throw err;
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: settings.facing } } });
    }
    this.stream = stream;
    this.track = stream.getVideoTracks()[0] ?? null;
    if (this.track && 'contentHint' in this.track) this.track.contentHint = 'motion';
    this.facing = settings.facing;
    this.video.srcObject = stream;
    await this.video.play().catch(() => undefined);
    await new Promise<void>((resolve) => {
      if (this.video.videoWidth) resolve();
      else this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    this.source = 'camera';
    this.demo.stop();
    const IC = (globalThis as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
    this.imageCapture = IC && this.track ? new IC(this.track) : null;
    this.caps = await this.readCaps();
    await this.apply(settings);
    this.onFeedElementChange?.();
  }

  startDemo(scene: DemoScene) {
    this.stopStream();
    this.source = 'demo';
    this.demo.setScene(scene);
    this.demo.start();
    this.caps = { torch: false, focusModes: [], zoom: { min: 1, max: 5, step: 0.1 }, maxWidth: 1280, maxHeight: 720, maxFps: 60 };
    this.onFeedElementChange?.();
  }

  setDemoScene(scene: DemoScene) {
    this.demo.setScene(scene);
  }

  resize(w: number, h: number) {
    this.demo.resize(w, h);
  }

  private async readCaps(): Promise<CameraCapabilities> {
    const c = (this.track?.getCapabilities?.() ?? {}) as ExtCaps;
    const photo = await this.imageCapture?.getPhotoCapabilities().catch(() => null);
    return {
      zoom: c.zoom ? { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step || 0.1 } : undefined,
      torch: !!c.torch,
      exposure: c.exposureCompensation,
      focusModes: c.focusMode ?? [],
      maxWidth: c.width?.max,
      maxHeight: c.height?.max,
      maxFps: c.frameRate?.max,
      photoWidth: photo?.imageWidth?.max,
      photoHeight: photo?.imageHeight?.max,
    };
  }

  /** Applies hardware constraints. Returns which settings needed a CSS fallback. */
  async apply(s: CameraSettings): Promise<{ cssZoom: number; cssExposure: number }> {
    const exposure = s.night ? Math.max(s.exposure, 2) : s.exposure;
    const out = { cssZoom: s.zoom, cssExposure: exposure };
    if (this.source !== 'camera' || !this.track || !this.caps) return out;
    const adv: Record<string, unknown> = {};
    if (this.caps.zoom) {
      adv.zoom = clamp(s.zoom, this.caps.zoom.min, this.caps.zoom.max);
      out.cssZoom = s.zoom / (adv.zoom as number);
    }
    if (this.caps.torch) adv.torch = s.torch;
    if (this.caps.exposure) {
      adv.exposureCompensation = clamp(exposure, this.caps.exposure.min, this.caps.exposure.max);
      out.cssExposure = 0;
    }
    if (Object.keys(adv).length) {
      try {
        await this.track.applyConstraints({ advanced: [adv as MediaTrackConstraintSet] });
      } catch {
        out.cssZoom = s.zoom;
      }
    }
    return out;
  }

  /** Tap-to-focus: single-shot focus when supported. */
  async focusAt(): Promise<void> {
    if (!this.track || !this.caps?.focusModes.length) return;
    const mode = this.caps.focusModes.includes('single-shot') ? 'single-shot' : this.caps.focusModes[0];
    try {
      await this.track.applyConstraints({ advanced: [{ focusMode: mode } as MediaTrackConstraintSet] });
    } catch {
      /* ignore */
    }
  }

  // ─── Capture (撮る) ─────────────────────────────────────────────────────

  /**
   * High-quality still, taken only at shutter time. The preview keeps running;
   * on Android the ISP reconfigures briefly for the full-res shot.
   */
  async takePhoto(s: CameraSettings): Promise<{ blob: Blob; source: 'sensor' | 'preview' }> {
    if (this.source === 'camera' && this.imageCapture && s.photo === 'max' && !this.mirrored) {
      try {
        const blob = await this.imageCapture.takePhoto({
          imageWidth: this.caps?.photoWidth,
          imageHeight: this.caps?.photoHeight,
          fillLightMode: s.torch ? 'flash' : 'off',
        });
        return { blob, source: 'sensor' };
      } catch {
        /* fall back to a preview frame */
      }
    }
    return { blob: await captureStill(this.frame, this.mirrored), source: 'preview' };
  }

  // ─── Recording ─────────────────────────────────────────────────────────

  startRecording(): boolean {
    const stream = this.source === 'camera' ? this.stream : this.demo.captureStream(30);
    if (!stream || typeof MediaRecorder === 'undefined') return false;
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8_000_000 } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    return true;
  }

  stopRecording(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        resolve(this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }) : null);
        this.recorder = null;
        this.chunks = [];
      };
      rec.stop();
    });
  }

  private stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.imageCapture = null;
  }

  dispose() {
    this.stopStream();
    this.demo.stop();
  }
}
