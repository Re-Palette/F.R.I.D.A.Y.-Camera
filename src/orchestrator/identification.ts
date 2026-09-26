/**
 * Tier-2 identification scheduler.
 *
 * Detection (tier 1) runs on every sampled frame; identification (tier 2 —
 * "車 → Tesla Model 3") is expensive, so it runs:
 *   - once per *stable* track (seen ≥ 500 ms), cached by tracking id,
 *   - locked target first, then the primary target, then by salience,
 *   - with a small in-flight budget (provider-defined),
 *   - on a GPU crop of just the target — never the full frame per tick.
 * Identities survive tracker id changes via re-association.
 */
import type { Detection, Identification, PlaceInfo, SceneAnalysis } from '../core/types';
import type { VisionContext, VisionProvider } from '../services/contracts';
import { kindFor, pickToIdentify, reassociate, sanitize, targetChanged, type TrackMeta } from '../services/vision/perception';

export interface IdentificationDeps {
  vision: () => VisionProvider;
  crop: (d: Detection) => Promise<ImageBitmap | null>;
  ctx: () => VisionContext;
  scene: () => SceneAnalysis | null;
  nearby: () => PlaceInfo[];
}

const LOST_AFTER_MS = 450;
const FORGET_AFTER_MS = 3000;
const STABLE_MS = 500;
const RETRY_UNKNOWN_MS = 12000;

export class IdentificationManager {
  private meta = new Map<string, TrackMeta>();
  private lost: { id: string; meta: TrackMeta; lostAt: number }[] = [];
  private inflight = 0;

  constructor(private readonly deps: IdentificationDeps) {}

  /** Annotates detections with cached / in-flight identities and schedules new work. */
  process(dets: Detection[], now: number, lockedId: string | null, primaryId: string | null): Detection[] {
    const seen = new Set<string>();
    for (const d of dets) {
      seen.add(d.id);
      let m = this.meta.get(d.id);
      if (!m) {
        const inherited = reassociate(d, this.lost, now);
        m = { firstSeen: inherited ? inherited.firstSeen : now, lastSeen: now, bbox: d.bbox, category: d.category, identity: inherited?.identity };
        this.meta.set(d.id, m);
      }
      m.lastSeen = now;
      m.bbox = d.bbox;
      if (m.category !== d.category) {
        m.category = d.category;
        m.stale = !!m.identity;
      } else if (m.identity && !m.requested && m.identifiedBox && now - m.identity.at > 3000 && targetChanged(m.identifiedBox, d.bbox)) {
        m.stale = true; // closer / different view → new detail may be visible
      }
    }
    for (const [id, m] of this.meta) {
      if (seen.has(id) || now - m.lastSeen < LOST_AFTER_MS) continue;
      this.meta.delete(id);
      if (m.identity && m.identity.status !== 'identifying') this.lost.push({ id, meta: m, lostAt: now });
    }
    this.lost = this.lost.filter((l) => now - l.lostAt < FORGET_AFTER_MS);

    const out = dets.map((d) => this.annotate(d, now));
    const vision = this.deps.vision();
    for (const d of pickToIdentify(out, this.meta, { now, inflight: this.inflight, maxInflight: vision.capabilities.maxInflightIdentify, stableMs: STABLE_MS, lockedId, primaryId })) {
      void this.run(d, vision);
    }
    return out;
  }

  private annotate(d: Detection, now: number): Detection {
    if (d.category === 'person') return sanitize(d);
    if (d.identity) return d; // geo anchors / cloud regions carry their own
    const m = this.meta.get(d.id);
    if (!m) return d;
    if (m.identity && m.requested && m.stale) {
      // Re-analysing a changed target: keep showing the previous result (no flicker).
      return { ...d, identity: { ...m.identity, stage: m.stage } };
    }
    if (m.identity) {
      // Let a failed / unknown result be retried later (lighting, angle may improve).
      if (m.identity.status === 'unknown' && now - m.identity.at > RETRY_UNKNOWN_MS) {
        m.identity = undefined;
        m.requested = undefined;
        return d;
      }
      return { ...d, identity: m.identity };
    }
    if (m.requested) return { ...d, identity: { status: 'identifying', kind: kindFor(d.category), name: '', confidence: d.confidence, stage: m.stage, source: d.source ?? 'local', at: m.requested } };
    return d;
  }

  private async run(d: Detection, vision: VisionProvider) {
    const m = this.meta.get(d.id);
    if (!m) return;
    m.requested = performance.now();
    m.stage = 'reading';
    this.inflight++;
    try {
      // Every provider gets the crop now: OCR, colour and appearance all need pixels.
      const crop = await this.deps.crop(d);
      const identity = await vision.identify({
        detection: d,
        crop,
        ctx: this.deps.ctx(),
        scene: this.deps.scene(),
        nearby: this.deps.nearby(),
        onStage: (st) => (m.stage = st),
      });
      m.identity = identity;
      m.identifiedBox = { ...m.bbox };
      m.stale = false;
      m.requested = undefined;
      m.stage = undefined;
    } catch {
      if (!m.identity) m.identity = { status: 'unknown', kind: kindFor(d.category), name: '', confidence: 0, detail: '識別に失敗しました', source: 'local', at: performance.now() };
      m.stale = false;
      m.requested = undefined;
      m.stage = undefined;
    } finally {
      this.inflight--;
    }
  }

  /**
   * The user locked this target to see details: fetch official facts for it
   * (web verification) if it's identified but not yet verified.
   */
  async verify(id: string, det: Detection): Promise<void> {
    const vision = this.deps.vision();
    const m = this.meta.get(id);
    if (!m?.identity || m.requested || m.identity.verification || !vision.verifyIdentity) return;
    if (m.identity.status !== 'identified' && m.identity.status !== 'possible') return;
    m.requested = performance.now();
    m.stale = true; // keep showing the current result while verifying
    m.stage = 'verifying';
    try {
      m.identity = await vision.verifyIdentity({ detection: det, crop: null, ctx: this.deps.ctx(), forceVerify: true, onStage: (st) => (m.stage = st) }, m.identity);
    } catch {
      /* keep the unverified identity */
    } finally {
      m.requested = undefined;
      m.stale = false;
      m.stage = undefined;
    }
  }

  /** Force a fresh identification (user asked, or target re-locked). */
  retry(id: string) {
    const m = this.meta.get(id);
    if (!m || m.identity?.status === 'identified') return;
    m.identity = undefined;
    m.requested = undefined;
    m.firstSeen = 0; // eligible immediately
  }

  identityOf(id: string): Identification | undefined {
    return this.meta.get(id)?.identity;
  }

  get busy(): number {
    return this.inflight;
  }

  reset() {
    this.meta.clear();
    this.lost = [];
  }
}
