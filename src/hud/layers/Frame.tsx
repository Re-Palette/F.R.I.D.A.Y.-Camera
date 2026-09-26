import { useFriday } from '../../store/useFriday';

/** Screen-edge HUD frame: orange corner brackets, top/bottom notches, edge ticks. */
export function Frame() {
  const { w, h } = useFriday((s) => s.viewSize);
  if (!w || !h) return null;
  const i = 7;
  const L = Math.min(64, w * 0.14);
  const cx = w / 2;
  const ticks = [];
  for (let y = h * 0.3; y < h * 0.7; y += 14) {
    const long = Math.round((y - h * 0.3) / 14) % 5 === 0;
    ticks.push(<line key={`l${y}`} className="f" x1={i + 2} y1={y} x2={i + (long ? 12 : 7)} y2={y} />);
    ticks.push(<line key={`r${y}`} className="f" x1={w - i - 2} y1={y} x2={w - i - (long ? 12 : 7)} y2={y} />);
  }
  return (
    <svg className="layer frame" width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none">
      <g strokeWidth={1.6}>
        <polyline className="o" points={`${i},${i + L} ${i},${i} ${i + L},${i}`} />
        <polyline className="o" points={`${w - i - L},${i} ${w - i},${i} ${w - i},${i + L}`} />
        <polyline className="o" points={`${i},${h - i - L} ${i},${h - i} ${i + L},${h - i}`} />
        <polyline className="o" points={`${w - i - L},${h - i} ${w - i},${h - i} ${w - i},${h - i - L}`} />
      </g>
      <g strokeWidth={1}>
        <polyline className="c" points={`${i + 5},${i + L + 26} ${i + 5},${i + L + 8}`} />
        <polyline className="c" points={`${w - i - 5},${h - i - L - 26} ${w - i - 5},${h - i - L - 8}`} />
        <line className="c" x1={i + L + 10} y1={i} x2={i + L + 60} y2={i} strokeDasharray="2 4" />
        <line className="c" x1={w - i - L - 60} y1={h - i} x2={w - i - L - 10} y2={h - i} strokeDasharray="2 4" />
      </g>
      {/* top notch */}
      <g strokeWidth={1.8}>
        <line className="o" x1={cx - 118} y1={0} x2={cx - 100} y2={12} />
        <line className="o" x1={cx - 104} y1={0} x2={cx - 86} y2={12} />
        <line className="o" x1={cx + 118} y1={0} x2={cx + 100} y2={12} />
        <line className="o" x1={cx + 104} y1={0} x2={cx + 86} y2={12} />
        <line className="f" x1={cx - 80} y1={12} x2={cx + 80} y2={12} strokeDasharray="3 5" />
      </g>
      {/* bottom notch */}
      <g strokeWidth={1.6}>
        <line className="o" x1={cx - 70} y1={h - 3} x2={cx - 26} y2={h - 3} />
        <line className="o" x1={cx + 26} y1={h - 3} x2={cx + 70} y2={h - 3} />
        <line className="f" x1={cx - 20} y1={h - 3} x2={cx + 20} y2={h - 3} strokeDasharray="2 3" />
      </g>
      <g strokeWidth={1}>{ticks}</g>
    </svg>
  );
}
