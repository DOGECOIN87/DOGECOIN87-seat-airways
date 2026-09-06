import { useMemo, useRef } from 'react';
import OutsideWorld from './OutsideWorld';
import type { FlightFeed } from '../lib/flightFeed';
import type { BandState } from '../lib/flightModel';
import { formatChange, formatFeet } from '../lib/flightModel';
import type { SkyState } from '../lib/sky';
import { useAttitude } from '../lib/useAttitude';
import { seatsInRow, type CabinSeat, type CabinZone } from '../content/cabin';

/**
 * The view from a seat.
 *
 * The same flight as the cockpit — same sun, same weather, same altitude band
 * — seen from wherever the passenger ended up. What changes is the framing,
 * and that is the whole point of the seat ladder:
 *
 *   window  the glass is at your shoulder and the world fills it
 *   middle  the window is a seat away, with a neighbour between you and it
 *   aisle   you can barely see out, but the cabin opens up beside you
 *
 * The zone changes the furniture too: First gets a suite shell and a wide
 * table, the exit row gets the door you signed for, and row 30 gets the
 * lavatory instead of a seat back.
 */

const W = 1200;
const H = 800;
/* A real cabin: warm grey-beige panels, blue-grey upholstery, amber wash from
   the reading lights, and the seat-back screen the only cool light in shot. */
const CYAN = '#3FD8E8';
const AMBER = '#FFB300';
const GREEN = '#5BE86B';
const RED = '#FF5B4E';
const MONO = "'JetBrains Mono', monospace";

/** Window placement and cabin dimming, by how far from the glass you sit. */
const FRAMING = {
  window: { cx: 244, cy: 352, rx: 138, ry: 184, dim: 0 },
  middle: { cx: 196, cy: 356, rx: 110, ry: 148, dim: 0.16 },
  aisle: { cx: 158, cy: 358, rx: 84, ry: 112, dim: 0.28 },
} as const;

interface CabinViewProps {
  feed: FlightFeed;
  sky: SkyState;
  band: BandState;
  seat: CabinSeat;
  zone: CabinZone;
  /** True for the last row, where the view ahead is the lavatory door. */
  lavatory: boolean;
  /** Which seats are sold — the same roll the seat map draws from. */
  taken: ReadonlySet<string>;
}

/* Passengers, so the cabin ahead is not empty. Muted enough to stay
   background, varied enough that it reads as a cabin full of people. */
const HAIR = ['#2B2118', '#4A3524', '#0F0C0A', '#6B5238', '#8A7A6A', '#3A2418', '#B9A184'];
const SKIN = ['#C99A72', '#8D5F3F', '#E3B894', '#6B4529', '#A8724C', '#D9A87E', '#5A3A22'];

/** One passenger, seen from behind: head, hair and shoulders over a seat back. */
const Passenger = ({ x, y, s, i }: { x: number; y: number; s: number; i: number }) => (
  <g transform={`translate(${x} ${y}) scale(${s})`}>
    <ellipse cx="0" cy="26" rx="34" ry="20" fill="#2E3540" />
    <ellipse cx="0" cy="0" rx="19" ry="22" fill={SKIN[i % SKIN.length]} />
    <path d="M-19 -3 A 19 22 0 0 1 19 -3 L17 -8 A 17 19 0 0 0 -17 -8 Z" fill={HAIR[i % HAIR.length]} />
    <ellipse cx="0" cy="-9" rx="19" ry="13" fill={HAIR[i % HAIR.length]} />
  </g>
);

const CabinView = ({ feed, sky, band, seat, zone, lavatory, taken }: CabinViewProps) => {
  const world = useRef<SVGGElement>(null);
  const screenAlt = useRef<SVGTextElement>(null);
  const screenChg = useRef<SVGTextElement>(null);
  const screenSpd = useRef<SVGTextElement>(null);

  const f = FRAMING[seat.position];
  const premium = zone.key === 'first' || zone.key === 'business';
  /* First gets a shell, a divider and a lamp. Business is simply wide. */
  const suite = zone.key === 'first';
  const exitRow = zone.key === 'exit';
  /* Above the atmosphere there is no daylight to spill into the cabin — the
     window goes black and the reading lights become the only light in shot. */
  const inAir = band.band === 'atmosphere' || band.band === 'above-clouds';
  const wash = inAir ? sky.palette.horizon : '#0A1024';
  const washStrength = inAir ? 0.16 : 0.06;

  /* The seat ahead: wider and further off in the premium cabins. */
  const seatTop = premium ? 392 : 406;
  const seatL = premium ? 392 : 430;
  const seatR = premium ? 1010 : 972;
  const screen = premium
    ? { x: 512, y: 428, w: 378, h: 196 }
    : { x: 532, y: 442, w: 340, h: 182 };
  const screenCx = screen.x + screen.w / 2;

  /* The rows in front of you, receding toward the front of the aircraft.
     Occupancy comes from the same set the seat map uses, so the person two
     rows up is a seat somebody really has taken. */
  const rowsAhead = useMemo(() => {
    if (seat.row === null) return [];
    const out: { seats: { id: string; occupied: boolean }[]; y: number; scale: number; depth: number }[] = [];
    for (let d = 1; d <= 3; d++) {
      const inRow = seatsInRow(seat.row - d);
      if (inRow.length === 0) break;
      out.push({
        seats: inRow.map((sx) => ({ id: sx.id, occupied: taken.has(sx.id) })),
        y: 336 - d * 34,
        scale: 1 - d * 0.17,
        depth: d,
      });
    }
    return out.reverse();
  }, [seat.row, taken]);

  useAttitude(feed, (a, tick) => {
    world.current?.setAttribute(
      'transform',
      `rotate(${a.bank.toFixed(2)} 0 ${f.cy}) translate(0 ${(a.pitch * 7).toFixed(2)})`,
    );
    if (screenAlt.current) screenAlt.current.textContent = `${formatFeet(a.alt)} FT`;
    if (screenSpd.current) screenSpd.current.textContent = `${Math.round(a.speed)} KT`;
    if (tick && screenChg.current) {
      screenChg.current.textContent = formatChange(tick.change24h);
      screenChg.current.setAttribute('fill', tick.change24h >= 0 ? GREEN : RED);
    }
  });

  return (
    <div
      className="sd-view sd-frame relative w-full"
      
      role="img"
      aria-label={`The view from seat ${seat.id} in ${zone.name}: ${
        seat.position === 'window' ? 'a window seat' : seat.position === 'middle' ? 'a middle seat' : 'an aisle seat'
      }. The flight's readings are published as text below.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="cv-wall" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#39362F" />
            <stop offset="30%" stopColor="#4E4A41" />
            <stop offset="100%" stopColor="#2A2823" />
          </linearGradient>
          <linearGradient id="cv-ceiling" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22201C" />
            <stop offset="100%" stopColor="#4A463D" />
          </linearGradient>
          <linearGradient id="cv-bin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5E594E" />
            <stop offset="58%" stopColor="#464238" />
            <stop offset="100%" stopColor="#2A2823" />
          </linearGradient>
          <linearGradient id="cv-seat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={premium ? '#3E4A63' : '#38414F'} />
            <stop offset="46%" stopColor={premium ? '#2C3549' : '#2A303B'} />
            <stop offset="100%" stopColor="#14171C" />
          </linearGradient>
          <linearGradient id="cv-seat-side" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#39414F" />
            <stop offset="100%" stopColor="#111419" />
          </linearGradient>
          <linearGradient id="cv-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2A2823" />
            <stop offset="100%" stopColor="#0C0D10" />
          </linearGradient>
          <radialGradient id="cv-lamp" cx="0.5" cy="0" r="1">
            <stop offset="0%" stopColor="#FFCE7A" stopOpacity="0.26" />
            <stop offset="55%" stopColor="#FFCE7A" stopOpacity="0.07" />
            <stop offset="100%" stopColor="#FFCE7A" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="cv-daylight" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={wash} stopOpacity={washStrength} />
            <stop offset="100%" stopColor={wash} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="cv-screen" x1="0" y1="0" x2="0.5" y2="1">
            <stop offset="0%" stopColor="#0C1524" />
            <stop offset="100%" stopColor="#050810" />
          </linearGradient>

          <clipPath id="cv-pane">
            <rect x={f.cx - f.rx} y={f.cy - f.ry} width={f.rx * 2} height={f.ry * 2} rx={f.rx * 0.6} />
          </clipPath>
        </defs>

        {/* ══ SHELL ═════════════════════════════════════════════════════ */}
        <rect x="0" y="0" width={W} height={H} fill="url(#cv-wall)" />
        {/* Curved ceiling */}
        <path d={`M0 0 H${W} V132 C 900 92 300 92 0 138 Z`} fill="url(#cv-ceiling)" />
        {/* Floor */}
        <path d={`M0 ${H} H${W} V700 C 900 730 300 730 0 706 Z`} fill="url(#cv-floor)" />

        {/* ══ OVERHEAD BINS ═════════════════════════════════════════════ */}
        <path d="M0 130 C 300 86 900 86 1200 126 L1200 250 C 900 214 300 214 0 258 Z" fill="url(#cv-bin)" />
        <path d="M0 130 C 300 86 900 86 1200 126" fill="none" stroke="#6E685C" strokeWidth="2.6" />
        <path d="M0 258 C 300 214 900 214 1200 250" fill="none" stroke="#6E685C" strokeWidth="2.6" />
        {/* Bin seams and latches */}
        <g>
          {[190, 470, 750, 1030].map((x, i) => (
            <g key={x}>
              <path d={`M${x} ${118 + i * 2} L${x} ${242 + i * 2}`} stroke="#171E36" strokeWidth="2.4" opacity="0.8" />
              <rect x={x - 66} y={176 - i} width="44" height="9" rx="4" fill="#7C7566" />
            </g>
          ))}
        </g>
        {/* Reading lights: a small lens and a soft pool, not a headlamp */}
        <g>
          {[330, 660, 990].map((x) => (
            <g key={x}>
              <circle cx={x} cy="256" r="6" fill="#FFE7BC" opacity="0.85" />
              <ellipse cx={x} cy="330" rx="90" ry="120" fill="url(#cv-lamp)" />
            </g>
          ))}
          <rect x="596" y="240" width="92" height="26" rx="3" fill="#0B0C0F" stroke={CYAN} strokeWidth="1.2" />
          <text x="642" y="258" fontSize="11" textAnchor="middle" fill={CYAN} fontWeight="700" letterSpacing="0.8">
            FASTEN
          </text>
        </g>

        {/* ══ THE WINDOW ════════════════════════════════════════════════ */}
        <g>
          <rect x={f.cx - f.rx - 30} y={f.cy - f.ry - 30} width={f.rx * 2 + 60} height={f.ry * 2 + 60} rx={f.rx * 0.68} fill="#3A362F" />
          <rect x={f.cx - f.rx - 14} y={f.cy - f.ry - 14} width={f.rx * 2 + 28} height={f.ry * 2 + 28} rx={f.rx * 0.64} fill="#0B0C0F" />
          <g clipPath="url(#cv-pane)">
            <g transform={`translate(${f.cx} 0)`}>
              <OutsideWorld ref={world} idPrefix="cv" sky={sky} band={band} horizonY={f.cy} spread={1000} />
            </g>
            {(exitRow || zone.key === 'business') && (
              <g>
                <path
                  d={`M${f.cx - f.rx} ${f.cy + f.ry * 0.5} L${f.cx + f.rx} ${f.cy + f.ry * 0.16} L${f.cx + f.rx} ${f.cy + f.ry} L${f.cx - f.rx} ${f.cy + f.ry} Z`}
                  fill="#C9D2EE"
                />
                <path
                  d={`M${f.cx - f.rx} ${f.cy + f.ry * 0.62} L${f.cx + f.rx} ${f.cy + f.ry * 0.28}`}
                  stroke="#8B96C4"
                  strokeWidth="2"
                />
                <circle cx={f.cx + f.rx * 0.5} cy={f.cy + f.ry * 0.4} r="4" fill={RED} />
              </g>
            )}
            <rect x={f.cx - f.rx} y={f.cy - f.ry} width={f.rx * 2} height={f.ry * 2} fill="url(#cv-daylight)" opacity="0.3" />
            <path
              d={`M${f.cx - f.rx * 0.62} ${f.cy + f.ry} L${f.cx + f.rx * 0.08} ${f.cy - f.ry} l${f.rx * 0.3} 0 L${f.cx - f.rx * 0.32} ${f.cy + f.ry} Z`}
              fill="#FFFFFF"
              opacity="0.08"
            />
          </g>
          <rect x={f.cx - f.rx} y={f.cy - f.ry} width={f.rx * 2} height={f.ry * 2} rx={f.rx * 0.6} fill="none" stroke="#6E685C" strokeWidth="8" />
          {/* Shade, pushed up */}
          <rect x={f.cx - f.rx - 6} y={f.cy - f.ry - 26} width={f.rx * 2 + 12} height="28" rx="7" fill="#5E594E" />
          {/* Daylight thrown across the wall and onto the seat */}
          <ellipse cx={f.cx + f.rx * 1.7} cy={f.cy + 60} rx={f.rx * 2.2} ry={f.ry * 1.1} fill="url(#cv-daylight)" opacity="0.6" />
        </g>

        {/* ══ THE ROW AHEAD ═════════════════════════════════════════════ */}
        {lavatory ? (
          <g>
            <rect x="452" y="266" width="356" height="470" fill="#464238" stroke="#6E685C" strokeWidth="2.6" />
            <rect x="484" y="298" width="292" height="406" fill="#282621" />
            <circle cx="748" cy="512" r="11" fill="#BFB8A8" />
            <rect x="556" y="336" width="148" height="36" fill="#0B0C0F" stroke={RED} strokeWidth="1.6" />
            <text x="630" y="361" fontSize="15" textAnchor="middle" fill={RED} fontWeight="700" letterSpacing="1.8">
              OCCUPIED
            </text>
            <text x="630" y="436" fontSize="12" textAnchor="middle" fill="#BFB8A8" letterSpacing="2" fontFamily={MONO}>
              LAVATORY
            </text>
          </g>
        ) : (
          <g>
            {/* The rows ahead, with the people who booked them */}
            {rowsAhead.map((row) => {
              const cx = (seatL + seatR) / 2;
              // Derived from the near seat's width so the rows converge rather
              // than splay: further away is narrower, always.
              const pitch = ((seatR - seatL) / row.seats.length) * row.scale * 0.94;
              const half = (row.seats.length - 1) / 2;
              return (
                <g key={row.depth}>
                  {row.seats.map((st, i) => {
                    // An aisle gap down the middle, as there is in the cabin.
                    const side = i < row.seats.length / 2 ? -1 : 1;
                    const x = cx + (i - half) * pitch + side * 14 * row.scale;
                    return (
                      <g key={st.id}>
                        {st.occupied && (
                          <Passenger x={x} y={row.y - 26 * row.scale} s={row.scale * 0.62} i={st.id.charCodeAt(0) + i + row.depth} />
                        )}
                        {/* Seat back, drawn over the passenger's shoulders */}
                        <path
                          d={`M${x - pitch * 0.46} ${row.y} q ${pitch * 0.46} ${-14 * row.scale} ${pitch * 0.92} 0 l ${5 * row.scale} ${74 * row.scale} h ${-pitch * 0.92 - 10 * row.scale} Z`}
                          fill={premium ? '#333B4E' : '#2E3540'}
                          stroke="#454E5E"
                          strokeWidth={1.2 * row.scale}
                        />
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {/* Seat back directly ahead */}
            <path
              d={`M${seatL} ${seatTop} C ${seatL + 110} ${seatTop - 40} ${seatR - 110} ${seatTop - 40} ${seatR} ${seatTop} L${seatR + 32} ${H} L${seatL - 32} ${H} Z`}
              fill="url(#cv-seat)"
            />
            <path
              d={`M${seatL} ${seatTop} C ${seatL + 110} ${seatTop - 40} ${seatR - 110} ${seatTop - 40} ${seatR} ${seatTop}`}
              fill="none"
              stroke="#7C7566"
              strokeWidth="2.6"
            />
            {/* Piping down both sides */}
            <path d={`M${seatL + 6} ${seatTop + 16} L${seatL - 24} ${H}`} stroke="#7C7566" strokeWidth="2" fill="none" opacity="0.5" />
            <path d={`M${seatR - 6} ${seatTop + 16} L${seatR + 24} ${H}`} stroke="#7C7566" strokeWidth="2" fill="none" opacity="0.5" />
            {/* Headrest */}
            <path
              d={`M${seatL + 128} ${seatTop - 46} C ${seatL + 210} ${seatTop - 76} ${seatR - 210} ${seatTop - 76} ${seatR - 128} ${seatTop - 46} L${seatR - 120} ${seatTop + 4} C ${seatR - 210} ${seatTop - 22} ${seatL + 210} ${seatTop - 22} ${seatL + 120} ${seatTop + 4} Z`}
              fill="#39414F"
              stroke="#5A6270"
              strokeWidth="1.6"
            />

            {/* Seat-back screen — the flight, from the cheap seats */}
            <g>
              <rect x={screen.x - 12} y={screen.y - 12} width={screen.w + 24} height={screen.h + 24} fill="#0B0C0F" stroke="#6E685C" strokeWidth="2.2" />
              <rect x={screen.x} y={screen.y} width={screen.w} height={screen.h} fill="url(#cv-screen)" />
              <text x={screenCx} y={screen.y + 30} fontSize="13" textAnchor="middle" fill={CYAN} letterSpacing="2.4" fontFamily={MONO}>
                SEAT AIRWAYS · FL350
              </text>
              <text ref={screenAlt} x={screenCx} y={screen.y + 76} fontSize="26" textAnchor="middle" fill="#FFFFFF" fontWeight="700" fontFamily={MONO} />
              {/* Moving map */}
              <path
                d={`M${screen.x + 30} ${screen.y + 140} C ${screen.x + 110} ${screen.y + 106} ${screen.w * 0.62 + screen.x} ${screen.y + 158} ${screen.x + screen.w - 34} ${screen.y + 116}`}
                stroke={AMBER}
                strokeWidth="2"
                fill="none"
                strokeDasharray="6 5"
              />
              <circle cx={screen.x + screen.w - 34} cy={screen.y + 116} r="4.5" fill={AMBER} />
              {/* Three readings on one line, each with its own third */}
              <text ref={screenChg} x={screen.x + 18} y={screen.y + screen.h - 16} fontSize="16" fill={GREEN} fontWeight="700" fontFamily={MONO} />
              <text x={screenCx} y={screen.y + screen.h - 17} fontSize="10" textAnchor="middle" fill="#BFB8A8" letterSpacing="1.4" fontFamily={MONO}>
                {band.label.toUpperCase()}
              </text>
              <text ref={screenSpd} x={screen.x + screen.w - 18} y={screen.y + screen.h - 16} fontSize="16" textAnchor="end" fill="#E8EDF5" fontFamily={MONO} />
            </g>

            {/* ── First only: the shell, the divider and the console ── */}
            {suite && (
              <g>
                {/* Privacy shell curving around the seat ahead */}
                <path
                  d={`M${seatL - 74} ${H} L${seatL - 62} ${seatTop - 96} q ${(seatR - seatL) / 2 + 68} ${-74} ${seatR - seatL + 136} 0 L${seatR + 74} ${H}`}
                  fill="none"
                  stroke="#7C7566"
                  strokeWidth="3"
                />
                <path
                  d={`M${seatL - 74} ${H} L${seatL - 62} ${seatTop - 96} q ${(seatR - seatL) / 2 + 68} ${-74} ${seatR - seatL + 136} 0 L${seatR + 74} ${H} Z`}
                  fill="#2E2B25"
                  opacity="0.55"
                />
                {/* Side console with a reading lamp and a glass */}
                <path d={`M${seatL - 66} ${seatTop + 150} h 120 v ${H - seatTop - 150} h -132 Z`} fill="#3A362F" />
                <path d={`M${seatL - 66} ${seatTop + 150} h 120 v 12 h -122 Z`} fill="#5E594E" />
                <g>
                  <path d={`M${seatL - 22} ${seatTop + 150} v -54`} stroke="#6E685C" strokeWidth="4" fill="none" />
                  <path d={`M${seatL - 40} ${seatTop + 88} h 36 l -6 -18 h -24 Z`} fill="#5E594E" />
                  <ellipse cx={seatL - 22} cy={seatTop + 152} rx="72" ry="34" fill="#FFCE7A" opacity="0.14" />
                </g>
                <ellipse cx={seatL + 34} cy={seatTop + 168} rx="17" ry="7" fill="#BFB8A8" opacity="0.5" />
                <path d={`M${seatL + 21} ${seatTop + 168} l 4 30 h 18 l 4 -30 Z`} fill="#DDE6F2" opacity="0.35" />
              </g>
            )}

            {/* Tray table latched shut, and the literature pocket */}
            <rect x={screen.x - 30} y={screen.y + screen.h + 40} width={screen.w + 60} height="16" rx="3" fill="#5E594E" />
            <rect x={screenCx - 16} y={screen.y + screen.h + 56} width="32" height="10" rx="3" fill="#BFB8A8" />
            <path
              d={`M${screen.x - 6} ${screen.y + screen.h + 92} h${screen.w + 12} v${H - (screen.y + screen.h + 92) - 46} h-${screen.w + 12} Z`}
              fill="#282621"
              stroke="#6E685C"
              strokeWidth="1.6"
            />
            <text x={screenCx} y={screen.y + screen.h + 132} fontSize="11" textAnchor="middle" fill="#9C9484" letterSpacing="2" fontFamily={MONO}>
              SAFETY CARD
            </text>
          </g>
        )}

        {/* ══ WHAT ELSE IS IN SHOT ══════════════════════════════════════ */}
        {/* A neighbour, between a middle seat and the daylight */}
        {seat.position === 'middle' && (
          <g>
            <path d="M0 800 L0 486 C 44 414 190 408 244 478 L268 800 Z" fill="#2A2823" />
            <ellipse cx="130" cy="414" rx="78" ry="70" fill="#282621" />
            <path d="M0 486 C 44 414 190 408 244 478" fill="none" stroke="#5E594E" strokeWidth="1.8" />
          </g>
        )}
        {/* The aisle, open beside an aisle seat */}
        {seat.position === 'aisle' && (
          <g>
            {/* Cabin running away aft */}
            <path d={`M${seatR + 40} 250 L${W} 206 L${W} ${H} L${seatR + 8} ${H} Z`} fill="#2A2823" />
            <path d={`M${seatR + 40} 250 L${W} 206`} stroke="#6E685C" strokeWidth="2.2" fill="none" />
            {/* Receding headrests down the aisle */}
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                d={`M${seatR + 62 + i * 62} ${330 + i * 34} h${58 - i * 12} v${180 - i * 40} h-${58 - i * 12} Z`}
                fill="#464238"
                opacity={0.9 - i * 0.22}
              />
            ))}
            <g fill={RED} opacity="0.8">
              {[684, 736, 788].map((y) => (
                <rect key={y} x={seatR + 22} y={y} width="8" height="8" />
              ))}
            </g>
          </g>
        )}
        {/* The door you agreed to open */}
        {exitRow && (
          <g>
            <rect x={W - 226} y="212" width="204" height="512" rx="28" fill="#464238" stroke="#6E685C" strokeWidth="3" />
            <rect x={W - 200} y="246" width="152" height="150" rx="20" fill="#0B0C0F" />
            <rect x={W - 186} y="442" width="126" height="32" fill="#0B0C0F" stroke={RED} strokeWidth="1.8" />
            <text x={W - 123} y="465" fontSize="16" textAnchor="middle" fill={RED} fontWeight="700" letterSpacing="3">
              EXIT
            </text>
            <rect x={W - 176} y="524" width="106" height="22" rx="9" fill="#BFB8A8" />
            <text x={W - 123} y="580" fontSize="10" textAnchor="middle" fill="#BFB8A8" letterSpacing="1.4" fontFamily={MONO}>
              PULL HANDLE
            </text>
          </g>
        )}

        {/* ══ YOUR OWN ROW, closest to camera ═══════════════════════════ */}
        <path d={`M0 ${H} L0 700 C 140 672 300 668 400 690 L400 ${H} Z`} fill="url(#cv-seat-side)" />
        <path d={`M${W} ${H} L${W} 700 C 1060 672 900 668 800 690 L800 ${H} Z`} fill="url(#cv-seat-side)" />
        <path d="M60 748 C 300 716 900 716 1140 748" stroke="#5E594E" strokeWidth="10" fill="none" opacity="0.6" />

        {/* Seat number, on the bin edge where it always is */}
        <g>
          <rect x="48" y="150" width="94" height="32" fill="#0B0C0F" stroke="#6E685C" strokeWidth="1.4" />
          <text x="95" y="173" fontSize="16" textAnchor="middle" fill={AMBER} fontWeight="700" fontFamily={MONO}>
            {seat.id}
          </text>
        </g>

        {/* Cabin darkening away from the window, per how far in you sit */}
        {f.dim > 0 && <rect x="0" y="0" width={W} height={H} fill="#05070F" opacity={f.dim} />}
      </svg>

      <div aria-hidden className="sa-scanlines pointer-events-none absolute inset-0 opacity-[0.07]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(128% 108% at 40% 42%, transparent 48%, rgba(3,5,14,0.72) 100%)' }}
      />
      <p className="sr-only">
        Seat {seat.id}, {zone.className}, {seat.position} seat. {band.label}. Outside: {sky.label}.
        {band.next ? ` Next: ${band.next}.` : ''}
      </p>
    </div>
  );
};

export default CabinView;
