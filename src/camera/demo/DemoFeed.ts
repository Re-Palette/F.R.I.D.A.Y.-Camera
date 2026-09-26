/**
 * Procedural "camera" feed used when no physical camera is available
 * (desktop preview, permission denied, automated screenshots) or when the
 * user explicitly picks DEMO FEED. It renders into a canvas that the vision
 * layer reads exactly like a <video> element.
 */
import type { DemoScene } from '../../services/contracts';
import { DEMO_MENU_LINES, streetCarBox, sway } from './geometry';

type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class DemoFeed {
  readonly canvas: HTMLCanvasElement;
  private ctx: Ctx;
  private staticLayer: HTMLCanvasElement | null = null;
  private staticKey = '';
  private raf = 0;
  private t0 = performance.now();
  private sceneStart = performance.now();
  scene: DemoScene = 'odaiba';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d')!;
  }

  /** Seconds since the current scene started (the mock detector uses this too). */
  get sceneTime(): number {
    return (performance.now() - this.sceneStart) / 1000;
  }

  get time(): number {
    return (performance.now() - this.t0) / 1000;
  }

  setScene(scene: DemoScene) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.sceneStart = performance.now();
    this.staticKey = '';
  }

  resize(cssW: number, cssH: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    const w = Math.max(2, Math.round(cssW * dpr));
    const h = Math.max(2, Math.round(cssH * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.staticKey = '';
    }
  }

  start() {
    cancelAnimationFrame(this.raf);
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  /** A MediaStream of the demo feed, used for video recording in demo mode. */
  captureStream(fps = 30): MediaStream | null {
    const c = this.canvas as HTMLCanvasElement & { captureStream?: (fps: number) => MediaStream };
    return c.captureStream ? c.captureStream(fps) : null;
  }

  private ensureStatic() {
    const { width: W, height: H } = this.canvas;
    const key = `${this.scene}:${W}x${H}`;
    if (key === this.staticKey && this.staticLayer) return;
    const layer = this.staticLayer ?? document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    const c = layer.getContext('2d')!;
    c.clearRect(0, 0, W, H);
    STATIC[this.scene](c, W, H);
    this.staticLayer = layer;
    this.staticKey = key;
  }

  private draw() {
    const { ctx } = this;
    const { width: W, height: H } = this.canvas;
    this.ensureStatic();
    const t = this.time;
    const tr = sway(t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#02040a';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(tr.s, 0, 0, tr.s, W * (0.5 - 0.5 * tr.s + tr.dx), H * (0.5 - 0.5 * tr.s + tr.dy));
    ctx.drawImage(this.staticLayer!, 0, 0, W, H);
    DYNAMIC[this.scene](ctx, W, H, t, this.sceneTime);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Sensor noise + vignette for a "real lens" feel.
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }
}

// ─── Scene: Odaiba at dusk ─────────────────────────────────────────────────

const HORIZON = 0.555;

function odaibaStatic(c: Ctx, W: number, H: number) {
  const r = rng(7);
  const sky = c.createLinearGradient(0, 0, 0, H * HORIZON);
  sky.addColorStop(0, '#050a1c');
  sky.addColorStop(0.28, '#0e1a40');
  sky.addColorStop(0.55, '#2c2858');
  sky.addColorStop(0.74, '#7c3b58');
  sky.addColorStop(0.88, '#d45f3a');
  sky.addColorStop(1, '#ffb257');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H * HORIZON + 2);

  // Sun glow
  const sx = W * 0.52;
  const sy = H * 0.535;
  const glow = c.createRadialGradient(sx, sy, 0, sx, sy, Math.max(W, H) * 0.42);
  glow.addColorStop(0, 'rgba(255,236,190,0.95)');
  glow.addColorStop(0.05, 'rgba(255,170,80,0.7)');
  glow.addColorStop(0.3, 'rgba(230,90,50,0.22)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H * HORIZON + 2);

  // Clouds — layered soft ellipses, lit from below near the horizon.
  for (let i = 0; i < 90; i++) {
    const y = H * (0.04 + Math.pow(r(), 0.8) * 0.44);
    const x = W * (r() * 1.3 - 0.15);
    const w = W * (0.12 + r() * 0.42);
    const h = H * (0.008 + r() * 0.028);
    const nearHorizon = y / (H * HORIZON);
    const g = c.createLinearGradient(0, y - h, 0, y + h);
    const lit = Math.min(1, Math.max(0, (nearHorizon - 0.35) * 1.6));
    g.addColorStop(0, `rgba(${14 + lit * 40},${20 + lit * 18},${48 + lit * 10},0.9)`);
    g.addColorStop(0.7, `rgba(${40 + lit * 180},${34 + lit * 70},${70 - lit * 20},0.85)`);
    g.addColorStop(1, `rgba(${90 + lit * 165},${60 + lit * 110},${70 + lit * 10},${0.4 + lit * 0.4})`);
    c.globalAlpha = 0.35 + r() * 0.45;
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, w / 2, h, (r() - 0.5) * 0.08, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;

  // Water
  const wy = H * HORIZON;
  const water = c.createLinearGradient(0, wy, 0, H);
  water.addColorStop(0, '#3a2440');
  water.addColorStop(0.12, '#1a1733');
  water.addColorStop(0.5, '#0b0f24');
  water.addColorStop(1, '#04060f');
  c.fillStyle = water;
  c.fillRect(0, wy, W, H - wy);

  // Distant skyline
  let x = -W * 0.02;
  while (x < W * 1.02) {
    const bw = W * (0.012 + r() * 0.035);
    const center = Math.exp(-Math.pow((x / W - 0.62) / 0.22, 2));
    const bh = H * (0.015 + r() * 0.05 + center * r() * 0.1);
    const top = wy - bh;
    const g = c.createLinearGradient(0, top, 0, wy);
    g.addColorStop(0, '#1b1f3e');
    g.addColorStop(1, '#0a0d22');
    c.fillStyle = g;
    c.fillRect(x, top, bw, bh + 1);
    // lit windows
    for (let wx = x + 2; wx < x + bw - 2; wx += Math.max(3, W * 0.004)) {
      for (let wy2 = top + 3; wy2 < wy - 2; wy2 += Math.max(3, H * 0.004)) {
        if (r() < 0.22) {
          const col = r() < 0.75 ? '255,205,130' : '140,210,255';
          c.fillStyle = `rgba(${col},${0.35 + r() * 0.55})`;
          c.fillRect(wx, wy2, Math.max(1, W * 0.0015), Math.max(1, H * 0.0012));
        }
      }
    }
    x += bw + W * r() * 0.004;
  }

  // Tokyo Tower
  const tx = W * 0.78;
  const tTop = H * 0.3;
  const tBase = H * 0.565;
  const half = W * 0.042;
  c.save();
  c.shadowColor = 'rgba(255,90,40,0.9)';
  c.shadowBlur = W * 0.02;
  c.strokeStyle = '#ff6a2e';
  c.lineWidth = Math.max(1.2, W * 0.0028);
  c.beginPath();
  c.moveTo(tx - half, tBase);
  c.quadraticCurveTo(tx - half * 0.2, tBase - (tBase - tTop) * 0.45, tx - 1, tTop + (tBase - tTop) * 0.12);
  c.moveTo(tx + half, tBase);
  c.quadraticCurveTo(tx + half * 0.2, tBase - (tBase - tTop) * 0.45, tx + 1, tTop + (tBase - tTop) * 0.12);
  c.stroke();
  // lattice
  c.lineWidth = Math.max(0.6, W * 0.001);
  for (let k = 0; k < 14; k++) {
    const f = k / 14;
    const yy = tBase - (tBase - tTop) * 0.88 * f;
    const ww = half * Math.pow(1 - f, 1.7);
    c.beginPath();
    c.moveTo(tx - ww, yy);
    c.lineTo(tx + ww, yy - (tBase - tTop) * 0.03);
    c.moveTo(tx + ww, yy);
    c.lineTo(tx - ww, yy - (tBase - tTop) * 0.03);
    c.stroke();
  }
  c.fillStyle = '#ffd0a0';
  c.fillRect(tx - half * 0.42, tBase - (tBase - tTop) * 0.4, half * 0.84, H * 0.006);
  c.fillRect(tx - half * 0.2, tBase - (tBase - tTop) * 0.68, half * 0.4, H * 0.004);
  c.strokeStyle = '#ff8a50';
  c.beginPath();
  c.moveTo(tx, tTop + (tBase - tTop) * 0.12);
  c.lineTo(tx, tTop);
  c.stroke();
  c.restore();

  // Rainbow Bridge
  const deckL = { x: W * 0.02, y: H * 0.605 };
  const deckR = { x: W * 0.66, y: H * 0.566 };
  const deckY = (px: number) => deckL.y + ((px - deckL.x) / (deckR.x - deckL.x)) * (deckR.y - deckL.y);
  const t1 = W * 0.2;
  const t2 = W * 0.45;
  const topY1 = H * 0.405;
  const topY2 = H * 0.41;
  c.save();
  c.shadowColor = 'rgba(210,220,255,0.6)';
  c.shadowBlur = W * 0.01;
  // towers
  for (const [tx2, ty] of [
    [t1, topY1],
    [t2, topY2],
  ] as const) {
    const leg = W * 0.011;
    c.fillStyle = '#c9cde6';
    c.fillRect(tx2 - leg, ty, W * 0.004, deckY(tx2) - ty + H * 0.03);
    c.fillRect(tx2 + leg - W * 0.004, ty, W * 0.004, deckY(tx2) - ty + H * 0.03);
    for (let k = 0; k < 3; k++) c.fillRect(tx2 - leg, ty + (deckY(tx2) - ty) * (0.12 + k * 0.33), leg * 2, H * 0.003);
  }
  // main cables
  c.strokeStyle = 'rgba(225,230,255,0.85)';
  c.lineWidth = Math.max(1, W * 0.0022);
  c.beginPath();
  c.moveTo(deckL.x, deckY(deckL.x) - H * 0.004);
  c.quadraticCurveTo(W * 0.12, deckY(W * 0.12) - H * 0.05, t1, topY1);
  c.quadraticCurveTo((t1 + t2) / 2, H * 0.575, t2, topY2);
  c.quadraticCurveTo(W * 0.56, deckY(W * 0.56) - H * 0.05, deckR.x, deckY(deckR.x) - H * 0.004);
  c.stroke();
  // suspenders
  c.lineWidth = Math.max(0.5, W * 0.0008);
  c.strokeStyle = 'rgba(210,215,245,0.45)';
  const cableY = (px: number) => {
    if (px < t1) {
      const f = (px - deckL.x) / (t1 - deckL.x);
      return deckY(px) - H * 0.004 + (topY1 - deckY(px)) * f * f;
    }
    if (px < t2) {
      const f = (px - t1) / (t2 - t1);
      const mid = H * 0.49;
      return (1 - f) * (1 - f) * topY1 + 2 * (1 - f) * f * mid + f * f * topY2;
    }
    const f = 1 - (px - t2) / (deckR.x - t2);
    return deckY(px) + (topY2 - deckY(px)) * f * f;
  };
  for (let px = deckL.x; px < deckR.x; px += W * 0.008) {
    c.beginPath();
    c.moveTo(px, cableY(px));
    c.lineTo(px, deckY(px));
    c.stroke();
  }
  c.restore();
  // deck
  c.fillStyle = '#1a1c30';
  c.beginPath();
  c.moveTo(deckL.x, deckL.y);
  c.lineTo(deckR.x, deckR.y);
  c.lineTo(deckR.x, deckR.y + H * 0.012);
  c.lineTo(deckL.x, deckL.y + H * 0.016);
  c.closePath();
  c.fill();
  // piers
  c.fillStyle = '#10121f';
  for (const px of [W * 0.08, t1, t2, W * 0.58]) c.fillRect(px - W * 0.006, deckY(px), W * 0.012, H * 0.05);

  // Foreground dark buildings (bottom corners) for depth
  const fg = rng(99);
  for (const side of [0, 1]) {
    let fx = side === 0 ? -W * 0.02 : W * 0.72;
    const end = side === 0 ? W * 0.3 : W * 1.02;
    while (fx < end) {
      const bw = W * (0.05 + fg() * 0.08);
      const bh = H * (0.08 + fg() * 0.16) * (side === 0 ? 1 - (fx / W) * 1.8 : (fx / W - 0.6) * 1.5);
      const top = H - Math.max(H * 0.04, bh);
      c.fillStyle = '#05070f';
      c.fillRect(fx, top, bw, H - top);
      for (let wx = fx + 3; wx < fx + bw - 3; wx += W * 0.012) {
        for (let wy2 = top + 4; wy2 < H; wy2 += H * 0.012) {
          if (fg() < 0.3) {
            c.fillStyle = `rgba(255,190,110,${0.25 + fg() * 0.6})`;
            c.fillRect(wx, wy2, W * 0.005, H * 0.004);
          }
        }
      }
      fx += bw + W * 0.004;
    }
  }
}

function odaibaDynamic(c: Ctx, W: number, H: number, t: number) {
  const wy = H * HORIZON;
  // Sun core
  const sx = W * 0.52;
  const sy = H * 0.535;
  const pulse = 1 + Math.sin(t * 1.4) * 0.04;
  const core = c.createRadialGradient(sx, sy, 0, sx, sy, W * 0.05 * pulse);
  core.addColorStop(0, 'rgba(255,255,240,1)');
  core.addColorStop(0.3, 'rgba(255,220,150,0.8)');
  core.addColorStop(1, 'rgba(255,140,60,0)');
  c.fillStyle = core;
  c.beginPath();
  c.arc(sx, sy, W * 0.05 * pulse, 0, Math.PI * 2);
  c.fill();

  // Sun reflection shimmer on water
  for (let i = 0; i < 46; i++) {
    const f = i / 46;
    const y = wy + (H - wy) * Math.pow(f, 1.4) * 0.9 + 2;
    const width = W * (0.02 + f * 0.16) * (0.6 + 0.4 * Math.sin(t * 2.2 + i * 1.7));
    const x = sx + Math.sin(t * 1.1 + i * 0.9) * W * 0.012 * (1 + f * 3) - width / 2;
    c.fillStyle = `rgba(255,${150 + Math.round((1 - f) * 80)},${70 + Math.round((1 - f) * 60)},${0.55 * (1 - f)})`;
    c.fillRect(x, y, width, Math.max(1, H * 0.0025));
  }
  // City light reflections
  for (let i = 0; i < 70; i++) {
    const px = ((i * 137.5) % 100) / 100;
    const x = W * px;
    const len = H * (0.02 + ((i * 53) % 10) / 100);
    const a = 0.12 + 0.12 * Math.sin(t * 2 + i);
    c.fillStyle = `rgba(255,190,120,${a})`;
    c.fillRect(x, wy + 3, Math.max(1, W * 0.002), len);
  }

  // Bridge deck lights
  const deckL = { x: W * 0.02, y: H * 0.605 };
  const deckR = { x: W * 0.66, y: H * 0.566 };
  for (let i = 0; i <= 60; i++) {
    const f = i / 60;
    const x = deckL.x + (deckR.x - deckL.x) * f;
    const y = deckL.y + (deckR.y - deckL.y) * f;
    const on = 0.55 + 0.45 * Math.sin(t * 3 + i * 0.7);
    c.fillStyle = `rgba(255,230,190,${on})`;
    c.fillRect(x, y - 1, Math.max(1.2, W * 0.0024), Math.max(1.2, W * 0.0024));
  }
  // Tower aviation lights
  const blink = Math.sin(t * 3) > 0.6 ? 1 : 0.15;
  c.fillStyle = `rgba(255,60,40,${blink})`;
  for (const [x, y] of [
    [W * 0.2, H * 0.4],
    [W * 0.45, H * 0.405],
    [W * 0.78, H * 0.296],
  ])
    c.fillRect(x - 1.5, y - 1.5, 3, 3);

  // Yakatabune (boat) bobbing
  const bx = W * 0.63 + Math.sin(t * 0.2) * W * 0.006;
  const by = H * 0.683 + Math.sin(t * 1.2) * H * 0.0015;
  c.fillStyle = '#0c0d18';
  c.beginPath();
  c.moveTo(bx - W * 0.075, by);
  c.lineTo(bx + W * 0.075, by);
  c.lineTo(bx + W * 0.06, by + H * 0.014);
  c.lineTo(bx - W * 0.065, by + H * 0.014);
  c.closePath();
  c.fill();
  c.fillStyle = '#2a1a14';
  c.fillRect(bx - W * 0.06, by - H * 0.018, W * 0.115, H * 0.018);
  for (let i = 0; i < 9; i++) {
    const a = 0.6 + 0.4 * Math.sin(t * 2 + i);
    c.fillStyle = `rgba(255,170,80,${a})`;
    c.fillRect(bx - W * 0.055 + i * W * 0.012, by - H * 0.014, W * 0.007, H * 0.008);
  }
  const refl = c.createLinearGradient(0, by + H * 0.014, 0, by + H * 0.05);
  refl.addColorStop(0, 'rgba(255,160,80,0.25)');
  refl.addColorStop(1, 'rgba(255,160,80,0)');
  c.fillStyle = refl;
  c.fillRect(bx - W * 0.06, by + H * 0.014, W * 0.12, H * 0.036);
}

// ─── Scene: desk (products) ────────────────────────────────────────────────

function bokeh(c: Ctx, W: number, H: number, seed: number, tint: string) {
  const r = rng(seed);
  for (let i = 0; i < 26; i++) {
    const x = r() * W;
    const y = r() * H * 0.45;
    const rad = W * (0.02 + r() * 0.07);
    const g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${tint},${0.12 + r() * 0.18})`);
    g.addColorStop(1, `rgba(${tint},0)`);
    c.fillStyle = g;
    c.beginPath();
    c.arc(x, y, rad, 0, Math.PI * 2);
    c.fill();
  }
}

function rr(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function deskStatic(c: Ctx, W: number, H: number) {
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0b1020');
  bg.addColorStop(0.55, '#141827');
  bg.addColorStop(0.56, '#2a1f1a');
  bg.addColorStop(1, '#120d0b');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  bokeh(c, W, H, 3, '255,170,90');
  bokeh(c, W, H, 5, '90,190,255');
  // laptop screen
  const sx = W * 0.2;
  const sy = H * 0.4;
  const sw = W * 0.54;
  const sh = H * 0.22;
  c.fillStyle = '#1b1e28';
  rr(c, sx - W * 0.012, sy - W * 0.012, sw + W * 0.024, sh + W * 0.024, W * 0.012);
  c.fill();
  const scr = c.createLinearGradient(sx, sy, sx + sw, sy + sh);
  scr.addColorStop(0, '#0d2340');
  scr.addColorStop(1, '#101a33');
  c.fillStyle = scr;
  c.fillRect(sx, sy, sw, sh);
  const r = rng(11);
  for (let i = 0; i < 14; i++) {
    c.fillStyle = r() < 0.3 ? 'rgba(255,160,80,0.8)' : 'rgba(120,200,255,0.65)';
    c.fillRect(sx + sw * 0.06 + r() * sw * 0.05, sy + sh * (0.1 + i * 0.058), sw * (0.15 + r() * 0.55), Math.max(1, sh * 0.02));
  }
  // base
  c.fillStyle = '#9aa0ad';
  c.beginPath();
  c.moveTo(sx - W * 0.05, sy + sh + W * 0.014);
  c.lineTo(sx + sw + W * 0.05, sy + sh + W * 0.014);
  c.lineTo(sx + sw + W * 0.07, sy + sh + H * 0.045);
  c.lineTo(sx - W * 0.07, sy + sh + H * 0.045);
  c.closePath();
  c.fill();
  c.fillStyle = '#6b707c';
  c.fillRect(sx - W * 0.07, sy + sh + H * 0.045, sw + W * 0.14, H * 0.008);
  // phone
  const px = W * 0.7;
  const py = H * 0.725;
  c.save();
  c.translate(px + W * 0.08, py + H * 0.055);
  c.rotate(-0.25);
  c.fillStyle = '#0d0f16';
  rr(c, -W * 0.075, -H * 0.045, W * 0.15, H * 0.09, W * 0.015);
  c.fill();
  const ps = c.createLinearGradient(-W * 0.07, 0, W * 0.07, 0);
  ps.addColorStop(0, '#3b2a6b');
  ps.addColorStop(1, '#ff8a3c');
  c.fillStyle = ps;
  rr(c, -W * 0.068, -H * 0.039, W * 0.136, H * 0.078, W * 0.01);
  c.fill();
  c.restore();
  // coffee cup
  const cx = W * 0.155;
  const cy = H * 0.75;
  c.fillStyle = '#e9e4da';
  c.beginPath();
  c.ellipse(cx, cy + H * 0.04, W * 0.07, H * 0.012, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f3efe7';
  c.fillRect(cx - W * 0.05, cy - H * 0.02, W * 0.1, H * 0.055);
  c.fillStyle = '#3b2415';
  c.beginPath();
  c.ellipse(cx, cy - H * 0.02, W * 0.05, H * 0.008, 0, 0, Math.PI * 2);
  c.fill();
}

function deskDynamic(c: Ctx, W: number, H: number, t: number) {
  // blinking cursor on screen
  if (Math.sin(t * 5) > 0) {
    c.fillStyle = 'rgba(255,200,120,0.9)';
    c.fillRect(W * 0.5, H * 0.585, W * 0.008, H * 0.012);
  }
  // steam
  for (let i = 0; i < 3; i++) {
    const a = 0.08 + 0.05 * Math.sin(t * 1.5 + i);
    c.strokeStyle = `rgba(255,255,255,${a})`;
    c.lineWidth = W * 0.004;
    c.beginPath();
    const bx = W * (0.14 + i * 0.015);
    c.moveTo(bx, H * 0.72);
    c.bezierCurveTo(bx + Math.sin(t + i) * W * 0.02, H * 0.69, bx - W * 0.015, H * 0.67, bx + Math.sin(t * 0.7 + i) * W * 0.02, H * 0.64);
    c.stroke();
  }
}

// ─── Scene: foreign-language menu (OCR / translate) ─────────────────────────

function menuStatic(c: Ctx, W: number, H: number) {
  const bg = c.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#1c130e');
  bg.addColorStop(1, '#0a0706');
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  bokeh(c, W, H, 21, '255,180,100');
  const x = W * 0.12;
  const y = H * 0.22;
  const w = W * 0.76;
  const h = H * 0.56;
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.6)';
  c.shadowBlur = W * 0.04;
  const paper = c.createLinearGradient(x, y, x + w, y + h);
  paper.addColorStop(0, '#f4ecd9');
  paper.addColorStop(1, '#ddd0b5');
  c.fillStyle = paper;
  c.fillRect(x, y, w, h);
  c.restore();
  c.strokeStyle = 'rgba(90,60,30,0.5)';
  c.lineWidth = Math.max(1, W * 0.002);
  c.strokeRect(x + w * 0.04, y + h * 0.03, w * 0.92, h * 0.94);
  c.fillStyle = '#2a1a10';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const line of DEMO_MENU_LINES) {
    const size = line.size === 'title' ? 0.055 : line.size === 'item' ? 0.032 : 0.026;
    c.font = `${line.size === 'title' ? '700' : line.size === 'note' ? 'italic 400' : '500'} ${Math.round(Math.min(W, H * 0.7) * size)}px Georgia, 'Times New Roman', serif`;
    c.fillText(line.text, W / 2, H * line.y, w * 0.86);
  }
}

// ─── Scene: street (hazards / places) ──────────────────────────────────────

function streetStatic(c: Ctx, W: number, H: number) {
  const sky = c.createLinearGradient(0, 0, 0, H * 0.5);
  sky.addColorStop(0, '#060a18');
  sky.addColorStop(1, '#1b2340');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);
  // buildings
  const r = rng(31);
  for (const side of [0, 1]) {
    for (let i = 0; i < 6; i++) {
      const bx = side === 0 ? W * (i * 0.07 - 0.05) : W * (0.62 + i * 0.07);
      const bh = H * (0.25 + r() * 0.3);
      c.fillStyle = side === 0 ? '#0b0f1e' : '#0d1122';
      c.fillRect(bx, H * 0.52 - bh, W * 0.08, bh + H * 0.02);
      for (let k = 0; k < 20; k++) {
        if (r() < 0.5) {
          c.fillStyle = `rgba(255,200,130,${0.2 + r() * 0.5})`;
          c.fillRect(bx + W * (0.01 + r() * 0.055), H * 0.52 - bh + r() * bh, W * 0.008, H * 0.006);
        }
      }
    }
  }
  // road
  const road = c.createLinearGradient(0, H * 0.5, 0, H);
  road.addColorStop(0, '#1b1d26');
  road.addColorStop(1, '#0c0d12');
  c.fillStyle = road;
  c.beginPath();
  c.moveTo(W * 0.4, H * 0.5);
  c.lineTo(W * 0.6, H * 0.5);
  c.lineTo(W * 1.3, H);
  c.lineTo(-W * 0.3, H);
  c.closePath();
  c.fill();
  c.fillStyle = '#16171d';
  c.fillRect(0, H * 0.5, W * 0.4, H * 0.5);
  c.fillRect(W * 0.6, H * 0.5, W * 0.4, H * 0.5);
  c.fillStyle = 'rgba(0,0,0,0)';
  // lane marks
  for (let i = 0; i < 8; i++) {
    const f0 = i / 8;
    const f1 = f0 + 0.05;
    const y0 = H * (0.5 + f0 * f0 * 0.5);
    const y1 = H * (0.5 + f1 * f1 * 0.5);
    c.fillStyle = 'rgba(240,240,220,0.7)';
    c.beginPath();
    c.moveTo(W * 0.5 - W * 0.003 * (1 + f0 * 6), y0);
    c.lineTo(W * 0.5 + W * 0.003 * (1 + f0 * 6), y0);
    c.lineTo(W * 0.5 + W * 0.003 * (1 + f1 * 6), y1);
    c.lineTo(W * 0.5 - W * 0.003 * (1 + f1 * 6), y1);
    c.fill();
  }
  // store sign
  c.save();
  c.shadowColor = 'rgba(80,220,255,0.9)';
  c.shadowBlur = W * 0.03;
  c.strokeStyle = '#6fe0ff';
  c.lineWidth = Math.max(1.5, W * 0.004);
  c.strokeRect(W * 0.06, H * 0.215, W * 0.28, H * 0.09);
  c.fillStyle = '#bff2ff';
  c.font = `700 ${Math.round(W * 0.045)}px Rajdhani, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('CAFÉ LUMEN', W * 0.2, H * 0.26);
  c.restore();
}

function streetDynamic(c: Ctx, W: number, H: number, t: number) {
  // car approaching
  const b = streetCarBox(t);
  const x = b.x * W;
  const y = b.y * H;
  const w = b.w * W;
  const h = b.h * H;
  c.fillStyle = '#20263a';
  rr(c, x, y + h * 0.3, w, h * 0.6, h * 0.12);
  c.fill();
  c.fillStyle = '#161a28';
  rr(c, x + w * 0.16, y, w * 0.68, h * 0.42, h * 0.12);
  c.fill();
  c.fillStyle = 'rgba(120,170,220,0.35)';
  c.fillRect(x + w * 0.22, y + h * 0.07, w * 0.56, h * 0.26);
  for (const hx of [x + w * 0.12, x + w * 0.88]) {
    const g = c.createRadialGradient(hx, y + h * 0.62, 0, hx, y + h * 0.62, w * 0.28);
    g.addColorStop(0, 'rgba(255,250,230,1)');
    g.addColorStop(0.2, 'rgba(255,240,200,0.6)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(hx, y + h * 0.62, w * 0.28, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = '#07080c';
  c.fillRect(x + w * 0.08, y + h * 0.86, w * 0.16, h * 0.14);
  c.fillRect(x + w * 0.76, y + h * 0.86, w * 0.16, h * 0.14);
  // cone
  const cx = W * 0.76;
  const cy = H * 0.79;
  c.fillStyle = '#ff7a1a';
  c.beginPath();
  c.moveTo(cx, H * 0.67);
  c.lineTo(cx + W * 0.035, cy);
  c.lineTo(cx - W * 0.035, cy);
  c.closePath();
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fillRect(cx - W * 0.018, H * 0.715, W * 0.036, H * 0.012);
  c.fillRect(cx - W * 0.026, H * 0.75, W * 0.052, H * 0.012);
  c.fillStyle = '#ff7a1a';
  c.fillRect(cx - W * 0.042, cy, W * 0.084, H * 0.008);
  // pedestrian
  const px = W * 0.88;
  const py = H * 0.44 + Math.abs(Math.sin(t * 3)) * H * 0.003;
  c.fillStyle = '#0a0c14';
  c.beginPath();
  c.arc(px, py + H * 0.02, W * 0.017, 0, Math.PI * 2);
  c.fill();
  rr(c, px - W * 0.025, py + H * 0.042, W * 0.05, H * 0.12, W * 0.015);
  c.fill();
  c.fillRect(px - W * 0.018, py + H * 0.15, W * 0.014, H * 0.11);
  c.fillRect(px + W * 0.004, py + H * 0.15, W * 0.014, H * 0.11);
}

const STATIC: Record<DemoScene, (c: Ctx, W: number, H: number) => void> = {
  odaiba: odaibaStatic,
  desk: deskStatic,
  menu: menuStatic,
  street: streetStatic,
};

const DYNAMIC: Record<DemoScene, (c: Ctx, W: number, H: number, t: number, st: number) => void> = {
  odaiba: odaibaDynamic,
  desk: deskDynamic,
  menu: () => {},
  street: streetDynamic,
};

/** Render a single still of a demo scene (used for seeded memory thumbnails). */
export function renderDemoStill(scene: DemoScene, w: number, h: number, opts: { t?: number; tint?: string; blend?: GlobalCompositeOperation } = {}): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  STATIC[scene](ctx, w, h);
  DYNAMIC[scene](ctx, w, h, opts.t ?? 3, 3);
  if (opts.tint) {
    ctx.globalCompositeOperation = opts.blend ?? 'multiply';
    ctx.fillStyle = opts.tint;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  return c.toDataURL('image/jpeg', 0.78);
}
