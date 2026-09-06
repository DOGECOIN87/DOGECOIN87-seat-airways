import { useMemo, useRef } from 'react';
import OutsideWorld from './OutsideWorld';
import type { FlightFeed } from '../lib/flightFeed';
import type { BandState } from '../lib/flightModel';
import { formatCap, formatChange } from '../lib/flightModel';
import type { SkyState } from '../lib/sky';
import { useAttitude } from '../lib/useAttitude';
import { ALL_SEATS, type CabinSeat } from '../content/cabin';

/**
 * The whole aircraft, from outside.
 *
 * Zoom far enough out of the cabin and you end up here: one plane, everyone in
 * it. The windows are not decoration — each one is a row, lit if anybody in
 * that row has taken a seat, so the aircraft you are looking at is the same
 * aircraft the seat map is booking. Your own seat is marked.
 *
 * The sky and the ground behind it are the same `OutsideWorld` the cockpit and
 * the cabin windows use, so zooming out does not change the weather, the hour,
 * or how high the market has taken you.
 */

const W = 1600;
const H = 900;
/** Where the fuselage runs, nose to tail. */
const NOSE = 250;
const TAIL = 1430;
/** The window belt. */
const CABIN_FROM = 405;
const CABIN_TO = 1215;
const ROWS = 30;
const ROW_PITCH = (CABIN_TO - CABIN_FROM) / ROWS;
/** Fuselage centreline. */
const CY = 470;

const AMBER = '#FFB300';
const CYAN = '#3FD8E8';
const MONO = "'JetBrains Mono', monospace";

const rowX = (row: number) => CABIN_FROM + (row - 0.5) * ROW_PITCH;

/** Where each cabin sits along the fuselage, for the titles under the windows. */
const CLASS_BANDS: { label: string; from: number; to: number }[] = [
  { label: 'FIRST', from: 1, to: 2 },
  { label: 'BUSINESS', from: 3, to: 7 },
  { label: 'ECONOMY', from: 8, to: 15 },
  { label: 'EXIT ROW', from: 16, to: 17 },
  { label: 'ECONOMY', from: 18, to: 29 },
  { label: 'THE LAVATORY', from: 30, to: 30 },
];

interface ExteriorViewProps {
  feed: FlightFeed;
  sky: SkyState;
  band: BandState;
  taken: ReadonlySet<string>;
  /** The seat on the boarding pass, if one has been claimed. */
  claimed: CabinSeat | null;
  /** Where the walk-through camera is standing, marked as a second pip. */
  viewing: CabinSeat | null;
}

const ExteriorView = ({ feed, sky, band, taken, claimed, viewing }: ExteriorViewProps) => {
  const world = useRef<SVGGElement>(null);
  const plane = useRef<SVGGElement>(null);
  const capRead = useRef<SVGTextElement>(null);
  const chgRead = useRef<SVGTextElement>(null);

  /** How full each row is, so the windows light the way the cabin fills. */
  const rowFill = useMemo(() => {
    const map = new Map<number, { seats: number; sold: number }>();
    for (const s of ALL_SEATS) {
      if (s.row === null) continue;
      const e = map.get(s.row) ?? { seats: 0, sold: 0 };
      e.seats += 1;
      if (taken.has(s.id)) e.sold += 1;
      map.set(s.row, e);
    }
    return map;
  }, [taken]);

  useAttitude(feed, (a, tick) => {
    // Nose-up is a negative rotation in screen space; the aircraft banks a
    // little into the turn too, which reads as a roll from this angle.
    plane.current?.setAttribute(
      'transform',
      `rotate(${(-a.pitch * 0.85).toFixed(2)} ${(NOSE + TAIL) / 2} ${CY}) translate(0 ${(a.bank * 1.6).toFixed(2)})`,
    );
    world.current?.setAttribute('transform', `translate(0 ${(a.pitch * 3).toFixed(2)})`);
    if (tick) {
      if (capRead.current) capRead.current.textContent = formatCap(tick.marketCap);
      if (chgRead.current) {
        chgRead.current.textContent = formatChange(tick.change24h);
        chgRead.current.setAttribute('fill', tick.change24h >= 0 ? '#5BE86B' : '#FF5B4E');
      }
    }
  });

  const markerFor = (seat: CabinSeat | null) => (seat?.row ? rowX(seat.row) : null);
  const claimedX = markerFor(claimed);
  const viewingX = markerFor(viewing);

  return (
    <div
      className="sd-view relative w-full"
      style={{ aspectRatio: '16 / 9', minHeight: 300 }}
      role="img"
      aria-label={`SEAT AIRWAYS flight FL350 from outside, ${band.label.toLowerCase()}. Each lit window is a row with passengers in it${
        claimed ? `, and seat ${claimed.id} is marked` : ''
      }.`}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="ex-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="34%" stopColor="#F2F5FA" />
            <stop offset="62%" stopColor="#C6CEDC" />
            <stop offset="86%" stopColor="#7C8798" />
            <stop offset="100%" stopColor="#49515F" />
          </linearGradient>
          <linearGradient id="ex-belly" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8E98A8" />
            <stop offset="100%" stopColor="#3A414D" />
          </linearGradient>
          <linearGradient id="ex-wing" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stopColor="#DCE2EC" />
            <stop offset="60%" stopColor="#98A2B4" />
            <stop offset="100%" stopColor="#5A6272" />
          </linearGradient>
          <linearGradient id="ex-fin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#123A72" />
            <stop offset="100%" stopColor="#0A2450" />
          </linearGradient>
          <linearGradient id="ex-engine" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E6EBF3" />
            <stop offset="52%" stopColor="#A9B2C2" />
            <stop offset="100%" stopColor="#3E4553" />
          </linearGradient>
          <radialGradient id="ex-win" cx="0.5" cy="0.35" r="0.7">
            <stop offset="0%" stopColor="#FFE9C2" />
            <stop offset="100%" stopColor="#C99A56" />
          </radialGradient>
          <linearGradient id="ex-trail" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* ══ SKY AND GROUND — the same world every other view sees ═════ */}
        <g transform={`translate(${W / 2} 0)`}>
          <OutsideWorld ref={world} sky={sky} band={band} idPrefix="ex" horizonY={620} spread={1500} />
        </g>

        {/* ══ THE AIRCRAFT ═════════════════════════════════════════════ */}
        <g ref={plane}>
          {/* Contrails off the engine */}
          <path d={`M${TAIL - 120} ${CY + 96} L${TAIL + 420} ${CY + 104} L${TAIL + 420} ${CY + 128} L${TAIL - 120} ${CY + 116} Z`} fill="url(#ex-trail)" />

          {/* Tailplane */}
          <path d={`M${TAIL - 130} ${CY - 8} L${TAIL - 34} ${CY - 78} L${TAIL + 24} ${CY - 78} L${TAIL - 60} ${CY + 2} Z`} fill="url(#ex-wing)" />
          {/* Fin, in the airline's colours */}
          <path d={`M${TAIL - 176} ${CY - 26} L${TAIL - 66} ${CY - 232} L${TAIL - 6} ${CY - 232} L${TAIL - 16} ${CY - 30} Z`} fill="url(#ex-fin)" />
          {/* Tail logo: a seat, seen from the side */}
          <g transform={`translate(${TAIL - 88} ${CY - 150}) scale(1.5)`}>
            <circle cx="0" cy="0" r="30" fill="none" stroke="#FFFFFF" strokeWidth="4" />
            <path d="M-12 14 L-12 -10 q 0 -6 6 -6 l 10 0 q 6 0 6 6 l 0 10 l 6 0 l 0 8 Z" fill="#FFFFFF" />
          </g>

          {/* Fuselage */}
          <path
            d={`M${NOSE} ${CY + 6}
                C ${NOSE + 40} ${CY - 46} ${NOSE + 130} ${CY - 74} ${NOSE + 250} ${CY - 78}
                L ${TAIL - 250} ${CY - 76}
                C ${TAIL - 140} ${CY - 72} ${TAIL - 60} ${CY - 54} ${TAIL} ${CY - 22}
                L ${TAIL - 4} ${CY - 4}
                C ${TAIL - 90} ${CY + 30} ${TAIL - 190} ${CY + 48} ${TAIL - 300} ${CY + 52}
                L ${NOSE + 250} ${CY + 54}
                C ${NOSE + 120} ${CY + 50} ${NOSE + 38} ${CY + 34} ${NOSE} ${CY + 6} Z`}
            fill="url(#ex-body)"
          />
          {/* Belly shadow */}
          <path
            d={`M${NOSE + 60} ${CY + 30} C ${NOSE + 200} ${CY + 52} ${TAIL - 400} ${CY + 56} ${TAIL - 300} ${CY + 52} L ${NOSE + 250} ${CY + 54} C ${NOSE + 120} ${CY + 50} ${NOSE + 38} ${CY + 34} ${NOSE} ${CY + 6} Z`}
            fill="url(#ex-belly)"
            opacity="0.85"
          />
          {/* Cheatline */}
          <path d={`M${NOSE + 40} ${CY + 20} C ${NOSE + 180} ${CY + 34} ${TAIL - 420} ${CY + 38} ${TAIL - 210} ${CY + 34} L${TAIL - 210} ${CY + 26} C ${TAIL - 420} ${CY + 30} ${NOSE + 180} ${CY + 26} ${NOSE + 44} ${CY + 12} Z`} fill="#123A72" />

          {/* Flight-deck glass */}
          <path d={`M${NOSE + 44} ${CY - 32} C ${NOSE + 76} ${CY - 50} ${NOSE + 118} ${CY - 58} ${NOSE + 150} ${CY - 60} L${NOSE + 150} ${CY - 34} C ${NOSE + 112} ${CY - 32} ${NOSE + 76} ${CY - 26} ${NOSE + 52} ${CY - 18} Z`} fill="#101826" />
          <path d={`M${NOSE + 58} ${CY - 34} C ${NOSE + 84} ${CY - 46} ${NOSE + 112} ${CY - 51} ${NOSE + 134} ${CY - 52}`} stroke="#5AA9FF" strokeWidth="3" fill="none" opacity="0.5" />

          {/* ── Windows: one per row, lit by who is actually in it ── */}
          {Array.from({ length: ROWS }, (_, i) => i + 1).map((row) => {
            const fill = rowFill.get(row);
            const sold = fill ? fill.sold : 0;
            const lit = sold > 0;
            const x = rowX(row);
            return (
              <g key={row}>
                <rect x={x - 6} y={CY - 46} width="12" height="15" rx="5" fill={lit ? 'url(#ex-win)' : '#2B3340'} />
                {lit && (
                  <>
                    {/* A head in the window, which is the whole point */}
                    <ellipse cx={x} cy={CY - 36} rx="3.6" ry="4.4" fill="#4A382A" opacity="0.85" />
                    <rect x={x - 6} y={CY - 46} width="12" height="15" rx="5" fill="#FFD79A" opacity={0.18 + (sold / (fill?.seats ?? 6)) * 0.3} />
                  </>
                )}
                <rect x={x - 6} y={CY - 46} width="12" height="15" rx="5" fill="none" stroke="#8792A4" strokeWidth="0.9" />
              </g>
            );
          })}

          {/* Doors, fore and aft */}
          {[CABIN_FROM - 34, CABIN_TO + 22].map((x) => (
            <rect key={x} x={x} y={CY - 52} width="20" height="46" rx="8" fill="none" stroke="#8792A4" strokeWidth="1.6" />
          ))}

          {/* ── Titles ── */}
          <text x={NOSE + 300} y={CY + 4} fontSize="46" fontWeight="800" fill="#123A72" letterSpacing="-1" fontFamily="'Barlow Condensed', 'JetBrains Mono', sans-serif">
            $SEAT
          </text>
          <text x={NOSE + 640} y={CY + 2} fontSize="14" fontWeight="700" fill="#123A72" letterSpacing="2.2" fontFamily={MONO}>
            ONE PLANE. EVERYONE&apos;S IN IT.
          </text>

          {/* Cabin classes, called out under the windows they belong to */}
          {CLASS_BANDS.map((b) => (
            <text
              key={`${b.label}-${b.from}`}
              x={(rowX(b.from) + rowX(b.to)) / 2}
              y={CY - 62}
              fontSize="10.5"
              textAnchor="middle"
              fill="#5B6678"
              letterSpacing="1.4"
              fontFamily={MONO}
            >
              {b.label}
            </text>
          ))}

          {/* Wing, swept aft, with the engine hung off its leading edge */}
          <path
            d={`M${NOSE + 470} ${CY + 40}
                L${NOSE + 760} ${CY + 44}
                L${NOSE + 900} ${CY + 236}
                L${NOSE + 800} ${CY + 240}
                Z`}
            fill="url(#ex-wing)"
          />
          <path d={`M${NOSE + 470} ${CY + 40} L${NOSE + 800} ${CY + 240}`} stroke="#6E7889" strokeWidth="2" fill="none" opacity="0.7" />
          {/* Pylon and engine */}
          <path d={`M${NOSE + 512} ${CY + 46} L${NOSE + 566} ${CY + 46} L${NOSE + 556} ${CY + 96} L${NOSE + 508} ${CY + 96} Z`} fill="#98A2B4" />
          <g>
            <rect x={NOSE + 424} y={CY + 88} width="168" height="72" rx="36" fill="url(#ex-engine)" />
            <rect x={NOSE + 424} y={CY + 88} width="168" height="72" rx="36" fill="none" stroke="#6E7889" strokeWidth="2" />
            <ellipse cx={NOSE + 430} cy={CY + 124} rx="13" ry="33" fill="#151A24" />
            <ellipse cx={NOSE + 430} cy={CY + 124} rx="6.5" ry="20" fill="#39424F" />
            <path d={`M${NOSE + 566} ${CY + 96} l 26 12 l -26 12 Z`} fill="#7D8798" />
          </g>
          {/* Winglet */}
          <path d={`M${NOSE + 800} ${CY + 240} L${NOSE + 830} ${CY + 200} L${NOSE + 872} ${CY + 202} L${NOSE + 900} ${CY + 236} Z`} fill="#123A72" />

          {/* Navigation lights */}
          <circle cx={NOSE + 886} cy={CY + 216} r="5" fill="#FF4438" />
          <circle cx={TAIL - 10} cy={CY - 26} r="4" fill="#5BE86B" />

          {/* ── Your seat, and where the camera is standing ── */}
          {viewingX !== null && viewingX !== claimedX && (
            <g>
              <line x1={viewingX} y1={CY - 66} x2={viewingX} y2={CY - 104} stroke={CYAN} strokeWidth="2" opacity="0.8" />
              <circle cx={viewingX} cy={CY - 112} r="7" fill="none" stroke={CYAN} strokeWidth="2.4" />
              <text x={viewingX} y={CY - 128} fontSize="13" textAnchor="middle" fill={CYAN} fontFamily={MONO}>
                {viewing?.id}
              </text>
            </g>
          )}
          {claimedX !== null && (
            <g>
              <line x1={claimedX} y1={CY - 66} x2={claimedX} y2={CY - 118} stroke={AMBER} strokeWidth="2.6" />
              <circle cx={claimedX} cy={CY - 128} r="11" fill="none" stroke={AMBER} strokeWidth="3" className="sa-pulse-glow" />
              <circle cx={claimedX} cy={CY - 128} r="4" fill={AMBER} />
              <text x={claimedX} y={CY - 150} fontSize="15" textAnchor="middle" fill={AMBER} fontWeight="700" fontFamily={MONO}>
                {claimed?.id}
              </text>
              <text x={claimedX} y={CY - 168} fontSize="10" textAnchor="middle" fill={AMBER} opacity="0.7" letterSpacing="1.6" fontFamily={MONO}>
                YOUR SEAT
              </text>
            </g>
          )}
        </g>

        {/* ══ THE STRAP LINE ═══════════════════════════════════════════ */}
        <g>
          <text x="56" y="92" fontSize="46" fontWeight="800" fill="#FFFFFF" letterSpacing="-0.5" fontFamily="'Barlow Condensed', 'JetBrains Mono', sans-serif">
            $SEAT
          </text>
          <text x="58" y="118" fontSize="13" fill="#CBD6E6" letterSpacing="3.4" fontFamily={MONO}>
            ONE PLANE. EVERYONE'S IN IT.
          </text>
        </g>
        <g>
          <rect x="52" y={H - 150} width="330" height="98" fill="#080B12" opacity="0.72" />
          <text x="72" y={H - 122} fontSize="11" fill="#8E9AAE" letterSpacing="2.2" fontFamily={MONO}>ALTITUDE</text>
          <text ref={capRead} x="72" y={H - 92} fontSize="30" fill="#FFFFFF" fontWeight="700" fontFamily={MONO} />
          <text x="252" y={H - 122} fontSize="11" fill="#8E9AAE" letterSpacing="2.2" fontFamily={MONO}>24H</text>
          <text ref={chgRead} x="252" y={H - 92} fontSize="22" fill="#5BE86B" fontWeight="700" fontFamily={MONO} />
          <text x="72" y={H - 66} fontSize="11" fill={CYAN} letterSpacing="2" fontFamily={MONO}>
            {band.label.toUpperCase()}
          </text>
        </g>
      </svg>

      <div aria-hidden className="sa-scanlines pointer-events-none absolute inset-0 opacity-[0.06]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(130% 110% at 50% 46%, transparent 52%, rgba(3,5,14,0.66) 100%)' }}
      />
    </div>
  );
};

export default ExteriorView;
