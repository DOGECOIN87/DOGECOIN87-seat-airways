/**
 * Flight model — every derivation the cabin makes from a FlightTick.
 *
 * Pure functions only. The feed decides what the market is doing; this file
 * decides what that means for the aircraft, and nothing here touches the DOM
 * or the clock. Keeping it separate is what lets the HUD animate at 60fps off
 * a feed that ticks five times a second.
 */
import type { FlightTick } from './flightFeed';

/** Nose-up/nose-down limit, degrees. Beyond this the airframe is past saving. */
export const MAX_PITCH = 26;
/** Roll limit, degrees. A turn, not an aerobatic display. */
export const MAX_BANK = 11;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Attitude from the 24h change.
 *
 * Logarithmic so a quiet ±2% day still visibly moves the nose while a +140%
 * one saturates instead of standing the aircraft on its tail. The curve is
 * symmetric: red and green of the same size pitch by the same amount.
 */
export function pitchFor(change24h: number): number {
  const magnitude = Math.abs(change24h);
  const degrees = 17 * Math.log10(1 + magnitude / 9);
  return Math.sign(change24h) * clamp(degrees, 0, MAX_PITCH);
}

/**
 * Bank from how fast the change is itself changing.
 *
 * A market that is turning banks the aircraft into the turn; a steady trend,
 * however steep, flies wings-level. `delta` is the per-second change in the
 * 24h percentage.
 */
export function bankFor(delta: number): number {
  return clamp(delta * 2.4, -MAX_BANK, MAX_BANK);
}

/** Indicated airspeed, knots. Conviction in either direction is speed. */
export function airspeedFor(change24h: number): number {
  return 212 + Math.min(Math.abs(change24h), 140) * 3.4;
}

/** Vertical speed, feet per minute — the altimeter's derivative, signed. */
export function verticalSpeedFor(change24h: number, marketCap: number): number {
  return (change24h / 100) * marketCap * 0.42;
}

/** The overhead annunciator panel. */
export interface Annunciators {
  /** Rough air. Lit on any sizeable move, either direction. */
  seatbelt: boolean;
  /** Beverage service — only ever on a good day. */
  service: boolean;
  /** Masks down. */
  oxygen: boolean;
  /** Heads down, stay down. */
  brace: boolean;
  /** Airframe shake — cosmetic, but it is the loudest signal on the page. */
  shaking: boolean;
}

export function annunciatorsFor(tick: FlightTick): Annunciators {
  const pitch = pitchFor(tick.change24h);
  return {
    seatbelt: Math.abs(tick.change24h) > 12,
    service: tick.change24h > 8,
    oxygen: pitch < -17,
    brace: pitch < -23,
    shaking: Math.abs(tick.change24h) > 25,
  };
}

/** Phase-of-flight label for the HUD's mode line. */
export function phaseFor(change24h: number): string {
  if (change24h > 40) return 'MAX CLIMB';
  if (change24h > 8) return 'CLIMB';
  if (change24h > -6) return 'CRUISE';
  if (change24h > -22) return 'DESCENT';
  return 'EMERGENCY DESCENT';
}

/* ── Cabin occupancy ──────────────────────────────────────────────────────
   The prototype rolled a fresh random number for every seat on every build,
   so the cabin reshuffled on each render and the same seat could be free one
   second and sold the next. Occupancy is seeded instead: one number in, the
   same cabin out, every time — and the good seats fill first, because that is
   the whole premise. */

/** Deterministic PRNG so a given seed always produces the same cabin. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How full each zone runs. Scarcer cabin forward — bigger bags sit up front. */
const OCCUPANCY: Record<string, number> = {
  deck: 1,
  first: 0.92,
  business: 0.84,
  exit: 0.7,
  economy: 0.58,
};

/**
 * Which seats are already sold, for a given cabin seed.
 *
 * Returns a Set of seat ids. `alwaysFree` is honoured whatever the roll says,
 * so the page can guarantee at least one seat is claimable — 30B, by the
 * lavatory, which is the joke.
 */
export function occupiedSeats(
  seats: readonly { id: string; zone: string }[],
  seed: number,
  alwaysFree: readonly string[] = [],
): Set<string> {
  const rand = mulberry32(seed);
  const free = new Set(alwaysFree);
  const taken = new Set<string>();
  for (const seat of seats) {
    const rate = OCCUPANCY[seat.zone] ?? 0.6;
    if (!free.has(seat.id) && rand() < rate) taken.add(seat.id);
  }
  return taken;
}

/* ── Altitude bands ───────────────────────────────────────────────────────
   The higher the token's price, the higher the aircraft — and past a point,
   the aircraft stops being in weather at all. Market cap is read straight as
   altitude, so the milestones are the milestones:

     $1M   you break out on top of the cloud deck
     $10M  the sky goes black and the horizon starts to curve
     $50M  you are at the moon

   Everything between is a continuous climb; `progress` is how far through the
   current band you are, so the views can cross-fade rather than cut. */

export const BAND_CLOUDS = 1_000_000;
export const BAND_SPACE = 10_000_000;
export const BAND_MOON = 50_000_000;

export type FlightBand = 'atmosphere' | 'above-clouds' | 'space' | 'moon';

export interface BandState {
  band: FlightBand;
  /** 0–1 through this band, for cross-fading between scenes. */
  progress: number;
  /** Signage name for the band. */
  label: string;
  /** What is next, and what it costs. Null at the moon. */
  next: string | null;
  /** 0–1 toward the next band, for the climb meter. */
  toNext: number;
}

const BAND_LABEL: Record<FlightBand, string> = {
  atmosphere: 'In the weather',
  'above-clouds': 'Above the clouds',
  space: 'Space',
  moon: 'The moon',
};

/** Progress on a log scale — a climb from $1M to $2M should feel like one. */
const logProgress = (v: number, lo: number, hi: number) =>
  Math.max(0, Math.min(1, Math.log(v / lo) / Math.log(hi / lo)));

export function bandFor(marketCap: number): BandState {
  if (marketCap >= BAND_MOON) {
    return { band: 'moon', progress: 1, label: BAND_LABEL.moon, next: null, toNext: 1 };
  }
  if (marketCap >= BAND_SPACE) {
    const p = logProgress(marketCap, BAND_SPACE, BAND_MOON);
    return { band: 'space', progress: p, label: BAND_LABEL.space, next: 'The moon at $50M', toNext: p };
  }
  if (marketCap >= BAND_CLOUDS) {
    const p = logProgress(marketCap, BAND_CLOUDS, BAND_SPACE);
    return { band: 'above-clouds', progress: p, label: BAND_LABEL['above-clouds'], next: 'Space at $10M', toNext: p };
  }
  const p = logProgress(marketCap, 4_000, BAND_CLOUDS);
  return { band: 'atmosphere', progress: p, label: BAND_LABEL.atmosphere, next: 'Above the clouds at $1M', toNext: p };
}

/** Market cap as money, at the scale it happens to be. */
export function formatCap(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/* ── Formatting ─────────────────────────────────────────────────────────── */

export const formatFeet = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * Altitude at instrument width.
 *
 * The tape is about six characters wide and the ladder now runs to fifty
 * million, so full digits do not fit — and on a real altimeter they would not
 * be there either.
 */
export function formatFeetShort(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 1000)}K`;
  if (Math.abs(v) >= 1_000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

export const formatChange = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

export const formatVerticalSpeed = (n: number) => {
  const hundreds = Math.round(n / 100);
  return `${hundreds >= 0 ? '+' : '−'}${Math.abs(hundreds).toLocaleString('en-US')}`;
};

/** Compass point for a heading in degrees. */
export function headingLabel(deg: number): string {
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return points[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
