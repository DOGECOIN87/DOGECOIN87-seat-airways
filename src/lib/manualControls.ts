/**
 * The manual controls.
 *
 * The aeroplane flies itself: pitch, bank, speed and altitude are all read off
 * the market, and that is the whole premise of the thing. These are the
 * switches that let one person fly it by hand anyway — roll it over, spin the
 * camera round it, drop the flaps, move the sun.
 *
 * ── One aeroplane, not one per browser ────────────────────────────────────
 * These are the *aircraft's* state and not this tab's. They are stored on the
 * Worker, read by every visitor, and written by one wallet — so throwing the
 * invert switch rolls the aeroplane on everybody's screen, and somebody
 * sitting in 24C watches the ground come up over the window. An aeroplane
 * only one person can see upside down is a screensaver; this is a flight
 * everybody is on.
 *
 * It follows that nothing here may be trusted for anything, and nothing here
 * is asked to be. These are an attitude, a camera rate and a sky. No
 * balances, no addresses, no seats: the altitude is still the market cap
 * however far over the thing is rolled, and the manifest is still the
 * manifest. The most a compromised set of switches could do is make the
 * aeroplane look silly.
 *
 * ── Why this module has no browser and no network in it ───────────────────
 * Both sides import it — the page to draw the panel, the Worker to validate
 * what arrives at `PUT /flight` — exactly as they share the seating. So it
 * holds the shape and the limits and nothing else: one clamp, run on the way
 * in and on the way out, in one place, so the two cannot drift about what a
 * legal set of controls is. The transport lives in `flightApi.ts`.
 */
import type { WeatherKind } from './sky';

export interface ManualControls {
  /**
   * Half-turns of roll from level. 1 is inverted; a barrel roll adds two.
   *
   * One number for both switches, because both are the same motion and the
   * scene eases toward whatever it is told: setting it to 1 rolls over and
   * stays, adding 2 rolls all the way round and comes back. Counting
   * half-turns rather than storing an angle is what keeps "inverted" a
   * state and "barrel roll" a thing that happens.
   */
  halfRolls: number;
  /** Degrees a second the exterior camera walks around the aeroplane. */
  spin: number;
  /** Trailing-edge flaps, 0–1, overriding the flight model. Null follows it. */
  flaps: number | null;
  /** Force the hour of day, 0–23. Null follows the clock. */
  hour: number | null;
  /** Force the weather. Null follows whatever is actually outside. */
  weather: WeatherKind | null;
}

export const HANDS_OFF: ManualControls = {
  halfRolls: 0, spin: 0, flaps: null, hour: null, weather: null,
};

/** True when every switch is where the autopilot left it. */
export function handsOff(controls: ManualControls): boolean {
  return controls.halfRolls === 0 && controls.spin === 0
    && controls.flaps === null && controls.hour === null && controls.weather === null;
}

export const WEATHERS: WeatherKind[] = ['clear', 'cloudy', 'overcast', 'fog', 'rain', 'snow', 'storm'];
/** How much cloud each forced weather implies, so the deck matches the label. */
const COVER: Record<WeatherKind, number> = {
  clear: 0.05, cloudy: 0.55, overcast: 0.95, fog: 0.8, rain: 0.85, snow: 0.8, storm: 1,
};
export const coverFor = (weather: WeatherKind): number => COVER[weather];

/**
 * Every switch brought back inside its limits.
 *
 * Run by the panel before it sends, by the Worker before it stores, and by
 * the Worker again on the way back out — because the way in is this
 * deployment's own code and the way out is whatever is in the namespace
 * today. The limits matter more than they look: an unbounded `halfRolls` is
 * an aeroplane spinning for a minute and a half with no switch that stops it
 * before it gets there, and a non-numeric one is a rotation of NaN, which is
 * an aeroplane that disappears from every screen at once.
 */
export function clamped(value: Partial<ManualControls>): ManualControls {
  const number = (v: unknown, lo: number, hi: number, round = false): number | null => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    const held = Math.max(lo, Math.min(hi, v));
    return round ? Math.round(held) : held;
  };
  return {
    halfRolls: number(value.halfRolls, -8, 8, true) ?? 0,
    spin: number(value.spin, -45, 45) ?? 0,
    flaps: number(value.flaps, 0, 1),
    hour: number(value.hour, 0, 23, true),
    weather: WEATHERS.includes(value.weather as WeatherKind) ? (value.weather as WeatherKind) : null,
  };
}
