/**
 * One animation loop, shared by every view of the flight.
 *
 * The feed ticks a few times a second; a horizon has to move at sixty. This
 * hook owns the gap: it subscribes to the feed, eases the displayed values
 * toward the reported ones, and calls `apply` once per frame so the caller can
 * write transforms and text straight to element refs. Nothing here causes a
 * React render, which is what lets the cockpit and the cabin window animate
 * without the page re-rendering underneath them.
 */
import { useEffect, useRef } from 'react';
import type { FlightFeed, FlightTick } from './flightFeed';
import { airspeedFor, bankFor, pitchFor, verticalSpeedFor } from './flightModel';
import type { ManualControls } from './manualControls';

/** Eased, display-ready flight values. */
export interface Attitude {
  pitch: number;
  bank: number;
  speed: number;
  alt: number;
  vs: number;
  heading: number;
  /**
   * Roll flown by hand, in degrees, on top of everything above. 0 unless
   * somebody has taken hold of the aeroplane.
   *
   * Eased here rather than by each view, so that the horizon out of the
   * cockpit, the lean of the hold and the world outside a cabin window all
   * go over together. It is kept apart from `bank` because the two are not
   * the same thing: `bank` is what the market is doing and is read from the
   * feed, this is what somebody asked for. A view that should show one and
   * not the other — the exterior camera, which rides the airframe and would
   * roll with it — can then tell them apart.
   */
  roll: number;
}

export type ApplyAttitude = (a: Attitude, tick: FlightTick | null) => void;

/* ── The autopilot's turns ─────────────────────────────────────────────────
   An airliner in cruise does not fly a ruler-straight line forever: every
   so often it banks gently onto a new heading, holds it, and rolls level.
   That is what this schedule is: level, a gentle turn right, level, a
   gentle turn left, and round again. About 27 degrees of heading each
   time, at a bank a passenger would barely spill a drink in.

   It is read off the wall clock rather than a per-view timer, so the
   cockpit, the cabin windows and the exterior camera all turn together,
   and it rides on top of whatever the market is doing to the bank. */
const TURN_CYCLE_S = 72;
/** Degrees of bank at the top of a turn — gentle for an airliner, and
    plainly visible from outside. */
const TURN_BANK = 14;
/** Degrees of heading a second, per degree of autopilot bank. */
const TURN_RATE = 0.14;

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The autopilot's bank, in degrees, at a moment on the wall clock. */
export function autopilotBank(nowMs: number): number {
  const s = ((nowMs / 1000) % TURN_CYCLE_S + TURN_CYCLE_S) % TURN_CYCLE_S;
  // One turn: four seconds to roll in, ten held, four to roll out.
  const turn = (start: number) => {
    const t = s - start;
    if (t < 0 || t > 18) return 0;
    if (t < 4) return smooth(t / 4);
    if (t < 14) return 1;
    return smooth(1 - (t - 14) / 4);
  };
  return TURN_BANK * (turn(14) - turn(50));
}

export function useAttitude(
  feed: FlightFeed,
  apply: ApplyAttitude,
  controls?: ManualControls,
): void {
  // Held in a ref so callers can pass an inline closure without restarting
  // the loop (and losing the eased state) on every render.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  /* Likewise: changing the switches must not restart the loop, or every
     change would snap the aeroplane back to level before rolling again. */
  const rollTo = useRef(0);
  rollTo.current = (controls?.halfRolls ?? 0) * 180;

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const target: Attitude = { pitch: 0, bank: 0, speed: 240, alt: 163_000, vs: 0, heading: 42, roll: 0 };
    const shown: Attitude = { ...target };
    // Seeded on the first tick rather than at zero: otherwise the opening
    // reading reads as a huge instantaneous rate of change and the aircraft
    // arrives already banked hard over.
    let lastChange: number | null = null;
    let lastAt = performance.now();
    let latest: FlightTick | null = null;

    const unsubscribe = feed.subscribe((tick) => {
      const now = performance.now();
      const dt = Math.max(0.05, (now - lastAt) / 1000);
      target.pitch = pitchFor(tick.change5m);
      target.bank = lastChange === null ? 0 : bankFor((tick.change5m - lastChange) / dt);
      target.speed = airspeedFor(tick.change5m);
      target.alt = tick.marketCap;
      target.vs = verticalSpeedFor(tick.change5m, tick.marketCap);
      lastChange = tick.change5m;
      lastAt = now;
      latest = tick;
    });

    let raf = 0;
    let last = performance.now();

    /* Reduced motion is not a frozen instrument — that mistake has been made
       here twice now, in opposite directions.

       Holding the first reading for the life of the page showed farmland
       captioned "space". Redrawing a snapshot every 900 ms — the second
       attempt — killed the one movement that makes the aircraft an aircraft:
       between repaints the ground advanced two metres and the window read as
       a photograph, which is exactly what the preference's owner reported as
       broken. What the preference asks for is less *motion*: no swaying, no
       banking, no eased bobbing of the horizon. It does not ask for a parked
       aeroplane, any more than it asks a video to freeze.

       So under reduced motion the loop still runs, at half rate: attitude
       values snap to their targets instead of easing (no sway), bank is
       pinned level and the hand-flown roll jumps rather than rolls, and the
       only thing that moves is the world going calmly past — steady,
       constant-rate, and the entire point of the scene. */
    let skip = false;
    /* The market's bank and the autopilot's are kept apart: the market's is
       eased, the autopilot's is already smooth, and each turns the heading
       at its own rate. */
    let marketBank = 0;
    let autoHeading = 0;

    const frame = (now: number) => {
      if (document.visibilityState === 'hidden') return;
      raf = requestAnimationFrame(frame);
      if (reduced && (skip = !skip)) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const auto = autopilotBank(Date.now());
      autoHeading += auto * TURN_RATE * dt;
      if (reduced) {
        /* The turns still happen — the flight still goes somewhere — but
           flat: the heading swings round with no roll at all. */
        Object.assign(shown, target, { bank: 0, roll: rollTo.current });
        shown.heading = (target.heading + autoHeading + 3600) % 360;
      } else {
        // Frame-rate independent easing, so 60Hz and 120Hz settle alike and a
        // backgrounded tab does not snap when it returns.
        const k = 1 - Math.exp(-4.5 * dt);
        shown.pitch += (target.pitch - shown.pitch) * k;
        marketBank += (target.bank - marketBank) * k;
        shown.bank = marketBank + auto;
        shown.speed += (target.speed - shown.speed) * k;
        shown.alt += (target.alt - shown.alt) * k;
        shown.vs += (target.vs - shown.vs) * k;
        /* Read every frame rather than on a tick, because this one is not fed
           by the market — it changes the moment somebody presses a switch.
           Slower than the rest on purpose: half a turn takes about a second,
           so a barrel roll is a roll rather than a jump cut. */
        shown.roll += (rollTo.current - shown.roll) * (1 - Math.exp(-3.2 * dt));
        // Banking turns the aircraft, so the compass actually goes somewhere.
        shown.heading = (shown.heading + marketBank * dt * 0.9 + auto * TURN_RATE * dt + 360) % 360;
      }
      applyRef.current(shown, latest);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(raf);
        return;
      }
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (document.visibilityState !== 'hidden') raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
    };
  }, [feed]);
}

/**
 * A rolling instrument tape.
 *
 * Translates the strip by the fractional part of the value and only rewrites
 * the labels when the integer part changes — so a tape that moves every frame
 * still touches the DOM's text a couple of times a second.
 */
export function paintTape(
  value: number,
  step: number,
  gap: number,
  count: number,
  group: SVGGElement | null,
  labels: readonly (SVGTextElement | null)[],
  base: number,
  format: (n: number) => string,
): number {
  if (!group) return base;
  const index = Math.round(value / step);
  group.setAttribute('transform', `translate(0 ${((value / step - index) * gap).toFixed(2)})`);
  if (index !== base) {
    const half = (count - 1) / 2;
    for (let i = 0; i < count; i++) {
      const node = labels[i];
      if (node) node.textContent = format((index + half - i) * step);
    }
  }
  return index;
}
