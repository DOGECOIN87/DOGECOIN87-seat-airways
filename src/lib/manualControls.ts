/**
 * The manual controls.
 *
 * The aeroplane flies itself: pitch, bank, speed and altitude are all read off
 * the market, and that is the whole premise of the thing. These are the
 * switches that let one person fly it by hand anyway — roll it over, spin the
 * camera round it, drop the flaps, move the sun.
 *
 * ── What these are, and what they are not ─────────────────────────────────
 * Every one of them is cosmetic and local. Nothing here is sent anywhere,
 * nothing here is stored on the server, and nothing here changes what anybody
 * else sees: the altitude is still the market cap, the seats are still the
 * holders, and a visitor's aeroplane is unaffected by whatever this browser
 * has its aircraft doing. They are kept in `localStorage` so an inverted
 * aeroplane survives a reload, and that is the extent of their reach.
 *
 * Which is also why there is no gate on them beyond where the panel is drawn.
 * Somebody who went looking in devtools could set the key by hand and fly
 * upside down; what they would have is an upside-down aeroplane. The things
 * worth guarding on this site are guarded in the Worker, and none of them are
 * here.
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
 * Used on the way in from storage *and* on the way in from the panel, because
 * the two can drift apart otherwise: the barrel-roll button adds two
 * half-turns every press, so a determined operator could queue twenty in a
 * session and then watch the aeroplane unwind to eight on the next reload.
 * One function, both doors.
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

const KEY = 'seat-airlines.manual.v1';

/**
 * Whatever is in storage, read defensively.
 *
 * Every field is checked rather than trusted, because this is the one piece
 * of page state a person can edit by hand — and a `halfRolls` of `"banana"`
 * should be an aeroplane the right way up, not a scene that throws on its
 * first frame.
 */
export function storedControls(): ManualControls {
  if (typeof window === 'undefined') return HANDS_OFF;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return HANDS_OFF;
    const value = JSON.parse(raw) as Partial<ManualControls>;
    /* Bounded, and to whole half-turns: the scene eases toward this, so a
       hand-edited thousand would be an aeroplane spinning for a minute and a
       half with no switch that stops it before it gets there. */
    return clamped(value && typeof value === 'object' ? value : {});
  } catch {
    return HANDS_OFF;
  }
}

export function keepControls(controls: ManualControls): void {
  try {
    if (handsOff(controls)) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(controls));
  } catch {
    /* Storage blocked: the switches hold for this page view and no longer. */
  }
}
