import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FlightDeck from './components/FlightDeck';
import CabinView from './components/CabinView';
import CabinSideView from './components/CabinSideView';
import ExteriorView from './components/ExteriorView';
import ViewFrame from './components/ViewFrame';
import Annunciators from './components/Annunciators';
import SeatMap from './components/SeatMap';
import BoardingPass from './components/BoardingPass';
import RadioLog, { type LogEntry } from './components/RadioLog';
import {
  ALL_SEATS,
  CABIN_ZONES,
  CALLOUTS,
  CHATTER,
  LAVATORY_SEATS,
  findSeat,
  type CabinSeat,
  type Facing,
  type SeatPosition,
  type ZoneKey,
} from './content/cabin';
import { createSimulatedFeed, type FlightMode } from './lib/flightFeed';
import {
  BAND_CLOUDS,
  BAND_MOON,
  BAND_SPACE,
  bandFor,
  formatCap,
  formatChange,
  formatFeet,
  occupiedSeats,
} from './lib/flightModel';
import { useFlightState } from './lib/useFlightState';
import { useSky } from './lib/useSky';
import { passengerName } from './lib/passenger';

/**
 * SEAT AIRWAYS — the cabin.
 *
 * One number flies the whole page. The 24h change sets the aircraft's attitude
 * and the market cap is its altitude: $1M puts you on top of the cloud deck,
 * $10M turns the sky black, $50M is the moon. The sky itself is real — the
 * visitor's own time of day, and the weather where they are.
 *
 * The aircraft is walkable. Every zone has its own view, and within a zone the
 * window, middle and aisle seats see genuinely different things, because that
 * is the ladder the whole premise rests on.
 */

/** Fixed cabin seed — the same aircraft every visit, not a fresh shuffle. */
const CABIN_SEED = 350;

const MODES: { key: FlightMode; label: string }[] = [
  { key: 'live', label: 'Live market' },
  { key: 'climb', label: 'Climb' },
  { key: 'cruise', label: 'Cruise' },
  { key: 'turbulence', label: 'Turbulence' },
  { key: 'dive', label: 'Dive' },
];

/** Altitudes worth visiting without waiting out the climb. */
const ALTITUDES: { label: string; cap: number }[] = [
  { label: 'In the weather', cap: 163_000 },
  { label: 'Above the clouds', cap: BAND_CLOUDS * 1.6 },
  { label: 'Space', cap: BAND_SPACE * 1.6 },
  { label: 'The moon', cap: BAND_MOON * 1.1 },
];

const POSITIONS: { key: SeatPosition; label: string }[] = [
  { key: 'window', label: 'Window' },
  { key: 'middle', label: 'Middle' },
  { key: 'aisle', label: 'Aisle' },
];

/** Which way you are looking from a seat. */
const FACINGS: { key: Facing; label: string }[] = [
  { key: 'left', label: '← Look left' },
  { key: 'forward', label: 'Forward' },
  { key: 'right', label: 'Look right →' },
];

/**
 * Where the camera is.
 *
 * `seat` is the default and where the page opens: you are sitting down,
 * looking forward. `exterior` is what you get by zooming all the way out —
 * one plane, everyone in it.
 */
type Camera = 'exterior' | 'deck' | 'seat';

const clockNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The seat you would be shown when walking into a zone at a given position. */
function representativeSeat(zone: ZoneKey, position: SeatPosition): CabinSeat {
  const inZone = ALL_SEATS.filter((s) => s.zone === zone);
  return inZone.find((s) => s.position === position) ?? inZone[0];
}

export default function App() {

  const feed = useMemo(() => createSimulatedFeed(), []);
  const { tick, lamps } = useFlightState(feed);
  const sky = useSky();
  const band = useMemo(() => bandFor(tick.marketCap), [tick.marketCap]);

  const [mode, setMode] = useState<FlightMode>('live');
  /** The page opens in a seat, looking forward — not on the flight deck. */
  const [camera, setCamera] = useState<Camera>('seat');
  const [facing, setFacing] = useState<Facing>('forward');
  /** Where you are sitting. Independent of where you are ticketed. */
  const [viewZone, setViewZone] = useState<ZoneKey>('economy');
  const [viewPosition, setViewPosition] = useState<SeatPosition>('window');
  /** Where you are ticketed. Null until you claim one. */
  const [claimed, setClaimed] = useState<string | null>(null);
  const [boardedAt, setBoardedAt] = useState<number | null>(null);
  const [log, setLog] = useState<readonly LogEntry[]>([]);

  const passenger = useMemo(() => passengerName(), []);
  const taken = useMemo(() => occupiedSeats(ALL_SEATS, CABIN_SEED, LAVATORY_SEATS), []);

  const claimedSeat = useMemo(() => findSeat(claimed), [claimed]);
  const claimedZone = useMemo(
    () => CABIN_ZONES.find((z) => z.key === claimedSeat?.zone) ?? null,
    [claimedSeat],
  );

  const viewSeat = useMemo(() => representativeSeat(viewZone, viewPosition), [viewZone, viewPosition]);
  const viewZoneDef = CABIN_ZONES.find((z) => z.key === viewZone) ?? CABIN_ZONES[0];

  const nextId = useRef(0);
  const say = useCallback((text: string, tone: LogEntry['tone']) => {
    setLog((prev) => [{ id: nextId.current++, at: clockNow(), text, tone }, ...prev].slice(0, 12));
  }, []);

  useEffect(() => {
    say(CALLOUTS.boarded, 'pa');
  }, [say]);

  useEffect(() => {
    const id = setInterval(() => {
      const line = CHATTER[Math.floor(Math.random() * CHATTER.length)];
      say(line.text, line.tone);
    }, 7000);
    return () => clearInterval(id);
  }, [say]);

  /* Announcements that follow the aircraft, not the clock. */
  const wasLit = useRef({ oxygen: false, brace: false });
  useEffect(() => {
    if (lamps.oxygen && !wasLit.current.oxygen) say(CALLOUTS.oxygenOn, 'alert');
    if (!lamps.oxygen && wasLit.current.oxygen) say(CALLOUTS.oxygenOff, 'pa');
    if (lamps.brace && !wasLit.current.brace) say(CALLOUTS.brace, 'alert');
    wasLit.current = { oxygen: lamps.oxygen, brace: lamps.brace };
  }, [lamps.oxygen, lamps.brace, say]);

  /* Crossing an altitude band is worth an announcement of its own. */
  const wasBand = useRef(band.band);
  useEffect(() => {
    if (band.band !== wasBand.current) {
      const lines: Record<string, string> = {
        'above-clouds': 'We are on top. Cloud deck below us.',
        space: 'Cabin crew, the sky has run out. Sky is black.',
        moon: 'Ladies and gentlemen, we have reached the moon.',
        atmosphere: 'Back in the weather. Seat belt sign is on.',
      };
      say(lines[band.band] ?? '', band.band === 'atmosphere' ? 'alert' : 'pa');
      wasBand.current = band.band;
    }
  }, [band.band, say]);

  const flyMode = (next: FlightMode) => {
    setMode(next);
    feed.setMode(next);
    if (next === 'dive') say(CALLOUTS.dive, 'alert');
    if (next === 'climb') say(CALLOUTS.climb, 'pa');
    if (next === 'turbulence') say(CALLOUTS.turbulence, 'pa');
  };

  const walkTo = (zone: ZoneKey) => {
    setViewZone(zone);
    setCamera(zone === 'deck' ? 'deck' : 'seat');
    if (zone === 'deck') setFacing('forward');
  };

  const claim = (id: string, zoneKey: ZoneKey) => {
    const seat = findSeat(id);
    const first = claimed === null;
    setClaimed(id);
    if (first) setBoardedAt(tick.marketCap);
    // Claiming a seat walks you to it — the point is to see what you bought.
    setViewZone(zoneKey);
    setCamera(zoneKey === 'deck' ? 'deck' : 'seat');
    setFacing('forward');
    if (seat) setViewPosition(seat.position);
    const label = CABIN_ZONES.find((z) => z.key === zoneKey)?.className ?? '';
    say(first ? `Passenger seated in ${id}. ${label}.` : `Passenger reseated to ${id}.`, 'pa');
  };

  const lavatory = (LAVATORY_SEATS as readonly string[]).includes(viewSeat.id);

  return (
    <div className="relative min-h-[calc(100vh-var(--navbar-height,56px))] text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(1200px 800px at 50% -10%, #1B2231 0%, transparent 62%), linear-gradient(180deg, #0B0E14 0%, #070910 100%)',
          }}
        />
        <div className="sa-scanlines absolute inset-0 opacity-[0.09]" />
      </div>

      <section className="mx-auto max-w-6xl px-5 pb-24 pt-12 sm:px-6">
        <header className="text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.3em] text-seat-cyan">Flight FL350 · Nonstop</p>
          <h1 className="font-heading mt-1 text-4xl sm:text-5xl md:text-6xl">
            <span className="sa-glow-cerise text-seat-amber">Seat</span>{' '}
            <span className="sa-glow-cyan text-seat-cyan">Airways</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-blue-100/70">
            Your bag is your seat. Bigger bag, better seat. Seats are finite, so a bigger bag can take
            yours — you'll be reseated, and everyone will hear about it.
          </p>
        </header>

        {/* ── The view ── */}
        <div className={`mt-10 ${lamps.shaking ? 'sd-shake' : ''}`}>
          <ViewFrame
            label={
              camera === 'exterior'
                ? 'Outside · FL350'
                : camera === 'deck'
                  ? 'Flight deck'
                  : `${viewZoneDef.name} · ${viewSeat.id} · ${facing === 'forward' ? 'forward' : `looking ${facing}`}`
            }
            onZoomOutBeyond={camera === 'exterior' ? undefined : () => setCamera('exterior')}
            zoomOutHint="Zoom out of the aircraft"
            actions={
              camera === 'seat' ? (
                <div className="sd-chrome flex shrink-0 items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible" role="group" aria-label="Turn your head">
                  {FACINGS.map((f) => {
                    const on = facing === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setFacing(f.key)}
                        aria-pressed={on}
                        className={`shrink-0 whitespace-nowrap border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${
                          on
                            ? 'border-seat-cyan/70 bg-seat-cyan/15 text-white'
                            : 'border-white/12 bg-white/[0.03] text-blue-100/60 hover:border-white/25 hover:text-white'
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCamera('seat')}
                  className="shrink-0 whitespace-nowrap border border-white/12 bg-white/[0.03] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-blue-100/60 transition-colors hover:border-white/25 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan"
                >
                  Back to your seat
                </button>
              )
            }
          >
            {camera === 'exterior' ? (
              <ExteriorView
                feed={feed}
                sky={sky}
                band={band}
                taken={taken}
                claimed={claimedSeat}
                viewing={viewSeat}
              />
            ) : camera === 'deck' ? (
              <FlightDeck feed={feed} lamps={lamps} sky={sky} band={band} />
            ) : facing === 'forward' ? (
              <CabinView
                feed={feed}
                sky={sky}
                band={band}
                seat={viewSeat}
                zone={viewZoneDef}
                lavatory={lavatory}
                taken={taken}
              />
            ) : (
              <CabinSideView
                feed={feed}
                sky={sky}
                band={band}
                seat={viewSeat}
                zone={viewZoneDef}
                facing={facing}
                taken={taken}
              />
            )}
          </ViewFrame>
        </div>

        {/* ── Walk the aircraft ── */}
        <div className="mt-5 flex flex-col gap-3 border border-white/10 bg-[#141821]/70 px-4 py-4 backdrop-blur-sm sm:flex-row sm:items-center">
          <div className="sd-chrome -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <span className="mr-1 shrink-0 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/40">Walk the aircraft</span>
            <button
              type="button"
              onClick={() => setCamera('exterior')}
              aria-pressed={camera === 'exterior'}
              className={`shrink-0 whitespace-nowrap border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${
                camera === 'exterior'
                  ? 'border-seat-amber/70 bg-seat-amber/15 text-white'
                  : 'border-white/12 bg-white/[0.03] text-blue-100/60 hover:border-white/25 hover:text-white'
              }`}
            >
              Outside
            </button>
            {CABIN_ZONES.map((z) => {
              const on = viewZone === z.key;
              return (
                <button
                  key={z.key}
                  type="button"
                  onClick={() => walkTo(z.key)}
                  aria-pressed={on}
                  className={`shrink-0 whitespace-nowrap border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${
                    on
                      ? 'border-seat-amber/70 bg-seat-amber/15 text-white'
                      : 'border-white/12 bg-white/[0.03] text-blue-100/60 hover:border-white/25 hover:text-white'
                  }`}
                >
                  {z.name}
                </button>
              );
            })}
          </div>

          {camera === 'seat' && (
            <div className="sd-chrome -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:ml-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/40">Seat</span>
              {POSITIONS.map((p) => {
                const on = viewPosition === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setViewPosition(p.key)}
                    aria-pressed={on}
                    className={`shrink-0 whitespace-nowrap border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${
                      on
                        ? 'border-seat-cyan/70 bg-seat-cyan/15 text-white'
                        : 'border-white/12 bg-white/[0.03] text-blue-100/60 hover:border-white/25 hover:text-white'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Where the flight is ── */}
        <dl className="mt-4 grid grid-cols-2 gap-px border border-white/10 bg-white/10 sm:grid-cols-4">
          {[
            { k: 'Altitude', v: `${formatFeet(tick.marketCap)} ft`, s: formatCap(tick.marketCap) },
            { k: '24h', v: formatChange(tick.change24h), s: tick.change24h >= 0 ? 'Climbing' : 'Descending' },
            { k: 'Outside', v: sky.label, s: sky.live ? 'Live weather' : 'Modelled weather' },
            { k: 'Band', v: band.label, s: band.next ?? 'Nowhere higher to go' },
          ].map((cell) => (
            <div key={cell.k} className="bg-[#141821]/80 px-4 py-3.5">
              <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-100/40">{cell.k}</dt>
              <dd className="mt-1 text-base leading-snug text-white sm:text-lg">{cell.v}</dd>
              <dd className="mt-0.5 text-[11px] leading-snug text-blue-100/45">{cell.s}</dd>
            </div>
          ))}
        </dl>

        {/* Climb meter toward the next band */}
        <div className="mt-px border border-white/10 bg-[#141821]/80 px-4 py-3">
          <div className="flex items-baseline justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-blue-100/40">
            <span>{band.label}</span>
            <span>{band.next ?? 'The moon'}</span>
          </div>
          <div className="mt-2 h-1.5 w-full bg-white/[0.07]">
            <div
              className="h-full bg-gradient-to-r from-seat-cyan to-seat-amber transition-[width] duration-500"
              style={{ width: `${Math.max(1.5, band.toNext * 100)}%` }}
            />
          </div>
        </div>

        {/* ── Flight sim ── */}
        <div className="mt-4 flex flex-col gap-3 border border-white/10 bg-[#141821]/70 px-4 py-4 backdrop-blur-sm">
          <div className="sd-chrome -mx-1 flex items-center gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            <span className="mr-1 shrink-0 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/40">Flight sim</span>
            {MODES.map((m) => {
              const on = mode === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => flyMode(m.key)}
                  aria-pressed={on}
                  className={`shrink-0 whitespace-nowrap border px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${
                    on
                      ? 'border-seat-amber/70 bg-seat-amber/15 text-white'
                      : 'border-white/12 bg-white/[0.03] text-blue-100/60 hover:border-white/25 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          {feed.jumpTo && (
            <div className="sd-chrome -mx-1 flex items-center gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <span className="mr-1 shrink-0 text-[10px] font-bold uppercase tracking-[0.22em] text-blue-100/40">Market cap</span>
              {ALTITUDES.map((a) => (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => {
                    feed.jumpTo?.(a.cap);
                    setMode('cruise');
                  }}
                  className="shrink-0 whitespace-nowrap border border-white/12 bg-white/[0.03] px-3.5 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-100/60 transition-colors hover:border-seat-cyan/50 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan"
                >
                  {a.label}
                  <span className="ml-2 tabular-nums text-blue-100/35">{formatCap(a.cap)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <Annunciators lamps={lamps} />
        </div>

        {/* ── Cabin + pass ── */}
        <div className="mt-14 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div>
            <header className="border-b border-white/10 pb-4">
              <h2 className="font-heading text-3xl text-white sm:text-4xl">Cabin</h2>
              <p className="mt-1.5 text-sm text-blue-100/60">
                189 seats, and they fill from the front. Claim one and the view above becomes yours — 30B is
                always free, and always will be.
              </p>
            </header>
            <div className="mt-7">
              <SeatMap taken={taken} mine={claimed} onClaim={claim} />
            </div>
          </div>

          <div>
            <header className="border-b border-white/10 pb-4">
              <h2 className="font-heading text-3xl text-white sm:text-4xl">Your pass</h2>
              <p className="mt-1.5 text-sm text-blue-100/60">Screenshot it. It's the whole marketing budget.</p>
            </header>

            <div className="mt-7">
              <BoardingPass passenger={passenger} seat={claimed} zone={claimedZone} boardedAt={boardedAt} />
            </div>

            <div className="mt-8">
              <RadioLog entries={log} />
            </div>
          </div>
        </div>

        <div className="mt-16 text-center">
          <a
            href="#cabin"
            className="sa-shine inline-flex items-center gap-2 px-7 py-3 text-sm font-extrabold uppercase tracking-wide text-seat-night"
            style={{ background: '#FFB300' }}
          >
            Claim a seat <span aria-hidden>→</span>
          </a>
          <p className="mx-auto mt-5 max-w-2xl text-[11px] leading-relaxed text-blue-100/40">
            The horizon, the tapes, the lamps and the log all read one input — 24h price change — and the
            altitude is the market cap: $1M puts you above the clouds, $10M in space, $50M at the moon. The
            sky is real: your own time of day, and the weather where you are. The market feed is simulated
            for now, and swapping it is one file.
          </p>
        </div>
      </section>
    </div>
  );
}
