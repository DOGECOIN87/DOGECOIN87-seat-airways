/**
 * The flight feed — the one input the whole cabin reacts to.
 *
 * SEAT AIRWAYS reads three numbers and derives everything else from them:
 * market cap becomes altitude, 24h change becomes pitch, holders become souls
 * on board. Nothing downstream knows where those numbers came from, which is
 * the point: this module is the only place that has to change when the feed
 * stops being simulated.
 *
 * ── Swapping in a real feed ────────────────────────────────────────────────
 * Implement `FlightFeed` against your indexer and hand it to `<CabinPage>`'s
 * `useFlightFeed` in place of `createSimulatedFeed()`. The contract is small
 * on purpose:
 *
 *   const live: FlightFeed = {
 *     subscribe(listener) {
 *       const id = setInterval(async () => listener(await fetchMarketTick()), 15_000);
 *       return () => clearInterval(id);
 *     },
 *     setMode() {},          // a real aircraft does not take flight-sim input
 *     get mode() { return 'live' as const },
 *   };
 *
 * Everything else on the page — the horizon, the tapes, the annunciators, the
 * seat ladder, the radio log — keeps working untouched.
 */

/** One reading from the market, in the units the cabin speaks. */
export interface FlightTick {
  /** Market cap in dollars. Read on the page as altitude in feet. */
  marketCap: number;
  /** 24-hour change in percent. The number that flies the aircraft. */
  change24h: number;
  /** Holder count. Read on the page as souls on board. */
  holders: number;
}

/** Flight-sim presets. `live` is the only one a real feed ever reports. */
export type FlightMode = 'live' | 'climb' | 'cruise' | 'turbulence' | 'dive';

export interface FlightFeed {
  /** Register for ticks. Returns an unsubscribe. */
  subscribe(listener: (tick: FlightTick) => void): () => void;
  /** Fly a preset. A live feed ignores this. */
  setMode(mode: FlightMode): void;
  readonly mode: FlightMode;
  /**
   * Put the aircraft at a market cap directly, so the altitude bands can be
   * visited without waiting out the climb. Simulated feeds only — a real one
   * omits this, and the controls that use it hide themselves.
   */
  jumpTo?(marketCap: number): void;
}

/** Opening conditions — a calm, slightly green day at cruise. */
export const INITIAL_TICK: FlightTick = {
  marketCap: 163_000,
  change24h: 4,
  holders: 2_410,
};

const TICK_MS = 220;

/**
 * How much of a day's move the altitude walks off per tick.
 *
 * Tuned so a sustained climb crosses the whole ladder — cloud deck at $1M,
 * space at $10M, the moon at $50M — in a minute or two rather than an
 * afternoon. A real feed sets the altitude outright and never uses this.
 */
const CLIMB_RATE = 0.02;
/** Altitude floor. Below this the aircraft is no longer flying. */
const FLOOR = 4_000;
/** Altitude ceiling. Past the moon there is nowhere left to go. */
const CEILING = 80_000_000;
/**
 * How hard the aircraft holds a station set by `jumpTo`, per tick.
 *
 * Enough to cancel a sustained tape inside a second or two, gentle enough
 * that the altimeter still breathes rather than freezing on a number.
 */
const STATION_PULL = 0.09;

/** Where each preset parks the 24h change, and how rough the air is there. */
const PRESETS: Record<FlightMode, { target: number; noise: number }> = {
  live: { target: 4, noise: 0 }, // walks on its own — see below
  climb: { target: 62, noise: 3 },
  cruise: { target: 2.5, noise: 1.2 },
  turbulence: { target: -11, noise: 26 },
  dive: { target: -54, noise: 5 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * A market that behaves enough like one to fly.
 *
 * `change24h` eases toward the mode's target rather than jumping, so the
 * aircraft rotates instead of teleporting. `marketCap` *integrates* that
 * change — a green number lifts the altitude for as long as it stays green —
 * which is what makes the tape read like an altimeter and not a restatement
 * of the percentage next to it.
 */
export function createSimulatedFeed(start: FlightTick = INITIAL_TICK): FlightFeed {
  let mode: FlightMode = 'live';
  let change = start.change24h;
  let target = start.change24h;
  let marketCap = start.marketCap;
  let holders = start.holders;
  /* Where `jumpTo` last put the aircraft, if anywhere.
  
     Altitude integrates the 24h change, which means it never sits still — and
     that made the altitude buttons a lie. Ask for space, and a couple of
     seconds of a red tape walked the cap back down through the cloud deck
     before you had finished looking at it; what the button actually delivered
     was a glimpse. So a jump sets a station, and the climb rate is bent
     toward holding it: the tape still moves, the aircraft still wanders a few
     per cent either way, but it stays in the band you asked to see. Flying it
     by hand — any mode button — is a request to leave, and clears the
     station. */
  let station: number | null = null;

  const listeners = new Set<(tick: FlightTick) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const step = () => {
    const preset = PRESETS[mode];

    if (mode === 'live') {
      // A drifting random walk with a weak pull back toward flat, so it wanders
      // without ever committing to the moon or the ground.
      target += (Math.random() - 0.5) * 11 - target * 0.045;
      target = clamp(target, -68, 132);
    } else {
      target = preset.target + (Math.random() - 0.5) * preset.noise;
    }

    change += (target - change) * 0.13;

    marketCap = clamp(marketCap * (1 + (change / 100) * CLIMB_RATE), FLOOR, CEILING);

    if (station !== null) {
      /* Station keeping, in log space, because the ladder is logarithmic: a
         pull of the same strength should feel the same at $1M and at $50M. */
      const drift = Math.log(marketCap / station);
      marketCap = station * Math.exp(drift * (1 - STATION_PULL));
    }

    // Souls trickle aboard on green days and quietly deplane on red ones.
    holders = Math.max(1, holders + (change > 0 ? Math.random() * 1.6 : -Math.random() * 1.1));

    const tick: FlightTick = { marketCap, change24h: change, holders: Math.round(holders) };
    listeners.forEach((l) => l(tick));
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener({ marketCap, change24h: change, holders: Math.round(holders) });
      if (!timer) timer = setInterval(step, TICK_MS);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    setMode(next) {
      mode = next;
      station = null;
      if (next !== 'live') target = PRESETS[next].target;
    },
    jumpTo(cap) {
      marketCap = clamp(cap, FLOOR, CEILING);
      station = marketCap;
      // Arrive level rather than still climbing at whatever got you here.
      mode = 'cruise';
      target = PRESETS.cruise.target;
      const tick: FlightTick = { marketCap, change24h: change, holders: Math.round(holders) };
      listeners.forEach((l) => l(tick));
    },
    get mode() {
      return mode;
    },
  };
}
