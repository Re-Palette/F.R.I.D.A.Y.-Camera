import { Emitter } from '../../core/events';
import type { LocationEvents, LocationService } from '../contracts';
import { MOCK_GEO } from '../mock/knowledgeBase';

export class MockLocationService implements LocationService {
  readonly mode = 'mock' as const;
  readonly events = new Emitter<LocationEvents>();
  private timers: ReturnType<typeof setInterval>[] = [];

  async start() {
    this.stop();
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      this.events.emit('fix', { ...MOCK_GEO, lat: MOCK_GEO.lat + Math.sin(t / 40) * 0.00004, lon: MOCK_GEO.lon + Math.cos(t / 50) * 0.00004 });
    };
    tick();
    this.timers.push(setInterval(tick, 2000));
    // Facing north-west towards the Rainbow Bridge, with natural hand drift.
    this.timers.push(
      setInterval(() => {
        const t = (performance.now() - t0) / 1000;
        this.events.emit('heading', (318 + Math.sin(t * 0.21) * 9 + Math.sin(t * 0.9) * 1.2 + 360) % 360);
      }, 100),
    );
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }
}

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };

/** Geolocation + compass from the device. */
export class BrowserLocationService implements LocationService {
  readonly mode = 'real' as const;
  readonly events = new Emitter<LocationEvents>();
  private watchId: number | null = null;
  private onOrient = (e: Event) => {
    const ev = e as OrientationEvt;
    let heading: number | null = null;
    if (typeof ev.webkitCompassHeading === 'number') heading = ev.webkitCompassHeading;
    else if (ev.absolute && ev.alpha != null) heading = (360 - ev.alpha) % 360;
    if (heading != null) {
      const so = (screen.orientation?.angle ?? 0) as number;
      this.events.emit('heading', (heading + so + 360) % 360);
    }
  };

  async start() {
    this.stop();
    const DOE = (globalThis as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    try {
      if (DOE?.requestPermission) await DOE.requestPermission();
    } catch {
      /* denied — compass unavailable */
    }
    window.addEventListener('deviceorientationabsolute', this.onOrient, true);
    window.addEventListener('deviceorientation', this.onOrient, true);
    if (!('geolocation' in navigator)) {
      this.events.emit('error', 'Geolocation unsupported');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) =>
        this.events.emit('fix', {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          altitude: p.coords.altitude ?? undefined,
          accuracy: p.coords.accuracy,
          speed: p.coords.speed ?? undefined,
        }),
      (err) => this.events.emit('error', err.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    window.removeEventListener('deviceorientationabsolute', this.onOrient, true);
    window.removeEventListener('deviceorientation', this.onOrient, true);
  }
}
