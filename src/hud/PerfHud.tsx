import { useEffect, useRef } from 'react';
import { live } from '../core/live';
import { perf } from '../perf/metrics';
import { useFriday } from '../store/useFriday';

type Row = [label: string, value: () => string, warn?: () => boolean];

const f1 = (v: number) => v.toFixed(1);
const ROWS: Row[] = [
  ['FPS', () => `${f1(perf.fps)} / ${Math.round(perf.refreshHz)}Hz`, () => perf.fps < perf.refreshHz * 0.9],
  ['FRAME', () => `${f1(perf.frameMs)}ms  p95 ${f1(perf.frameP95)}`, () => perf.frameP95 > 1000 / perf.refreshHz + 4],
  ['DROPPED', () => `${perf.droppedFrames}  long ${perf.longTasks}`],
  ['CAM FPS', () => (perf.camFps ? f1(perf.camFps) : '—'), () => perf.camFps > 0 && perf.camFps < 50],
  ['CAM RES', () => perf.camRes || '—'],
  ['CAM LAT', () => (perf.camLatencyMs != null ? `${f1(perf.camLatencyMs)}ms` : 'n/a')],
  ['CAM DROP', () => String(perf.camDropped)],
  ['AI', () => `${perf.aiEngine || '—'}`],
  ['AI FPS', () => `${f1(perf.aiFps)} → ${perf.aiTargetFps}`],
  ['AI INFER', () => `${f1(perf.aiInferMs)}ms`],
  ['AI LAT', () => `${f1(perf.aiLatencyMs)}ms`, () => perf.aiLatencyMs > 250],
  ['AI SKIP', () => String(perf.aiSkipped)],
  ['MEMORY', () => (perf.memMB != null ? `${f1(perf.memMB)}MB` : 'n/a')],
  ['GPU/CPU', () => 'n/a (web)'],
  ['QUALITY', () => `${perf.quality}${perf.qualityPref === 'auto' ? ' (auto)' : ''}`],
  ['GYRO', () => (live.motionAvailable ? 'motion comp ON' : perf.motionComp ? 'waiting for sensor' : 'unavailable')],
];

/** Developer overlay. Values are written to the DOM 4×/s — never through React. */
export function PerfHud() {
  const on = useFriday((s) => s.perfHud);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      ROWS.forEach(([, value, warn], i) => {
        const el = refs.current[i];
        if (!el) return;
        const v = value();
        if (el.textContent !== v) el.textContent = v;
        el.dataset.warn = warn?.() ? '1' : '0';
      });
    }, 250);
    return () => clearInterval(id);
  }, [on]);
  if (!on) return null;
  return (
    <div className="perf-hud" aria-label="Performance">
      <div className="perf-title">PERFORMANCE</div>
      {ROWS.map(([label], i) => (
        <div key={label} className="perf-row">
          <span>{label}</span>
          <span ref={(el) => void (refs.current[i] = el)}>—</span>
        </div>
      ))}
    </div>
  );
}
