import { useMemo, useRef } from 'react';
import type { FlightFeed } from '../lib/flightFeed';
import type { BandState } from '../lib/flightModel';
import { formatCap } from '../lib/flightModel';
import { useAttitude } from '../lib/useAttitude';
import { CARGO_HOLD } from '../content/cabin';

/**
 * The cargo hold.
 *
 * Below the cabin floor, unpressurized, and by a wide margin the biggest room
 * on the aircraft — which is the point. Everyone below the seat cutoff rides
 * down here, so it is drawn as somewhere with its own character rather than a
 * punishment: ribs, netting, a caged work light, and everybody's bags.
 *
 * There is no window, so the altitude band shows the only way it can from
 * inside a freight hold — as frost. The higher the flight, the colder the skin,
 * until at the moon the ribs are white with it.
 */

const W = 1200;
const H = 800;
const AMBER = '#FFB300';
const CYAN = '#3FD8E8';
const MONO = "'JetBrains Mono', monospace";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How cold it is in here, 0–1, by how far from the ground the flight is. */
const frostFor = (band: BandState) =>
  band.band === 'moon' ? 1 : band.band === 'space' ? 0.72 : band.band === 'above-clouds' ? 0.38 : 0.12;

interface CargoHoldProps {
  feed: FlightFeed;
  band: BandState;
  /** How many seats are sold, so the hold can say how many rode down here. */
  belowCutoff: number;
}

const CargoHold = ({ feed, band, belowCutoff }: CargoHoldProps) => {
  const swayRef = useRef<SVGGElement>(null);
  const capRead = useRef<SVGTextElement>(null);

  const frost = frostFor(band);

  /** Loose baggage, stacked against the netting. Stable between renders. */
  const bags = useMemo(() => {
    const rand = seeded(0xba65);
    const palette = ['#5A4636', '#3E4A63', '#6B3B3B', '#3B5545', '#4A4458', '#6E5A3A'];
    return Array.from({ length: 26 }, () => {
      const w = 54 + rand() * 82;
      return {
        x: 120 + rand() * 900,
        y: 560 + rand() * 130,
        w,
        h: w * (0.52 + rand() * 0.3),
        tone: palette[Math.floor(rand() * palette.length)],
        tilt: (rand() - 0.5) * 14,
        handle: rand() > 0.4,
      };
    }).sort((a, b) => a.y - b.y);
  }, []);

  useAttitude(feed, (a, tick) => {
    // Unpressurized and unsprung: the hold feels the aircraft more than the
    // cabin does, so the whole room leans with the attitude.
    swayRef.current?.setAttribute(
      'transform',
      `rotate(${(a.bank * 0.5).toFixed(2)} 600 400) translate(0 ${(a.pitch * 1.6).toFixed(2)})`,
    );
    if (tick && capRead.current) capRead.current.textContent = formatCap(tick.marketCap);
  });

  return (
    <div
      className="sd-view sd-frame relative w-full"
      role="img"
      aria-label={`The cargo hold: unpressurized, below the cabin floor, and the biggest room on the aircraft. ${belowCutoff} passengers are riding below the seat cutoff.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="ch-skin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#171A21" />
            <stop offset="46%" stopColor="#272C36" />
            <stop offset="100%" stopColor="#0C0E13" />
          </linearGradient>
          <linearGradient id="ch-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2A2E37" />
            <stop offset="100%" stopColor="#090B10" />
          </linearGradient>
          <linearGradient id="ch-uld" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#6C7484" />
            <stop offset="55%" stopColor="#464D5B" />
            <stop offset="100%" stopColor="#22262F" />
          </linearGradient>
          <radialGradient id="ch-lamp" cx="0.5" cy="0" r="1">
            <stop offset="0%" stopColor="#FFD79A" stopOpacity="0.5" />
            <stop offset="45%" stopColor="#FFCE7A" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#FFCE7A" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="ch-hatch" cx="0.5" cy="0" r="1">
            <stop offset="0%" stopColor="#CFE3FF" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#CFE3FF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x="0" y="0" width={W} height={H} fill="url(#ch-skin)" />

        <g ref={swayRef}>
          {/* ── Ribs, running away down the hold ── */}
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const t = i / 5;
            const inset = 40 + t * 300;
            const top = 60 + t * 150;
            const bot = 700 - t * 150;
            return (
              <g key={i} opacity={1 - t * 0.45}>
                <path
                  d={`M${inset} ${bot} L${inset} ${top + 90} Q ${inset} ${top} ${inset + 130 - t * 60} ${top}
                      L${W - inset - 130 + t * 60} ${top} Q ${W - inset} ${top} ${W - inset} ${top + 90}
                      L${W - inset} ${bot}`}
                  fill="none"
                  stroke="#3C4351"
                  strokeWidth={14 - t * 7}
                />
                <path
                  d={`M${inset} ${bot} L${inset} ${top + 90} Q ${inset} ${top} ${inset + 130 - t * 60} ${top}
                      L${W - inset - 130 + t * 60} ${top} Q ${W - inset} ${top} ${W - inset} ${top + 90}
                      L${W - inset} ${bot}`}
                  fill="none"
                  stroke="#DCE6F5"
                  strokeWidth={3 - t * 1.4}
                  opacity={frost * 0.72 * (1 - t * 0.5)}
                />
              </g>
            );
          })}

          {/* Floor, with the roller track every hold has */}
          <path d={`M0 ${H} L0 700 L340 550 L860 550 L${W} 700 L${W} ${H} Z`} fill="url(#ch-floor)" />
          <g stroke="#4A5261" strokeWidth="3" opacity="0.65">
            {[0.24, 0.5, 0.76].map((f) => (
              <path key={f} d={`M${140 + f * 900} ${H} L${380 + f * 440} 552`} fill="none" />
            ))}
          </g>

          {/* Light from the cabin hatch above — the only daylight down here */}
          <ellipse cx="600" cy="150" rx="230" ry="120" fill="url(#ch-hatch)" />
          <rect x="516" y="60" width="168" height="16" rx="4" fill="#5A6270" opacity="0.7" />

          {/* ── Freight containers ── */}
          {[
            { x: 96, y: 300, w: 250, h: 250, label: 'AKE 40218 SA' },
            { x: 860, y: 316, w: 236, h: 234, label: 'AKE 40219 SA' },
          ].map((u) => (
            <g key={u.label}>
              <path d={`M${u.x} ${u.y + u.h} L${u.x} ${u.y + 40} L${u.x + 46} ${u.y} L${u.x + u.w} ${u.y} L${u.x + u.w} ${u.y + u.h} Z`} fill="url(#ch-uld)" />
              <path d={`M${u.x} ${u.y + 40} L${u.x + 46} ${u.y} L${u.x + u.w} ${u.y}`} fill="none" stroke="#8A93A6" strokeWidth="2" opacity="0.6" />
              <g stroke="#2A2F39" strokeWidth="2" opacity="0.7">
                {[0.3, 0.5, 0.7].map((f) => (
                  <line key={f} x1={u.x + 8} y1={u.y + u.h * f} x2={u.x + u.w - 8} y2={u.y + u.h * f} />
                ))}
              </g>
              <text x={u.x + 16} y={u.y + u.h - 20} fontSize="15" fill="#C6CEDC" opacity="0.8" fontFamily={MONO}>
                {u.label}
              </text>
              {/* Frost creeping up the container in the cold */}
              <rect x={u.x} y={u.y + u.h - 70} width={u.w} height="70" fill="#DCE6F5" opacity={frost * 0.16} />
            </g>
          ))}

          {/* ── Everybody's bags ── */}
          {bags.map((b, i) => (
            <g key={i} transform={`rotate(${b.tilt} ${b.x + b.w / 2} ${b.y + b.h / 2})`}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="9" fill={b.tone} />
              <rect x={b.x} y={b.y} width={b.w} height={b.h * 0.3} rx="9" fill="#FFFFFF" opacity="0.07" />
              <rect x={b.x + 6} y={b.y + b.h * 0.44} width={b.w - 12} height="5" fill="#000000" opacity="0.28" />
              {b.handle && (
                <rect x={b.x + b.w * 0.34} y={b.y - 9} width={b.w * 0.32} height="10" rx="5" fill="#22262F" />
              )}
              {/* The tag every one of them is wearing */}
              <rect x={b.x + b.w - 20} y={b.y + 8} width="14" height="19" rx="2" fill="#E8EDF5" opacity="0.75" />
            </g>
          ))}

          {/* Cargo net, over the pile it is actually holding down */}
          <clipPath id="ch-net">
            <rect x="96" y="548" width="1010" height="252" />
          </clipPath>
          <g clipPath="url(#ch-net)" stroke="#8A93A6" strokeWidth="1.4" opacity="0.3" fill="none">
            {Array.from({ length: 22 }, (_, i) => (
              <path key={`a${i}`} d={`M${60 + i * 56} 540 L${118 + i * 56} 810`} />
            ))}
            {Array.from({ length: 22 }, (_, i) => (
              <path key={`b${i}`} d={`M${1140 - i * 56} 540 L${1082 - i * 56} 810`} />
            ))}
          </g>
          {/* Tie-down straps, cinched */}
          <g stroke={AMBER} strokeWidth="7" opacity="0.55" fill="none">
            <path d="M60 630 C 400 596 800 596 1140 630" />
            <path d="M60 726 C 400 692 800 692 1140 726" />
          </g>
        </g>

        {/* ── The caged work light ── */}
        <ellipse cx="272" cy="330" rx="270" ry="330" fill="url(#ch-lamp)" />
        <g>
          <line x1="272" y1="60" x2="272" y2="148" stroke="#4A5261" strokeWidth="3" />
          <circle cx="272" cy="168" r="24" fill="#FFE7BC" />
          <circle cx="272" cy="168" r="24" fill="none" stroke="#5A6270" strokeWidth="3" />
          <path d="M248 168 h48 M272 144 v48 M255 151 l34 34 M289 151 l-34 34" stroke="#3C4351" strokeWidth="2.4" />
        </g>

        {/* ── Stencilled on the bulkhead ── */}
        <g>
          <rect x="40" y="72" width="620" height="88" fill="#05070C" opacity="0.62" />
          <text x="60" y="112" fontSize="26" fill="#E8EDF5" opacity="0.92" letterSpacing="4" fontFamily={MONO}>
            CARGO HOLD
          </text>
          <text x="60" y="140" fontSize="13" fill="#B7C0D0" opacity="0.85" letterSpacing="2" fontFamily={MONO}>
            UNPRESSURIZED · NO SMOKING · {belowCutoff.toLocaleString('en-US')} BELOW THE CUTOFF
          </text>
          <text x={W - 60} y="112" fontSize="12" textAnchor="end" fill={CYAN} opacity="0.7" letterSpacing="2" fontFamily={MONO}>
            {band.label.toUpperCase()}
          </text>
          <text ref={capRead} x={W - 60} y="142" fontSize="22" textAnchor="end" fill="#E8EDF5" fontWeight="700" fontFamily={MONO} />
          {frost > 0.5 && (
            <text x={W - 60} y="168" fontSize="12" textAnchor="end" fill="#BFD8F0" opacity="0.8" letterSpacing="1.6" fontFamily={MONO}>
              SKIN TEMPERATURE CRITICAL
            </text>
          )}
        </g>
      </svg>

      <div aria-hidden className="sa-scanlines pointer-events-none absolute inset-0 opacity-[0.09]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(120% 100% at 26% 30%, transparent 34%, rgba(3,5,10,0.88) 100%)' }}
      />
      <p className="sr-only">{CARGO_HOLD.body}</p>
    </div>
  );
};

export default CargoHold;
