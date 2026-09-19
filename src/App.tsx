import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FlightDeck from './components/FlightDeck';
import CargoHold from './components/CargoHold';
import CheckIn from './components/CheckIn';
import Mark from './components/Mark';
import ContractBar from './components/ContractBar';
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
import { INITIAL_TICK } from './lib/flightFeed';
import { createLiveFeed } from './lib/marketFeed';
import {
  bandFor,
  formatCap,
  formatChange,
  formatFeet,
} from './lib/flightModel';
import { useFlightState } from './lib/useFlightState';
import { useAircraftAudio } from './lib/useAircraftAudio';
import { useSky } from './lib/useSky';
import { useWallet } from './lib/useWallet';
import { holdingsSource, type Holding } from './lib/holdings';
import { berthFromManifest } from './lib/seatLadder';
import { useManifest } from './lib/useManifest';
import { MANIFEST_SIZE } from './lib/manifest';
import {
  houseAdverts,
  fetchPublished,
  fetchOwnerBanners,
  canPublish,
  publishBanner,
  ServerUnreachable,
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
 * SEAT AIRLINES — the cabin.
 *
 * One number flies the whole page. The 5m change sets the aircraft's attitude
 * and the market cap is its altitude: $1M puts you on top of the cloud deck,
 * $10M turns the sky black, $50M is the moon. The sky itself is real — the
 * visitor's own time of day, and the weather where they are.
 *
 * The aircraft is walkable. Every zone has its own view, and within a zone the
 * window, middle and aisle seats see genuinely different things, because that
 * is the ladder the whole premise rests on.
 */

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
    <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7FE3F7]">
      Preparing {exterior ? 'exterior' : 'cabin'} view
    </p>
  </div>
);

export default function App() {

  /* One feed, reading the market. There is no simulator behind it and no
     flight-sim input in front of it: an aircraft that can be flown by hand is
     not reporting anything. */
  const feed = useMemo(() => createLiveFeed(INITIAL_TICK), []);
  const { tick, lamps } = useFlightState(feed);
  const sky = useSky();
  const band = useMemo(() => bandFor(tick.marketCap), [tick.marketCap]);
  const aircraftAudio = useAircraftAudio(lamps, tick.change5m, band.band);

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
  const [log, setLog] = useState<readonly LogEntry[]>([]);

  const seatKey = wallet.address;

  /* Who is aboard. Seats go to the top holders and then run out, so the empty
     rows aft are the game: they are the seats nobody has out-held anyone for. */
  const manifest = useManifest(seatKey, holding);
  const taken = manifest.seats;
  /* Holders who did not make the cut. */
  const belowCutoff = Math.max(0, tick.holders - manifest.entries.length);

  const berth = useMemo(
    () => berthFromManifest(manifest, seatKey, holding?.balance ?? 0),
    [manifest, seatKey, holding?.balance],
  );

  /* ── The wall ─────────────────────────────────────────────────────────
     Every seat is a square, so every held seat is a billboard. The published
     set wins over anything this browser has put up locally. */
  const [published, setPublished] = useState<BannerSet>({});
  /* The self-serve wall arrives keyed by wallet rather than by seat, because
     the server that stores it has no idea what a seat is. Resolving one to
     the other is this page's job — it is already holding the manifest that
     answers it. */
  const [byOwner, setByOwner] = useState<BannerSet>({});
  const [local, setLocal] = useState<BannerSet>(() => localBanners.read());
  const [advertising, setAdvertising] = useState<string | null>(null);
  const reloadWall = useCallback(() => {
    if (hasPublishedWall) void fetchPublished().then(setPublished);
    if (canPublish) void fetchOwnerBanners().then(setByOwner);
  }, []);
  useEffect(() => {
    reloadWall();
    // A wall somebody else is also publishing to should not need a refresh.
    const id = setInterval(reloadWall, 60_000);
    return () => clearInterval(id);
  }, [reloadWall]);

  /* Wallet → seat, through the manifest. An advert follows its holder: get
     out-held from 3A to 7C and it moves with you, and drop off the manifest
     altogether and it comes down, with nothing to clean up. */
  const ownerSeats = useMemo(() => {
    const out: Record<string, Banner> = {};
    for (const entry of manifest.entries) {
      const banner = byOwner[entry.address];
      if (banner) out[entry.seat.id] = banner;
    }
    return out;
  }, [byOwner, manifest.entries]);
  /* Held seats with nothing on them yet carry the airline's own campaigns, the
     way unsold inventory does on a real aircraft. A holder's own upload, and
     the published set, both beat them. */
  const house = useMemo(
    () => houseAdverts(manifest.entries.map((e) => e.seat.id)),
    [manifest.entries],
  );
  const banners = useMemo(
    () => ({ ...house, ...local, ...ownerSeats, ...published }),
    [house, local, ownerSeats, published],
  );
  /* Just the images, keyed by seat, for the screens in the cabin: the 3D view
     has no business knowing what a Banner is. */
  const advertImages = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [seat, banner] of Object.entries(banners)) out[seat] = banner.image;
    return out;
  }, [banners]);
  const claimed = berth.seat?.id ?? null;
  const claimedSeat = berth.seat;
  const claimedZone = useMemo(
    () => CABIN_ZONES.find((z) => z.key === claimedSeat?.zone) ?? null,
    [claimedSeat],
  );
  const passenger = wallet.address
    ? `${wallet.address.slice(0, 4)}…${wallet.address.slice(-4)}`
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
    const boarded = Boolean(wallet.address);
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
  }, [berth.seat?.id, berth.hold, berth.rung, wallet.address, boardedAt, tick.marketCap, say]);

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
  const visit = useCallback((id: string, zoneKey: ZoneKey) => {
    const seat = findSeat(id);
    setViewZone(zoneKey);
    setCamera(zoneKey === 'deck' ? 'deck' : 'seat');
    setFacing('forward');
    if (seat) setViewPosition(seat.position);
    showView();
  }, [showView]);


  return (
    <div className="sa-app relative min-h-screen text-ui-ink">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="sa-ground absolute inset-0" />
      </div>

      <a href="#wall" className="sa-skip">Skip to the seat map</a>

      <ContractBar />

      {/* ── Gate sign ──────────────────────────────────────────────────
          An airline's vernacular is a brand bar over a strip of flight data,
          set in figures you can read across a concourse. It stays at the top
          of the screen rather than scrolling away, because the numbers are the
          thing that is live — you should be able to see the altitude move
          while you are reading the seat map. */}
      <header className="sa-topbar sticky top-0 z-40">
        <div className="mx-auto flex max-w-[94rem] flex-wrap items-center gap-x-7 gap-y-2 px-5 py-2.5 sm:px-8">
          <a href="#top" className="flex shrink-0 items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ui-blue">
            <Mark size={30} background="none" color="#0087EA" title="SEAT AIRLINES" />
            <span className="whitespace-nowrap font-heading text-lg leading-none text-ui-ink">Seat Airlines</span>
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.22em] text-ui-faint sm:inline">
              SA350 · Nonstop
            </span>
          </a>

          <dl className="sd-chrome ml-auto flex w-full min-w-0 items-center justify-between gap-x-7 overflow-x-auto sm:w-auto sm:max-w-[70%] sm:justify-start">
            {[
              { k: 'Altitude', v: `${formatFeet(tick.marketCap)} ft`, tone: 'text-ui-deep' },
              { k: 'Market cap', v: formatCap(tick.marketCap), tone: 'text-ui-ink' },
              /* Direction is the one thing on the page a single accent cannot
                 carry, so it keeps a sign as well as a colour. */
              { k: '5m', v: formatChange(tick.change5m), tone: tick.change5m >= 0 ? 'text-ui-deep' : 'text-ui-soft' },
              { k: 'Seated', v: `${manifest.entries.length}/${MANIFEST_SIZE}`, tone: 'text-ui-ink' },
            ].map((f) => (
              <div key={f.k} className="sa-topbar__fig shrink-0">
                <dt className="text-[8.5px] font-semibold uppercase tracking-[0.2em] text-ui-faint">{f.k}</dt>
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
            <span className="sa-eyebrow__no">01</span> The aeroplane
            <span className="sa-eyebrow__live">
              <span className="sa-live" aria-hidden />
              Live · SA350 · {band.label}
            </span>
          </p>
          <div className="mt-4 grid gap-x-14 gap-y-6 lg:grid-cols-[minmax(0,1.618fr)_minmax(0,1fr)] lg:items-end">
            <h1 id="hero-title" className="sa-display">
              One plane.
              <br />
              Everyone&apos;s in&nbsp;it.
            </h1>
            <div className="lg:pb-3">
              <p className="sa-lead">
                A flight simulator flown by one number. Market cap is altitude and the 5-minute change is
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
                <button
                  type="button"
                  onClick={aircraftAudio.toggle}
                  aria-pressed={aircraftAudio.enabled}
                  className={chip(aircraftAudio.enabled)}
                  title="Enable engine, airflow, cabin, and warning sounds"
                >
                  {aircraftAudio.enabled ? 'Sound on' : 'Sound off'}
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
                  <CabinView3D
                    feed={feed}
                    sky={sky}
                    band={band}
                    seat={viewSeat}
                    zone={viewZoneDef}
                    facing={facing}
                    taken={taken}
                    adverts={advertImages}
                  />
                </Suspense>
              )}
            </ViewFrame>
          </div>

          {/* ── The instrument deck ──────────────────────────────────────
              Walk, state and lamps are three readings of one aircraft, so they
              are one panel under the window divided by hairlines, rather than
              three cards floating a few pixels apart. */}
          <div className="sa-deck mt-3">
          {/* ── Walk the aircraft ── */}
          <div className="sa-deck__strip sa-deck__strip--cyan flex-col sm:flex-row sm:items-center">
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
          <section className="sa-flight-state" aria-label="Flight state">
            <dl className="sa-flight-summary grid grid-cols-2 sm:grid-cols-4">
              {[
                { k: 'Altitude', v: `${formatFeet(tick.marketCap)} ft`, s: formatCap(tick.marketCap) },
                { k: '5m', v: formatChange(tick.change5m), s: tick.change5m >= 0 ? 'Climbing' : 'Descending' },
                { k: 'Outside', v: sky.label, s: sky.live ? 'Live weather' : 'Modelled weather' },
                { k: 'Band', v: band.label, s: band.next ?? 'Nowhere higher to go' },
              ].map((cell) => (
                <div key={cell.k} className="px-4 py-3.5">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.2em] text-ui-faint">{cell.k}</dt>
                  <dd className="mt-1 text-base font-semibold leading-snug text-ui-ink sm:text-lg">{cell.v}</dd>
                  <dd className="mt-0.5 text-[11px] leading-snug text-ui-soft">{cell.s}</dd>
                </div>
              ))}
            </dl>

            {/* Climb meter toward the next band */}
            <div className="sa-progress px-4 py-3">
              <div className="flex items-baseline justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-ui-faint">
                <span>{band.label}</span>
                <span>{band.next ?? 'The moon'}</span>
              </div>
              <div className="sa-track mt-2 h-2 w-full">
                <div
                  className="sa-climb-fill h-full transition-[width] duration-500"
                  style={{ width: `${Math.max(1.5, band.toNext * 100)}%` }}
                />
              </div>
            </div>

            <Annunciators lamps={lamps} />
          </section>
          </div>
        </section>

        {/* ══════════════════════════════════════════════════════════════
            02 · The wall
            The seat map is the second thing on the page and the reason for
            the first. Every seat is a square, every held square is a
            billboard, and the front of the cabin is the front of the wall —
            so it is given the width, the ground and the type to say so.
            ══════════════════════════════════════════════════════════════ */}
        <section id="wall" className="sa-wall scroll-mt-24" aria-labelledby="wall-title">
          <div className="sa-wall__inner">
            <header className="sa-section-head">
              <p className="sa-eyebrow sa-eyebrow--amber">
                <span className="sa-eyebrow__no">02</span> The wall
              </p>
              <h2 id="wall-title" className="sa-display sa-display--2 mt-3">
                Every seat is a billboard
              </h2>
              <div className="mt-5 grid gap-x-12 gap-y-4 lg:grid-cols-2">
                <p className="sa-lead">
                  Seats are not booked. The top {MANIFEST_SIZE} holders are seated in rank order and the rest
                  of the aeroplane stays empty, so the only way to move forward is to out-hold whoever is
                  already there.
                </p>
                <p className="sa-lead">
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
        <section id="check-in" className="sa-section scroll-mt-24" aria-labelledby="pass-title">
          <header className="sa-section-head">
            <p className="sa-eyebrow">
              <span className="sa-eyebrow__no">03</span> Check in
            </p>
            <h2 id="pass-title" className="sa-display sa-display--2 mt-3">
              The aircraft seats you
            </h2>
            <p className="sa-lead mt-4">
              You do not pick a seat. Connect a wallet, and where you sit is whatever your holding says it is —
              recomputed the moment anybody else&apos;s changes.
            </p>
          </header>

          {/* Two columns, each a pairing rather than a leftover: on the left
              what the aircraft does with your holding, on the right what you
              come away with. Three columns left the radio 176px tall beside an
              832px neighbour — a hole, not a composition. Stretched to a common
              height with the radio taking up the slack, the section ends on a
              line. */}
          <div className="mt-9 grid gap-6 lg:grid-cols-[minmax(0,1.382fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-6">
              <CheckIn wallet={wallet} holding={holding} berth={berth} loading={loadingHolding} />
              <BoardingLadder
                berth={berth}
                holding={holding}
                address={seatKey}
                manifestSize={manifest.entries.length}
              />
            </div>

            <div className="flex flex-col gap-6">
              <BoardingPass passenger={passenger} seat={claimed} zone={claimedZone} boardedAt={boardedAt} />
              {/* The log takes whatever height the column has left, so a live
                  panel is as tall as the page can make it rather than a stub. */}
              <div className="min-h-[14rem] flex-1">
                <RadioLog entries={log} />
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ══════════════════════════════════════════════════════════════
          The footer
          A page that simply stops reads as a page that ran out. This one
          lands: the premise once more over the mark, then the three things
          somebody who has read to the bottom still wants — where else to go,
          what the aeroplane is actually reading, and whether any of it is
          live. The status column is generated from the same values the
          instruments are, so the footer cannot go stale against the page
          above it.
          ══════════════════════════════════════════════════════════════ */}
      <footer className="sa-footer">
        <div className="mx-auto max-w-[94rem] px-5 sm:px-8">
          <div className="sa-close">
            <Mark size={34} background="none" color="#0087EA" />
            <p className="sa-close__line">One plane. Everyone&apos;s in it.</p>
            <a href="#wall" className="sa-cta sa-shine mt-2">
              Claim a seat <span aria-hidden>→</span>
            </a>
          </div>

          <div className="sa-footer__grid">
            <nav aria-labelledby="foot-aircraft">
              <p className="sa-footer__h" id="foot-aircraft">The aircraft</p>
              <div className="sa-footer__list">
                <a href="#top">Outside · the whole aeroplane</a>
                <a href="#wall">The wall · {MANIFEST_SIZE} seats, {manifest.open} open</a>
                <a href="#check-in">Check in · where you sit</a>
              </div>
            </nav>

            <div>
              <p className="sa-footer__h">What flies it</p>
              <dl className="sa-footer__list">
                <div><dt>Market cap</dt><dd>Altitude</dd></div>
                <div><dt>5m change</dt><dd>Pitch, and its rate is bank</dd></div>
                <div><dt>Holders</dt><dd>Souls on board</dd></div>
                <div><dt>Your bag</dt><dd>Your seat</dd></div>
              </dl>
            </div>

            <div>
              <p className="sa-footer__h">Reading now</p>
              <dl className="sa-footer__list">
                <div><dt>Altitude</dt><dd className="font-mono">{formatFeet(tick.marketCap)} ft</dd></div>
                <div><dt>Band</dt><dd>{band.label}</dd></div>
                <div><dt>Outside</dt><dd>{sky.live ? 'Live weather' : 'Modelled sky'}</dd></div>
                <div><dt>Souls on board</dt><dd className="font-mono">{tick.holders || '—'}</dd></div>
              </dl>
            </div>
          </div>

          <p className="sa-close__note">
            The horizon, the tapes, the lamps and the log all read one input — the 5-minute price change — and
            the altitude is the market cap: $1M puts you above the clouds, $10M in space, $50M at the moon. The
            sky is real: your own time of day, and the weather where you are.{' '}
            The market feed is live, and the seat ladder is read from the chain.
          </p>

          <div className="sa-footer__bar">
            <span>Seat Airlines · SA350 · Nonstop</span>
            <span>Your bag is your seat</span>
          </div>
        </div>
      </footer>

      {advertising && (
        <AdvertDialog
          seat={advertising}
          current={banners[advertising] ?? null}
          shared={canPublish && Boolean(wallet.address)}
          onSave={async (banner: Banner) => {
            /* With a server configured and a wallet connected, the advert goes
               up for everybody — signed, so the wall can prove the seat was
               the publisher's. Without either, it stays in this browser and
               the dialog says as much rather than implying otherwise. */
            if (canPublish && wallet.address) {
              try {
                const { image } = await publishBanner({
                  owner: wallet.address,
                  image: banner.image,
                  alt: banner.alt,
                  href: banner.href,
                  sign: wallet.signMessage,
                });
                setByOwner((prev) => ({
                  ...prev,
                  [wallet.address as string]: { ...banner, image, published: true, owner: wallet.address as string },
                }));
                say(`Advert up on seat ${advertising}.`, 'pa');
                return null;
              } catch (e) {
                /* The server never answered — not deployed, not reachable,
                   or not allowing this origin. The advert is not at fault
                   and neither is the holder, who has already signed for it,
                   so it goes up in this browser rather than evaporating, and
                   the PA says plainly how far it got. Falling back on a
                   *refusal* would be the wrong thing entirely: a 415 or a
                   403 is the server having read it and said no, and hiding
                   that behind a local save would look like success. */
                if (e instanceof ServerUnreachable) {
                  if (!localBanners.put(advertising, banner)) {
                    return 'The advert server could not be reached, and this browser would not store it either. Try a smaller image.';
                  }
                  setLocal(localBanners.read());
                  say(
                    `Advert up on seat ${advertising}, in this browser only — the advert server could not be reached.`,
                    'alert',
                  );
                  return null;
                }
                const message = e instanceof Error ? e.message : 'That advert could not be published.';
                // A refused signature is a decision, not a fault to report.
                return /reject|denied|cancel/i.test(message)
                  ? 'You did not sign it, so nothing went up.'
                  : message;
              }
            }
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
