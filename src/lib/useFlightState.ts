/**
 * The stateful half of the cabin.
 *
 * `FlightDeck` animates off refs at 60fps because the horizon has to be
 * smooth. Everything else — the annunciator lamps, the PA announcements, the
 * altitude printed on the boarding pass — changes rarely and belongs in React
 * state. This hook subscribes to the same feed and re-renders at a human
 * cadence instead of a display one.
 */
import { useEffect, useRef, useState } from 'react';
import type { FlightFeed, FlightTick } from './flightFeed';
import { INITIAL_TICK } from './flightFeed';
import { annunciatorsFor, type Annunciators } from './flightModel';

/** How often the stateful layer is allowed to re-render, in ms. */
const RENDER_INTERVAL = 500;

export interface FlightState {
  tick: FlightTick;
  lamps: Annunciators;
}

export function useFlightState(feed: FlightFeed): FlightState {
  const [state, setState] = useState<FlightState>(() => ({
    tick: INITIAL_TICK,
    lamps: annunciatorsFor(INITIAL_TICK),
  }));
  const lastRender = useRef(0);

  useEffect(() => {
    return feed.subscribe((tick) => {
      const lamps = annunciatorsFor(tick);
      const now = performance.now();

      setState((prev) => {
        // A lamp changing is news — render immediately, whatever the clock says.
        const lampChanged =
          prev.lamps.seatbelt !== lamps.seatbelt ||
          prev.lamps.service !== lamps.service ||
          prev.lamps.oxygen !== lamps.oxygen ||
          prev.lamps.brace !== lamps.brace ||
          prev.lamps.shaking !== lamps.shaking;

        if (!lampChanged && now - lastRender.current < RENDER_INTERVAL) return prev;
        lastRender.current = now;
        return { tick, lamps };
      });
    });
  }, [feed]);

  return state;
}
