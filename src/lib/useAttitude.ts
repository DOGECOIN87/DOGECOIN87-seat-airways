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

/** Eased, display-ready flight values. */
export interface Attitude {
  pitch: number;
  bank: number;
  speed: number;
  alt: number;
  vs: number;
  heading: number;
}

export type ApplyAttitude = (a: Attitude, tick: FlightTick | null) => void;

export function useAttitude(feed: FlightFeed, apply: ApplyAttitude): void {
  // Held in a ref so callers can pass an inline closure without restarting
  // the loop (and losing the eased state) on every render.
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const target: Attitude = { pitch: 0, bank: 0, speed: 240, alt: 163_000, vs: 0, heading: 42 };
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
      target.pitch = pitchFor(tick.change24h);
      target.bank = lastChange === null ? 0 : bankFor((tick.change24h - lastChange) / dt);
      target.speed = airspeedFor(tick.change24h);
      target.alt = tick.marketCap;
      target.vs = verticalSpeedFor(tick.change24h, tick.marketCap);
      lastChange = tick.change24h;
      lastAt = now;
      latest = tick;
    });

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      // Frame-rate independent easing, so 60Hz and 120Hz settle alike and a
      // backgrounded tab does not snap when it returns.
      const k = 1 - Math.exp(-4.5 * dt);
      shown.pitch += (target.pitch - shown.pitch) * k;
      shown.bank += (target.bank - shown.bank) * k;
      shown.speed += (target.speed - shown.speed) * k;
      shown.alt += (target.alt - shown.alt) * k;
      shown.vs += (target.vs - shown.vs) * k;
      // Banking turns the aircraft, so the compass actually goes somewhere.
      shown.heading = (shown.heading + shown.bank * dt * 0.9 + 360) % 360;
      applyRef.current(shown, latest);
      raf = requestAnimationFrame(frame);
    };

    if (reduced) {
      // Settle on the first reading and hold it: no loop, no motion.
      const id = setTimeout(() => {
        Object.assign(shown, target, { bank: 0 });
        applyRef.current(shown, latest);
      }, 80);
      return () => {
        clearTimeout(id);
        unsubscribe();
      };
    }

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
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
