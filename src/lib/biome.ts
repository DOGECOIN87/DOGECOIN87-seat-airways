/**
 * What kind of country is under the aircraft.
 *
 * The flight crosses a coast every few minutes: a long leg over farmland, a
 * shorter one over open water, and back. The rhythm is read off the wall
 * clock rather than off any one view's own timer, so the cockpit, the cabin
 * windows and the exterior camera all cross the same coastline at the same
 * moment — and so does a second tab.
 *
 * The cycle is deliberately mostly land. The fields are what carry the sense
 * of motion (they have boundaries to measure speed against; open water has
 * far fewer), so the sea is an event, not the default.
 */

export type Biome = 'land' | 'ocean';

export interface BiomeState {
  /** What the ground mostly is right now. */
  biome: Biome;
  /** 0 over land, 1 over open water, in between while crossing the coast. */
  ocean: number;
  /** When the next change of any kind begins or completes, in ms epoch. */
  changesAt: number;
}

/* The legs, in seconds. One full cycle is LAND + FADE + OCEAN + FADE. */
const LAND_S = 170;
const FADE_S = 14;
const OCEAN_S = 90;
const CYCLE_S = LAND_S + FADE_S + OCEAN_S + FADE_S;

/** Smooth, so the coast arrives as an approach rather than a cut. */
const ease = (t: number) => t * t * (3 - 2 * t);

export function biomeAt(nowMs: number): BiomeState {
  const s = ((nowMs / 1000) % CYCLE_S + CYCLE_S) % CYCLE_S;
  if (s < LAND_S) {
    return { biome: 'land', ocean: 0, changesAt: nowMs + (LAND_S - s) * 1000 };
  }
  if (s < LAND_S + FADE_S) {
    const t = (s - LAND_S) / FADE_S;
    return { biome: t < 0.5 ? 'land' : 'ocean', ocean: ease(t), changesAt: nowMs + (LAND_S + FADE_S - s) * 1000 };
  }
  if (s < LAND_S + FADE_S + OCEAN_S) {
    return { biome: 'ocean', ocean: 1, changesAt: nowMs + (LAND_S + FADE_S + OCEAN_S - s) * 1000 };
  }
  const t = (s - LAND_S - FADE_S - OCEAN_S) / FADE_S;
  return { biome: t < 0.5 ? 'ocean' : 'land', ocean: ease(1 - t), changesAt: nowMs + (CYCLE_S - s) * 1000 };
}

export const BIOME_CYCLE_S = CYCLE_S;
