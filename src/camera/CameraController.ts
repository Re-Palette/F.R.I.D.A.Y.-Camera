import type { CameraCapabilities, CameraSettings, Facing } from '../core/types';
import { clamp } from '../core/util';
import type { DemoScene, FrameSource } from '../services/contracts';
import { DemoFeed } from './demo/DemoFeed';

type ExtCaps = MediaTrackCapabilities & {
  zoom?: { min: number; max: number; step: number };
  torch?: boolean;
  exposureCompensation?: { min: number; max: number; step: number };
  focusMode?: string[];
  frameRate?: { max?: number };
};

/**
 * Camera layer. Owns the physical camera (getUserMedia) or the procedural
 * demo feed, and exposes a single `frame` for the vision layer. Hardware
 * features are applied through track constraints when the device supports
 * them, with graceful CSS fallbacks (digital zoom, exposure) otherwise.
 */
export class CameraController {
  readonly video: HTMLVideoElement;
  readonly demo: DemoFeed;
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  source: 'camera' | 'demo' = 'demo';
  facing: Facing = 'environment';
  caps: CameraCapabilities | null = null;

  constructor() {
    this.video = document.createElement('video');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
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
    const is4k = settings.resolution === '4k';
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: settings.facing },
        width: { ideal: is4k ? 3840 : 1920 },
        height: { ideal: is4k ? 2160 : 1080 },
        frameRate: { ideal: settings.fps },
      },
    });
    this.stream = stream;
    this.track = stream.getVideoTracks()[0] ?? null;
    this.facing = settings.facing;
    this.video.srcObject = stream;
    await this.video.play().catch(() => undefined);
    await new Promise<void>((resolve) => {
      if (this.video.videoWidth) resolve();
      else this.video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
    this.source = 'camera';
    this.demo.stop();
    this.caps = this.readCaps();
    await this.apply(settings);
  }

  startDemo(scene: DemoScene) {
    this.stopStream();
    this.source = 'demo';
    this.demo.setScene(scene);
    this.demo.start();
    this.caps = { torch: false, focusModes: [], zoom: { min: 1, max: 5, step: 0.1 }, maxWidth: 3840, maxHeight: 2160, maxFps: 60 };
  }

  setDemoScene(scene: DemoScene) {
    this.demo.setScene(scene);
  }

  resize(w: number, h: number) {
    this.demo.resize(w, h);
  }

  private readCaps(): CameraCapabilities {
    const c = (this.track?.getCapabilities?.() ?? {}) as ExtCaps;
    return {
      zoom: c.zoom ? { min: c.zoom.min, max: c.zoom.max, step: c.zoom.step || 0.1 } : undefined,
      torch: !!c.torch,
      exposure: c.exposureCompensation,
      focusModes: c.focusMode ?? [],
      maxWidth: c.width?.max,
      maxHeight: c.height?.max,
      maxFps: c.frameRate?.max,
    };
  }

  /** Applies hardware constraints. Returns which settings needed a CSS fallback. */
  async apply(s: CameraSettings): Promise<{ cssZoom: number; cssExposure: number }> {
    const out = { cssZoom: s.zoom, cssExposure: s.exposure };
    if (this.source !== 'camera' || !this.track || !this.caps) return out;
    const adv: Record<string, unknown> = {};
    if (this.caps.zoom) {
      adv.zoom = clamp(s.zoom, this.caps.zoom.min, this.caps.zoom.max);
      out.cssZoom = s.zoom / (adv.zoom as number);
    }
    if (this.caps.torch) adv.torch = s.torch;
    if (this.caps.exposure) {
      adv.exposureCompensation = clamp(s.exposure, this.caps.exposure.min, this.caps.exposure.max);
      out.cssExposure = 0;
    }
    if (Object.keys(adv).length) {
      try {
        await this.track.applyConstraints({ advanced: [adv as MediaTrackConstraintSet] });
      } catch {
        /* unsupported combination — keep CSS fallback */
        out.cssZoom = s.zoom;
      }
    }
    return out;
  }

  /** Tap-to-focus: single-shot focus when supported (point of interest is not widely exposed). */
  async focusAt(): Promise<void> {
    if (!this.track || !this.caps?.focusModes.length) return;
    const mode = this.caps.focusModes.includes('single-shot') ? 'single-shot' : this.caps.focusModes[0];
    try {
      await this.track.applyConstraints({ advanced: [{ focusMode: mode } as MediaTrackConstraintSet] });
    } catch {
      /* ignore */
    }
  }

  // ─── Recording ─────────────────────────────────────────────────────────

  startRecording(): boolean {
    const stream = this.source === 'camera' ? this.stream : this.demo.captureStream(30);
    if (!stream || typeof MediaRecorder === 'undefined') return false;
    const mime = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported?.(m));
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(500);
    return true;
  }

  stopRecording(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        resolve(this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }) : null);
        this.recorder = null;
      };
      rec.stop();
    });
  }

  private stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
  }

  dispose() {
    this.stopStream();
    this.demo.stop();
  }
}
