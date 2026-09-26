/**
 * High-frequency sensor signals, kept OUT of React state.
 *
 * Device-orientation / gyroscope events arrive at 60 Hz+; routing them
 * through the store would re-render the HUD every event. Consumers read
 * `live` from the frame loop instead.
 */

export const live = {
  heading: 0,
  /** Integrated camera rotation since start (deg). +pan = camera turned left, +tilt = turned up. */
  pan: 0,
  tilt: 0,
  motionAvailable: false,
};

interface Sample {
  t: number;
  pan: number;
  tilt: number;
}

const RING = 180;
const ring: Sample[] = [];

export function pushMotion(t: number, pan: number, tilt: number) {
  live.pan = pan;
  live.tilt = tilt;
  ring.push({ t, pan, tilt });
  if (ring.length > RING) ring.shift();
}

/** Camera rotation at time t (linear interpolation over the sample ring). */
export function motionAt(t: number): { pan: number; tilt: number } {
  if (!ring.length) return { pan: 0, tilt: 0 };
  if (t >= ring[ring.length - 1].t) return ring[ring.length - 1];
  for (let i = ring.length - 1; i > 0; i--) {
    const b = ring[i];
    const a = ring[i - 1];
    if (t >= a.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return { pan: a.pan + (b.pan - a.pan) * k, tilt: a.tilt + (b.tilt - a.tilt) * k };
    }
  }
  return ring[0];
}

/** Reset the integration (testing / feed switch). */
export function resetMotion() {
  ring.length = 0;
  live.pan = 0;
  live.tilt = 0;
}

let started = false;
let lastT = 0;

/**
 * Gyroscope integration (DeviceMotionEvent.rotationRate, deg/s).
 * Portrait: rotation about the device Y axis (gamma) pans, about X (beta) tilts.
 * Screen rotation is compensated so landscape works too.
 */
export async function startMotion(): Promise<boolean> {
  if (started || typeof window === 'undefined' || !('DeviceMotionEvent' in window)) return live.motionAvailable;
  started = true;
  const DME = window.DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  try {
    if (DME.requestPermission && (await DME.requestPermission()) !== 'granted') return false;
  } catch {
    return false;
  }
  let pan = 0;
  let tilt = 0;
  window.addEventListener('devicemotion', (e) => {
    const r = e.rotationRate;
    if (!r || r.beta == null || r.gamma == null) return;
    const t = performance.now();
    const dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
    lastT = t;
    live.motionAvailable = true;
    const angle = ((screen.orientation?.angle ?? 0) * Math.PI) / 180;
    // Rotate the device-frame rates into screen space.
    const panRate = r.gamma * Math.cos(angle) - r.beta * Math.sin(angle);
    const tiltRate = r.beta * Math.cos(angle) + r.gamma * Math.sin(angle);
    pan += panRate * dt;
    tilt += tiltRate * dt;
    pushMotion(t, pan, tilt);
  });
  return true;
}
