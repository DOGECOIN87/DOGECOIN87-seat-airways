import { useMemo, useRef } from 'react';
import OutsideWorld from './OutsideWorld';
import type { FlightFeed } from '../lib/flightFeed';
import type { BandState } from '../lib/flightModel';
import type { SkyState } from '../lib/sky';
import { useAttitude } from '../lib/useAttitude';
import { lookFrom, type CabinSeat, type CabinZone } from '../content/cabin';

/**
 * The view with your head turned.
 *
 * Looking across the aircraft rather than down it, so what you see is decided
 * entirely by where you are sitting. From 8A the window is one turn to the
 * left and fills the frame; from 8F that same window is the far side of the
 * cabin — two seats, the aisle, three more seats, and a porthole the size of
 * a coin. `lookFrom` works that out; this draws it.
 *
 * The cabin recedes concentrically because a row seen side-on really does
 * nest away from you: each seat is the same size, just further off.
 */

const W = 1200;
const H = 800;
const CX = 600;
/** Eye level. Everything converges here. */
const EY = 344;

const CYAN = '#3FD8E8';
const AMBER = '#FFB300';
const MONO = "'JetBrains Mono', monospace";

const HAIR = ['#2B2118', '#4A3524', '#0F0C0A', '#6B5238', '#8A7A6A', '#3A2418', '#B9A184'];
const SKIN = ['#C99A72', '#8D5F3F', '#E3B894', '#6B4529', '#A8724C', '#D9A87E', '#5A3A22'];

/**
 * How big the nth thing along the sight line draws.
 *
 * The first item is at arm's length — from 8A the window is right there and
 * should fill the frame, not sit politely in a wall. Each step further across
 * the cabin falls away fast, so by the time you are looking from 8F at the
 * port window it is a coin on the far side of the aircraft.
 */
const scaleOf = (i: number) => 1 / (1 + i * 0.62);

/* Seats always top out just below eye level, whatever their distance, so you
   are always looking over the shoulder of whoever is beside you. */
const floorY = (s: number) => EY + 470 * s;
const ceilY = (s: number) => EY - 330 * s;
const SEAT_H = 420;

/**
 * The sight line recedes on a slight diagonal rather than straight down the
 * middle of the frame.
 *
 * Strictly, turning your head 90° puts the row dead ahead — but drawn that
 * way everything stacks concentrically and the person beside you blots out
 * the window completely. Angling the camera a few degrees is the same cheat
 * every cabin photograph uses: you see past the shoulder in front of you, and
 * the row reads as having depth. Mirrored by which way you turned, so looking
 * left and looking right are not the same picture.
 */
const NEAR_OFFSET = 190;
const VANISH_OFFSET = 120;
const xOf = (s: number, facing: 'left' | 'right') => {
  const dir = facing === 'left' ? 1 : -1;
  const near = CX - NEAR_OFFSET * dir;
  const vanish = CX + VANISH_OFFSET * dir;
  return near + (vanish - near) * (1 - s);
};

interface CabinSideViewProps {
  feed: FlightFeed;
  sky: SkyState;
  band: BandState;
  seat: CabinSeat;
  zone: CabinZone;
  facing: 'left' | 'right';
  taken: ReadonlySet<string>;
}

const CabinSideView = ({ feed, sky, band, seat, zone, facing, taken }: CabinSideViewProps) => {
  const world = useRef<SVGGElement>(null);
  const altRead = useRef<SVGTextElement>(null);

  const chain = useMemo(() => lookFrom(seat, facing), [seat, facing]);
  const endIndex = chain.length - 1;
  const endScale = scaleOf(endIndex);
  /* The window at the end of the sight line, sized by how far away it is. */
  const win = {
    cx: xOf(endScale, facing),
    cy: EY,
    rx: 250 * endScale,
    ry: 310 * endScale,
  };
  const hasWindow = chain[endIndex]?.kind === 'window';

  useAttitude(feed, (a) => {
    world.current?.setAttribute(
      'transform',
      `rotate(${(a.bank * 0.4).toFixed(2)} 0 ${win.cy}) translate(0 ${(a.pitch * 5).toFixed(2)})`,
    );
    if (altRead.current) altRead.current.textContent = `${Math.round(a.alt).toLocaleString('en-US')} FT`;
  });

  const premium = zone.key === 'first' || zone.key === 'business';

  return (
    <div
      className="sd-view sd-frame relative w-full"
      
      role="img"
      aria-label={`Looking ${facing} from seat ${seat.id}: ${chain
        .map((i) => (i.kind === 'seat' ? `seat ${i.id}` : i.kind))
        .join(', then ')}.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="sv-wall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22201C" />
            <stop offset="45%" stopColor="#4E4A41" />
            <stop offset="100%" stopColor="#2A2823" />
          </linearGradient>
          <linearGradient id="sv-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#33302A" />
            <stop offset="100%" stopColor="#0C0D10" />
          </linearGradient>
          <linearGradient id="sv-seat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={premium ? '#3E4A63' : '#38414F'} />
            <stop offset="55%" stopColor={premium ? '#2C3549' : '#2A303B'} />
            <stop offset="100%" stopColor="#14171C" />
          </linearGradient>
          <radialGradient id="sv-lamp" cx="0.5" cy="0" r="1">
            <stop offset="0%" stopColor="#FFCE7A" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#FFCE7A" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="sv-daylight" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={sky.palette.horizon} stopOpacity="0.34" />
            <stop offset="100%" stopColor={sky.palette.horizon} stopOpacity="0" />
          </radialGradient>
          <clipPath id="sv-pane">
            <rect x={win.cx - win.rx} y={win.cy - win.ry} width={win.rx * 2} height={win.ry * 2} rx={win.rx * 0.6} />
          </clipPath>
        </defs>

        {/* ══ THE CABIN, RECEDING ACROSS THE AIRCRAFT ═════════════════ */}
        <rect x="0" y="0" width={W} height={H} fill="url(#sv-wall)" />
        {/* Ceiling and floor converging on the far side */}
        <path d={`M0 0 H${W} V${ceilY(endScale) - 30} L${win.cx + 780 * endScale + 90} ${ceilY(endScale)} L${win.cx - 780 * endScale - 90} ${ceilY(endScale)} L0 ${ceilY(endScale) - 30} Z`} fill="#2C2921" />
        <path d={`M0 ${H} H${W} V${floorY(endScale) + 30} L${win.cx + 780 * endScale + 90} ${floorY(endScale)} L${win.cx - 780 * endScale - 90} ${floorY(endScale)} L0 ${floorY(endScale) + 30} Z`} fill="url(#sv-floor)" />
        {/* Overhead bin running away from you */}
        <path
          d={`M0 84 L${win.cx - 700 * endScale - 80} ${ceilY(endScale) + 14} L${win.cx + 700 * endScale + 80} ${ceilY(endScale) + 14} L${W} 84 L${W} 208 L${win.cx + 700 * endScale + 80} ${ceilY(endScale) + 52} L${win.cx - 700 * endScale - 80} ${ceilY(endScale) + 52} L0 208 Z`}
          fill="#464238"
        />
        <path d={`M0 84 L${win.cx - 700 * endScale - 80} ${ceilY(endScale) + 14}`} stroke="#6E685C" strokeWidth="2.4" fill="none" />
        <path d={`M${W} 84 L${win.cx + 700 * endScale + 80} ${ceilY(endScale) + 14}`} stroke="#6E685C" strokeWidth="2.4" fill="none" />
        <ellipse cx={win.cx} cy={ceilY(endScale) + 40} rx={220 * endScale + 60} ry={110 * endScale + 30} fill="url(#sv-lamp)" />

        {/* ══ THE FAR SIDE, AND ITS WINDOW ═════════════════════════════ */}
        {hasWindow && (
          <g>
            {/* The fuselage wall the window is set into */}
            <rect
              x={win.cx - 700 * endScale - 90}
              y={ceilY(endScale)}
              width={1400 * endScale + 180}
              height={floorY(endScale) - ceilY(endScale)}
              fill="#4E4A41"
            />
            <rect
              x={win.cx - win.rx - 26 * endScale}
              y={win.cy - win.ry - 26 * endScale}
              width={win.rx * 2 + 52 * endScale}
              height={win.ry * 2 + 52 * endScale}
              rx={win.rx * 0.66}
              fill="#0B0C0F"
            />
            <g clipPath="url(#sv-pane)">
              <g transform={`translate(${win.cx} 0)`}>
                <OutsideWorld ref={world} idPrefix="sv" sky={sky} band={band} horizonY={win.cy} spread={900} />
              </g>
              <rect
                x={win.cx - win.rx}
                y={win.cy - win.ry}
                width={win.rx * 2}
                height={win.ry * 2}
                fill="url(#sv-daylight)"
                opacity="0.28"
              />
              <path
                d={`M${win.cx - win.rx * 0.62} ${win.cy + win.ry} L${win.cx + win.rx * 0.08} ${win.cy - win.ry} l${win.rx * 0.28} 0 L${win.cx - win.rx * 0.32} ${win.cy + win.ry} Z`}
                fill="#FFFFFF"
                opacity="0.08"
              />
            </g>
            <rect
              x={win.cx - win.rx}
              y={win.cy - win.ry}
              width={win.rx * 2}
              height={win.ry * 2}
              rx={win.rx * 0.6}
              fill="none"
              stroke="#6E685C"
              strokeWidth={9 * endScale}
            />
            {/* Shade, pushed up out of the way */}
            <rect
              x={win.cx - win.rx - 8 * endScale}
              y={win.cy - win.ry - 34 * endScale}
              width={win.rx * 2 + 16 * endScale}
              height={32 * endScale}
              rx={9 * endScale}
              fill="#5E594E"
            />
            {/* Daylight thrown back into the cabin */}
            <ellipse cx={win.cx} cy={win.cy + 70} rx={win.rx * 2.6} ry={win.ry * 1.7} fill="url(#sv-daylight)" opacity="0.45" />
          </g>
        )}

        {/* ══ WHAT IS BETWEEN YOU AND IT — drawn far to near ════════════ */}
        {chain
          .map((item, i) => ({ item, i }))
          .reverse()
          .map(({ item, i }) => {
            const s = scaleOf(i);
            const base = floorY(s);
            const top = base - SEAT_H * s;
            const halfW = 172 * s;
            const cx = xOf(s, facing);

            if (item.kind === 'aisle') {
              return (
                <g key={`aisle-${i}`}>
                  <ellipse cx={cx} cy={ceilY(s) + 40} rx={150 * s} ry={80 * s} fill="url(#sv-lamp)" />
                  <rect x={cx - 120 * s} y={base - 10 * s} width={240 * s} height={11 * s} fill="#5E594E" opacity="0.45" />
                </g>
              );
            }
            if (item.kind !== 'seat') return null;

            const occupied = taken.has(item.id);
            const tone = item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1) + i;

            return (
              <g key={item.id}>
                {occupied && (
                  <g>
                    {/* Head and shoulders above the seat, which is what you
                        actually see of the person beside you. */}
                    <ellipse cx={cx} cy={top - 40 * s} rx={38 * s} ry={44 * s} fill={SKIN[tone % SKIN.length]} />
                    <ellipse cx={cx} cy={top - 56 * s} rx={39 * s} ry={30 * s} fill={HAIR[tone % HAIR.length]} />
                    <ellipse cx={cx} cy={top + 4 * s} rx={84 * s} ry={36 * s} fill="#2E3540" />
                  </g>
                )}
                {/* Seat back, seen side-on */}
                <path
                  d={`M${cx - halfW} ${base} L${cx - halfW} ${top + 40 * s} q ${halfW} ${-52 * s} ${halfW * 2} 0 L${cx + halfW} ${base} Z`}
                  fill="url(#sv-seat)"
                  stroke="#5A6270"
                  strokeWidth={1.8 * s}
                />
                <path
                  d={`M${cx - halfW * 0.66} ${top + 34 * s} q ${halfW * 0.66} ${-46 * s} ${halfW * 1.32} 0 l 0 ${58 * s} q ${-halfW * 0.66} ${-34 * s} ${-halfW * 1.32} 0 Z`}
                  fill="#39414F"
                  stroke="#5A6270"
                  strokeWidth={1.6 * s}
                />
                {s > 0.42 && (
                  <text
                    x={cx + halfW - 16 * s}
                    y={top + 92 * s}
                    fontSize={20 * s}
                    textAnchor="end"
                    fill={AMBER}
                    opacity="0.7"
                    fontFamily={MONO}
                  >
                    {item.id}
                  </text>
                )}
              </g>
            );
          })}

        {/* ══ YOUR OWN SEAT, closest to camera ═════════════════════════ */}
        <path d={`M0 ${H} L0 560 q 120 -30 210 26 L250 ${H} Z`} fill="#20252E" />
        <path d={`M${W} ${H} L${W} 560 q -120 -30 -210 26 L950 ${H} Z`} fill="#20252E" />
        {/* Your own armrest along the bottom of frame */}
        <path d={`M0 ${H - 52} q 600 -46 1200 0 L${W} ${H} L0 ${H} Z`} fill="#2A2F38" />
        <path d={`M0 ${H - 52} q 600 -46 1200 0`} stroke="#5A6270" strokeWidth="4" fill="none" opacity="0.55" />

        {/* Where you are, and what the aircraft is doing */}
        <g>
          <rect x="44" y="58" width="126" height="34" fill="#0B0C0F" stroke="#6E685C" strokeWidth="1.4" />
          <text x="107" y="82" fontSize="17" textAnchor="middle" fill={AMBER} fontWeight="700" fontFamily={MONO}>
            {seat.id}
          </text>
          <text x={W - 44} y="70" fontSize="12" textAnchor="end" fill={CYAN} letterSpacing="2" fontFamily={MONO}>
            LOOKING {facing.toUpperCase()}
          </text>
          <text ref={altRead} x={W - 44} y="92" fontSize="14" textAnchor="end" fill="#BFB8A8" fontFamily={MONO} />
        </g>
      </svg>

      <div aria-hidden className="sa-scanlines pointer-events-none absolute inset-0 opacity-[0.07]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(128% 108% at 50% 44%, transparent 46%, rgba(3,5,14,0.74) 100%)' }}
      />
    </div>
  );
};

export default CabinSideView;
