import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FlightDeck from './components/FlightDeck';
import CargoHold from './components/CargoHold';
import CheckIn from './components/CheckIn';
import Mark from './components/Mark';
import BoardingLadder from './components/BoardingLadder';
import ViewFrame from './components/ViewFrame';
import Annunciators from './components/Annunciators';
import SeatMap from './components/SeatMap';
import AdvertDialog from './components/AdvertDialog';
import BoardingPass from './components/BoardingPass';
import RadioLog, { type LogEntry } from './components/RadioLog';
import {
  ALL_SEATS,
  CABIN_ZONES,
  CALLOUTS,
  CHATTER,
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
} from './lib/flightModel';
import { useFlightState } from './lib/useFlightState';
import { useSky } from './lib/useSky';
import { useWallet } from './lib/useWallet';
import { holdingsSource, type Holding } from './lib/holdings';
import { berthFromManifest } from './lib/seatLadder';
import { useManifest } from './lib/useManifest';
import { MANIFEST_SIZE } from './lib/manifest';
import {
  houseAdverts,
  fetchPublished,
  hasPublishedWall,
  localBanners,
  type Banner,
  type BannerSet,
} from './lib/banners';

// The renderer and Three.js are the heaviest parts of the experience. Keeping
// them behind the view boundary lets the controls and live flight data become
// interactive immediately, rather than making the whole page wait on WebGL.
const CabinView3D = lazy(() => import('./components/CabinView3D'));
const ExteriorView = lazy(() => import('./components/ExteriorView'));

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
 * `exterior` is the default and where the page opens: the whole aeroplane,
 * from outside. `seat` is a step inward — sitting down, looking forward — and
 * is where clicking any seat on the wall takes you.
 */
type Camera = 'exterior' | 'deck' | 'seat' | 'hold';

const clockNow = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** The seat you would be shown when walking into a zone at a given position. */
function representativeSeat(zone: ZoneKey, position: SeatPosition): CabinSeat {
  const inZone = ALL_SEATS.filter((s) => s.zone === zone);
  return inZone.find((s) => s.position === position) ?? inZone[0];
}

/**
 * A control chip.
 *
 * Every strip on the page — head turn, walk the aircraft, seat position,
 * flight sim, altitude — is the same control, so it is written once. It used
 * to be the same forty-term class string copied six times, which is how the
 * strips had quietly drifted apart from one another.
 */
const chip = (on: boolean, accent: 'cyan' | 'amber' = 'cyan') =>
  `sa-chip${on ? ` sa-chip--on sa-chip--${accent}` : ''}`;

const SceneLoading = ({ exterior = false }: { exterior?: boolean }) => (
  <div
    className={`sa-view-loading sd-frame ${exterior ? 'sd-frame--wide' : ''}`}
    role="status"
    aria-live="polite"
  >
    <div className="sa-view-loading__mark" aria-hidden />
    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-seat-cyan">
      Preparing {exterior ? 'exterior' : 'cabin'} view
    </p>
  </div>
);

export default function App() {

  const feed = useMemo(() => createSimulatedFeed(), []);
  const { tick, lamps } = useFlightState(feed);
  const sky = useSky();
  const band = useMemo(() => bandFor(tick.marketCap), [tick.marketCap]);

  const [mode, setMode] = useState<FlightMode>('live');
  /* The page opens outside, on the whole aeroplane. It is the one frame that
     explains the premise without a caption — one plane, everyone in it — and
     every other camera is a step inward from it. */
  const [camera, setCamera] = useState<Camera>('exterior');
  const [facing, setFacing] = useState<Facing>('forward');
  /** Where you are sitting. Independent of where you are ticketed. */
  const [viewZone, setViewZone] = useState<ZoneKey>('economy');
  const [viewPosition, setViewPosition] = useState<SeatPosition>('window');
  const [boardedAt, setBoardedAt] = useState<number | null>(null);

  /* Check-in. The seat is not a choice: the wallet's holding decides it. */
  const wallet = useWallet();
  const [holding, setHolding] = useState<Holding | null>(null);
  const [loadingHolding, setLoadingHolding] = useState(false);
  /* Demo only: a stand-in holding, so the ladder can be seen working with no
     wallet installed. Cleared the moment a real one connects. */
  const [preview, setPreview] = useState<Holding | null>(null);
  const [log, setLog] = useState<readonly LogEntry[]>([]);

  const effectiveHolding = preview ?? holding;
  const seatKey = wallet.address ?? (preview ? 'SAMPLE-HOLDER' : null);

  /* Who is aboard. Seats go to the top holders and then run out, so the empty
     rows aft are the game: they are the seats nobody has out-held anyone for. */
  const manifest = useManifest(seatKey, effectiveHolding);
  const taken = manifest.seats;
  /* Holders who did not make the cut. */
  const belowCutoff = Math.max(0, tick.holders - manifest.entries.length);

  const berth = useMemo(
    () => berthFromManifest(manifest, seatKey, effectiveHolding?.balance ?? 0),
    [manifest, seatKey, effectiveHolding?.balance],
  );

  /* ── The wall ─────────────────────────────────────────────────────────
     Every seat is a square, so every held seat is a billboard. The published
     set wins over anything this browser has put up locally. */
  const [published, setPublished] = useState<BannerSet>({});
  const [local, setLocal] = useState<BannerSet>(() => localBanners.read());
  const [advertising, setAdvertising] = useState<string | null>(null);
  useEffect(() => {
    if (!hasPublishedWall) return;
    void fetchPublished().then(setPublished);
  }, []);
  /* Held seats with nothing on them yet carry the airline's own campaigns, the
     way unsold inventory does on a real aircraft. A holder's own upload, and
     the published set, both beat them. */
  const house = useMemo(
    () => houseAdverts(manifest.entries.slice(0, 16).map((e) => e.seat.id)),
    [manifest.entries],
  );
  const banners = useMemo(
    () => ({ ...house, ...local, ...published }),
    [house, local, published],
  );
  const claimed = berth.seat?.id ?? null;
  const claimedSeat = berth.seat;
  const claimedZone = useMemo(
    () => CABIN_ZONES.find((z) => z.key === claimedSeat?.zone) ?? null,
    [claimedSeat],
  );
  const passenger = wallet.address
    ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
    : preview
      ? 'Sample holder'
      : 'Standby';

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

  useEffect(() => {
    if (!wallet.address) {
      setHolding(null);
      return;
    }
    setPreview(null);
    let cancelled = false;
    const read = async () => {
      setLoadingHolding(true);
      const next = await holdingsSource.read(wallet.address as string);
      if (!cancelled && next) setHolding(next);
      if (!cancelled) setLoadingHolding(false);
    };
    read();
    // A bag can grow while the page is open; so can somebody else's.
    const id = setInterval(read, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [wallet.address]);

  /* Being seated is an event: the PA says so, and the camera walks you there. */
  const lastSeat = useRef<string | null>(null);
  useEffect(() => {
    const boarded = Boolean(wallet.address) || Boolean(preview);
    if (berth.hold && boarded && lastSeat.current !== 'HOLD') {
      lastSeat.current = 'HOLD';
      setCamera('hold');
      say('Passenger assigned to the cargo hold. Mind the step.', 'alert');
      return;
    }
    const id = berth.seat?.id ?? null;
    if (!id || id === lastSeat.current) return;
    const first = lastSeat.current === null;
    lastSeat.current = id;
    if (boardedAt === null) setBoardedAt(tick.marketCap);
    setViewZone(berth.seat!.zone);
    setViewPosition(berth.seat!.position);
    setCamera(berth.seat!.zone === 'deck' ? 'deck' : 'seat');
    setFacing('forward');
    say(
      first
        ? `Passenger seated in ${id}. ${berth.rung}.`
        : `Passenger reseated to ${id}. ${berth.rung}.`,
      'pa',
    );
  }, [berth.seat?.id, berth.hold, berth.rung, wallet.address, preview, boardedAt, tick.marketCap, say]);

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

  /* The view lives at the top of the page and the wall lives below it, so
     clicking a seat has to bring the two back together — otherwise the camera
     moves somewhere nobody is looking. */
  const viewportRef = useRef<HTMLDivElement>(null);
  const showView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    // Only if it is actually off screen: scrolling a view somebody is already
    // looking at is worse than not scrolling at all.
    if (top > 40 && top < window.innerHeight - 160) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  /** Walk the camera to a seat. Looking is free; sitting there is not. */
  const visit = (id: string, zoneKey: ZoneKey) => {
    const seat = findSeat(id);
    setViewZone(zoneKey);
    setCamera(zoneKey === 'deck' ? 'deck' : 'seat');
    setFacing('forward');
    if (seat) setViewPosition(seat.position);
    showView();
  };


  return (
    <div className="sa-app relative min-h-screen text-white">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="sa-ground absolute inset-0" />
        <div className="sa-scanlines absolute inset-0 opacity-[0.03]" />
      </div>

      <a href="#wall" className="sa-skip">Skip to the seat map</a>

      {/* ── Gate sign ──────────────────────────────────────────────────
          An airline's vernacular is a brand bar over a strip of flight data,
          set in figures you can read across a concourse. It stays at the top
          of the screen rather than scrolling away, because the numbers are the
          thing that is live — you should be able to see the altitude move
          while you are reading the seat map. */}
      <header className="sa-topbar sticky top-0 z-40">
        <div className="mx-auto flex max-w-[94rem] flex-wrap items-center gap-x-7 gap-y-2 px-5 py-2.5 sm:px-8">
          <a href="#top" className="flex shrink-0 items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-seat-cyan">
            <Mark size={30} background="none" title="SEAT AIRWAYS" />
            <span className="whitespace-nowrap font-heading text-lg leading-none text-white">Seat Airways</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-white/40 sm:inline">
              FL350 · Nonstop
            </span>
          </a>

          <dl className="sd-chrome ml-auto flex w-full min-w-0 items-center justify-between gap-x-7 overflow-x-auto sm:w-auto sm:max-w-[70%] sm:justify-start">
            {[
              { k: 'Altitude', v: `${formatFeet(tick.marketCap)} ft`, tone: 'text-seat-amber' },
              { k: 'Market cap', v: formatCap(tick.marketCap), tone: 'text-white' },
              { k: '24h', v: formatChange(tick.change24h), tone: tick.change24h >= 0 ? 'text-seat-cyan' : 'text-red-300' },
              { k: 'Seated', v: `${manifest.entries.length}/${MANIFEST_SIZE}`, tone: 'text-white' },
            ].map((f) => (
              <div key={f.k} className="shrink-0">
                <dt className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-blue-100/40">{f.k}</dt>
                <dd className={`font-mono text-[15px] leading-tight ${f.tone}`}>{f.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <main id="top" className="sa-shell mx-auto max-w-[94rem] px-5 pb-28 sm:px-8">
        {/* ══════════════════════════════════════════════════════════════
            01 · The aeroplane
            The page opens on the whole aircraft, from outside, because that
            is the sentence the product is: one plane, everyone in it. Every
            other camera on the page is a step inward from this frame.
            ══════════════════════════════════════════════════════════════ */}
        <section className="sa-hero pt-10 sm:pt-14" aria-labelledby="hero-title">
          <p className="sa-eyebrow">
            <span className="sa-live" aria-hidden />
            Live · FL350 · {band.label}
          </p>
          <div className="mt-4 grid gap-x-14 gap-y-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-end">
            <h1 id="hero-title" className="sa-display text-white">
              One plane.
              <br />
              Everyone&apos;s in&nbsp;it.
            </h1>
            <div className="lg:pb-3">
              <p className="max-w-xl text-[15px] leading-relaxed text-blue-100/70 sm:text-base">
                A flight simulator flown by one number. Market cap is altitude and the 24-hour change is
                attitude, so the aeroplane you are looking at is the chart. Inside it, thirty rows of seats go
                to the top holders in order — and every one of them is a billboard.
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a href="#wall" className="sa-cta sa-shine">
                  Claim a seat <span aria-hidden>→</span>
                </a>
                <button
                  type="button"
                  onClick={() => { setCamera('seat'); setFacing('forward'); showView(); }}
                  className="sa-ghost"
                >
                  Step inside the cabin
                </button>
              </div>
            </div>
          </div>

          {/* ── The view ── */}
          <div ref={viewportRef} className={`mt-9 scroll-mt-24 ${lamps.shaking ? 'sa-viewport sd-shake' : 'sa-viewport'}`}>
            <ViewFrame
              label={
                camera === 'exterior'
                  ? `Outside · ${band.label}`
                  : camera === 'hold'
                    ? 'Cargo hold · below the floor'
                    : camera === 'deck'
                      ? 'Flight deck'
                      : `${viewZoneDef.name} · ${viewSeat.id} · ${facing === 'forward' ? 'forward' : `looking ${facing}`}`
              }
              onZoomOutBeyond={camera === 'exterior' ? undefined : () => setCamera('exterior')}
              zoomOutHint="Zoom out of the aircraft"
              actions={
                camera === 'seat' ? (
                  <div className="sd-chrome flex shrink-0 items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible" role="group" aria-label="Turn your head">
                    {FACINGS.map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setFacing(f.key)}
                        aria-pressed={facing === f.key}
                        className={chip(facing === f.key)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button type="button" onClick={() => setCamera('seat')} className={chip(false)}>
                    {camera === 'exterior' ? 'Step inside' : 'Back to your seat'}
                  </button>
                )
              }
            >
              {camera === 'hold' ? (
                <CargoHold feed={feed} band={band} belowCutoff={belowCutoff} />
              ) : camera === 'exterior' ? (
                <Suspense fallback={<SceneLoading exterior />}>
                  <ExteriorView feed={feed} sky={sky} band={band} taken={taken} claimed={claimedSeat} viewing={viewSeat} />
                </Suspense>
              ) : camera === 'deck' ? (
                <FlightDeck feed={feed} lamps={lamps} sky={sky} band={band} />
              ) : (
                <Suspense fallback={<SceneLoading />}>
                  <CabinView3D feed={feed} sky={sky} band={band} seat={viewSeat} zone={viewZoneDef} facing={facing} taken={taken} />
                </Suspense>
              )}
            </ViewFrame>
          </div>

          {/* ── Walk the aircraft ── */}
          <div className="sa-panel sa-panel--cyan mt-3 flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
            <div className="sd-chrome -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <span className="sa-strip-label">Walk the aircraft</span>
              <button type="button" onClick={() => setCamera('exterior')} aria-pressed={camera === 'exterior'} className={chip(camera === 'exterior')}>
                Outside
              </button>
              {CABIN_ZONES.map((z) => (
                <button
                  key={z.key}
                  type="button"
                  onClick={() => walkTo(z.key)}
                  aria-pressed={camera !== 'exterior' && camera !== 'hold' && viewZone === z.key}
                  className={chip(camera !== 'exterior' && camera !== 'hold' && viewZone === z.key)}
                >
                  {z.name}
                </button>
              ))}
              <button type="button" onClick={() => setCamera('hold')} aria-pressed={camera === 'hold'} className={chip(camera === 'hold')}>
                Cargo hold
              </button>
            </div>

            {camera === 'seat' && (
              <div className="sd-chrome -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:ml-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
                <span className="sa-strip-label">Seat</span>
                {POSITIONS.map((pos) => (
                  <button
                    key={pos.key}
                    type="button"
                    onClick={() => setViewPosition(pos.key)}
                    aria-pressed={viewPosition === pos.key}
                    className={chip(viewPosition === pos.key)}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Where the flight is ── */}
          <section className="sa-flight-state mt-3" aria-label="Flight state">
            <dl className="sa-flight-summary grid grid-cols-2 gap-px bg-white/10 sm:grid-cols-4">
              {[
                { k: 'Altitude', v: `${formatFeet(tick.marketCap)} ft`, s: formatCap(tick.marketCap) },
                { k: '24h', v: formatChange(tick.change24h), s: tick.change24h >= 0 ? 'Climbing' : 'Descending' },
                { k: 'Outside', v: sky.label, s: sky.live ? 'Live weather' : 'Modelled weather' },
                { k: 'Band', v: band.label, s: band.next ?? 'Nowhere higher to go' },
              ].map((cell) => (
                <div key={cell.k} className="px-4 py-3.5">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-100/40">{cell.k}</dt>
                  <dd className="mt-1 text-base leading-snug text-white sm:text-lg">{cell.v}</dd>
                  <dd className="mt-0.5 text-[11px] leading-snug text-blue-100/45">{cell.s}</dd>
                </div>
              ))}
            </dl>

            {/* Climb meter toward the next band */}
            <div className="sa-progress px-4 py-3">
              <div className="flex items-baseline justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-blue-100/40">
                <span>{band.label}</span>
                <span>{band.next ?? 'The moon'}</span>
              </div>
              <div className="mt-2 h-1.5 w-full bg-white/[0.07]">
                <div
                  className="sa-climb-fill h-full bg-gradient-to-r from-seat-cyan to-seat-amber transition-[width] duration-500"
                  style={{ width: `${Math.max(1.5, band.toNext * 100)}%` }}
                />
              </div>
            </div>

            <Annunciators lamps={lamps} />
          </section>

          {/* ── Flight sim ── */}
          <div className="sa-panel sa-panel--amber mt-3 flex flex-col gap-3 px-4 py-3.5">
            <div className="sd-chrome -mx-1 flex items-center gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              <span className="sa-strip-label">Flight sim</span>
              {MODES.map((m) => (
                <button key={m.key} type="button" onClick={() => flyMode(m.key)} aria-pressed={mode === m.key} className={chip(mode === m.key, 'amber')}>
                  {m.label}
                </button>
              ))}
            </div>

            {feed.jumpTo && (
              <div className="sd-chrome -mx-1 flex items-center gap-2.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
                <span className="sa-strip-label">Market cap</span>
                {ALTITUDES.map((alt) => (
                  <button
                    key={alt.label}
                    type="button"
                    onClick={() => { feed.jumpTo?.(alt.cap); setMode('cruise'); }}
                    className={chip(false)}
                  >
                    {alt.label}
                    <span className="ml-2 tabular-nums text-blue-100/35">{formatCap(alt.cap)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            02 · The wall
            The seat map is the second thing on the page and the reason for
            the first. Every seat is a square, every held square is a
            billboard, and the front of the cabin is the front of the wall —
            so it is given the width, the ground and the type to say so.
            ══════════════════════════════════════════════════════════════ */}
        <section id="wall" className="sa-wall scroll-mt-20" aria-labelledby="wall-title">
          <div className="sa-wall__inner">
            <header className="sa-section-head">
              <p className="sa-eyebrow sa-eyebrow--amber">
                <span className="sa-eyebrow__no">02</span> The wall
              </p>
              <h2 id="wall-title" className="sa-display sa-display--2 mt-3 text-white">
                Every seat is a billboard
              </h2>
              <div className="mt-5 grid gap-x-12 gap-y-4 lg:grid-cols-2">
                <p className="text-[15px] leading-relaxed text-blue-100/70">
                  Seats are not booked. The top {MANIFEST_SIZE} holders are seated in rank order and the rest
                  of the aeroplane stays empty, so the only way to move forward is to out-hold whoever is
                  already there.
                </p>
                <p className="text-[15px] leading-relaxed text-blue-100/70">
                  Each seat is a square, and a square somebody holds is theirs to fill: a 1:1 image, shown here
                  and on the seat itself. Row 1 is the best placement on the aircraft, and it is not for sale at
                  any price — only for holding.
                </p>
              </div>
            </header>

            <ol className="sa-steps">
              {[
                { n: '01', h: 'Hold', b: 'Connect a wallet. Your balance is your bag, and nothing else counts.' },
                { n: '02', h: 'Get seated', b: 'The manifest ranks every holder and seats them from row 1 back. Out-hold someone and you take their seat.' },
                { n: '03', h: 'Advertise', b: 'Put a square image on the seat you hold. It goes up on the wall, at the position you earned.' },
              ].map((step) => (
                <li key={step.n} className="sa-step">
                  <span className="sa-step__no">{step.n}</span>
                  <h3 className="sa-step__h">{step.h}</h3>
                  <p className="sa-step__b">{step.b}</p>
                </li>
              ))}
            </ol>

            <div className="mt-10">
              <SeatMap
                manifest={manifest}
                banners={banners}
                mine={claimed}
                canAdvertise={claimed}
                onVisit={visit}
                onAdvertise={setAdvertising}
              />
            </div>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            03 · Your pass
            ══════════════════════════════════════════════════════════════ */}
        <section className="pt-20 sm:pt-24" aria-labelledby="pass-title">
          <header className="sa-section-head">
            <p className="sa-eyebrow">
              <span className="sa-eyebrow__no">03</span> Check in
            </p>
            <h2 id="pass-title" className="sa-display sa-display--2 mt-3 text-white">
              The aircraft seats you
            </h2>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-blue-100/70">
              You do not pick a seat. Connect a wallet, and where you sit is whatever your holding says it is —
              recomputed the moment anybody else&apos;s changes.
            </p>
          </header>

          <div className="mt-9 grid gap-6 lg:grid-cols-3 lg:items-start">
            <div className="flex flex-col gap-6">
              <CheckIn
                wallet={wallet}
                holding={effectiveHolding}
                berth={berth}
                live={holdingsSource.live}
                loading={loadingHolding}
                previewing={Boolean(preview)}
                onPreview={(share) => {
                  const supply = 1_000_000_000;
                  setPreview({ balance: share * supply, supply, share, live: false });
                }}
                onClearPreview={() => {
                  setPreview(null);
                  lastSeat.current = null;
                }}
              />
              <BoardingPass passenger={passenger} seat={claimed} zone={claimedZone} boardedAt={boardedAt} />
            </div>

            <BoardingLadder
              berth={berth}
              holding={effectiveHolding}
              address={seatKey}
              manifestSize={manifest.entries.length}
            />

            <RadioLog entries={log} />
          </div>
        </section>

        {/* ── Close ── */}
        <div className="sa-close mt-20 sm:mt-24">
          <Mark size={34} background="none" />
          <p className="sa-close__line">One plane. Everyone&apos;s in it.</p>
          <a href="#wall" className="sa-cta sa-shine mt-2">
            Claim a seat <span aria-hidden>→</span>
          </a>
          <p className="sa-close__note">
            The horizon, the tapes, the lamps and the log all read one input — the 24-hour price change — and
            the altitude is the market cap: $1M puts you above the clouds, $10M in space, $50M at the moon. The
            sky is real: your own time of day, and the weather where you are. The market feed on this
            deployment is simulated, and every figure it produces is labelled as such.
          </p>
        </div>
      </main>

      {advertising && (
        <AdvertDialog
          seat={advertising}
          current={banners[advertising] ?? null}
          onSave={(banner: Banner) => {
            if (!localBanners.put(advertising, banner)) {
              return 'This browser would not store that image. Try a smaller one.';
            }
            setLocal(localBanners.read());
            say(`Advert up on seat ${advertising}.`, 'pa');
            return null;
          }}
          onClear={() => {
            localBanners.clear(advertising);
            setLocal(localBanners.read());
          }}
          onClose={() => setAdvertising(null)}
        />
      )}
    </div>
  );
}
