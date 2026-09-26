import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 18, p: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...p,
});

export const Icon = {
  Sun: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="4.2" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <line key={a} x1="12" y1="2.6" x2="12" y2="5" transform={`rotate(${a} 12 12)`} />
      ))}
    </svg>
  ),
  Cloud: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.5 4.3 4.3 0 0 0 7 18z" />
    </svg>
  ),
  PartlyCloudy: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 2.8v1.4M3.8 9H2.4M5 5l-1-1M13 5l1-1" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.2 1.3A2.9 2.9 0 0 0 9 19z" />
    </svg>
  ),
  Rain: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M7 15h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 6.5 4.3 4.3 0 0 0 7 15z" />
      <path d="M9 18l-1 2.5M13 18l-1 2.5M17 18l-1 2.5" />
    </svg>
  ),
  Drop: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5z" />
    </svg>
  ),
  Wind: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7" />
    </svg>
  ),
  Leaf: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15" />
      <path d="M5 19l7-7" />
    </svg>
  ),
  Sunset: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M7 16a5 5 0 0 1 10 0M3 16h18M5 20h14M12 3v5M9.5 5.5 12 8l2.5-2.5" />
    </svg>
  ),
  Uv: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="8" strokeDasharray="2 2.6" />
      <text x="12" y="15.2" textAnchor="middle" fontSize="7.5" fill="currentColor" stroke="none" fontFamily="Rajdhani">UV</text>
    </svg>
  ),
  Mic: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
    </svg>
  ),
  Flip: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M4 8h3l1.5-2h7L17 8h3v10H4z" />
      <path d="M9.5 12.5a2.8 2.8 0 0 1 4.8-1.6M14.5 13.5a2.8 2.8 0 0 1-4.8 1.6M14.6 9.8v1.4h-1.4M9.4 16.2v-1.4h1.4" />
    </svg>
  ),
  Bolt: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M13 2 5 13.5h6L10 22l8-11.5h-6z" />
    </svg>
  ),
  Timer: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4l2.5 2M10 2.5h4" />
    </svg>
  ),
  Moon: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" />
    </svg>
  ),
  Stabilize: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="6" y="7" width="12" height="10" rx="1.5" />
      <path d="M3 9v6M21 9v6" />
    </svg>
  ),
  Grid: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="4" y="4" width="6" height="6" />
      <rect x="14" y="4" width="6" height="6" />
      <rect x="4" y="14" width="6" height="6" />
      <rect x="14" y="14" width="6" height="6" />
    </svg>
  ),
  Close: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  Search: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </svg>
  ),
  Memory: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="3.5" y="5" width="17" height="14" rx="1" />
      <path d="M3.5 15l5-4.5 4 3.5 3-2.5 5 4" />
      <circle cx="15.5" cy="9" r="1.5" />
    </svg>
  ),
  Lock: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="5" y="11" width="14" height="9" rx="1" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  Nav: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3 19 20l-7-4-7 4z" />
    </svg>
  ),
  Keyboard: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10" />
    </svg>
  ),
  Share: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 13v7h14v-7" />
    </svg>
  ),
  Trash: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13" />
    </svg>
  ),
  Sparkle: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
    </svg>
  ),
  External: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
    </svg>
  ),
  Speaker: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  ),
  Check: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  Warn: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 10v4.5M12 17.2v.3" />
    </svg>
  ),
  Target: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  ),
  Wave: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 10.5v3M21 12h.5" />
    </svg>
  ),
  Walk: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="M10 21l2-6 3 3v3M9 12l2-4.5 3.5 1.5 2 3M11 7.5 8 10l-1 3" />
    </svg>
  ),
  Bike: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16l4-7h5l3 7M10 9 8.5 6H7M14 6h2" />
    </svg>
  ),
  Car: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <path d="M4 16v-4l2-5h12l2 5v4zM4 16v2.5M20 16v2.5" />
      <circle cx="7.5" cy="13.5" r=".8" />
      <circle cx="16.5" cy="13.5" r=".8" />
    </svg>
  ),
  Info: ({ size, ...p }: P) => (
    <svg {...base(size, p)}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.2" />
    </svg>
  ),
};

export function WeatherIcon({ code, size }: { code: string; size?: number }) {
  if (code === 'clear') return <Icon.Sun size={size} />;
  if (code === 'partly') return <Icon.PartlyCloudy size={size} />;
  if (code === 'rain' || code === 'storm') return <Icon.Rain size={size} />;
  return <Icon.Cloud size={size} />;
}
