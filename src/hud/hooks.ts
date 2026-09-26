import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Orchestrator } from '../orchestrator/Orchestrator';

export const OrchestratorContext = createContext<Orchestrator | null>(null);

export function useOrch(): Orchestrator {
  const o = useContext(OrchestratorContext);
  if (!o) throw new Error('Orchestrator missing');
  return o;
}

export type Presence = 'enter' | 'shown' | 'exit' | null;

/**
 * Mount/unmount with enter & exit phases so HUD panels can animate out
 * instead of popping — the core of "information appears only when needed".
 */
export function usePresence(visible: boolean, exitMs = 420): Presence {
  const [phase, setPhase] = useState<Presence>(visible ? 'enter' : null);
  useEffect(() => {
    if (visible) {
      setPhase((p) => (p === 'shown' ? 'shown' : 'enter'));
      const t = setTimeout(() => setPhase('shown'), 40);
      return () => clearTimeout(t);
    }
    setPhase((p) => (p ? 'exit' : null));
    const t = setTimeout(() => setPhase(null), exitMs);
    return () => clearTimeout(t);
  }, [visible, exitMs]);
  return phase;
}

/** Keeps the last non-null value while a panel animates out. */
export function useSticky<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(value ?? null);
  if (value != null) ref.current = value;
  return ref.current;
}

/** Animated number (count-up / data update). */
export function useCountUp(target: number, ms = 700): number {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const cur = a + (target - a) * e;
      setV(cur);
      from.current = cur;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Typewriter reveal for newly analysed text. */
export function useTypewriter(text: string, cps = 38): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const id = setInterval(() => setN((x) => (x >= text.length ? (clearInterval(id), x) : x + 1)), 1000 / cps);
    return () => clearInterval(id);
  }, [text, cps]);
  return text.slice(0, n);
}

/** Re-render on an interval (clocks, timers). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Timed visibility: true while `until` is in the future. */
export function useUntil(until: number | undefined): boolean {
  const now = useNow(500);
  return !!until && until > now;
}
