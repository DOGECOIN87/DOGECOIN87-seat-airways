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
  const shownLamps = useRef<Annunciators>(state.lamps);

  useEffect(() => {
    /* Throttled, never dropped. A tick that arrives inside the interval is
       held and rendered when the interval ends. Dropping it instead lost the
       first real reading whenever the market answered within half a second of
       the placeholder, which it usually does, and the page then showed the
       placeholder until the next poll twenty seconds later. */
    let pending: ReturnType<typeof setTimeout> | undefined;

    const commit = (tick: FlightTick, lamps: Annunciators) => {
      pending = undefined;
      lastRender.current = performance.now();
      shownLamps.current = lamps;
      setState({ tick, lamps });
    };

    const unsubscribe = feed.subscribe((tick) => {
      const lamps = annunciatorsFor(tick);
      const shown = shownLamps.current;
      if (pending) clearTimeout(pending);

      // A lamp changing is news — render immediately, whatever the clock says.
      const lampChanged =
        shown.seatbelt !== lamps.seatbelt ||
        shown.service !== lamps.service ||
        shown.oxygen !== lamps.oxygen ||
        shown.brace !== lamps.brace ||
        shown.shaking !== lamps.shaking;

      const wait = RENDER_INTERVAL - (performance.now() - lastRender.current);
      if (lampChanged || wait <= 0) commit(tick, lamps);
      else pending = setTimeout(() => commit(tick, lamps), wait);
    });

    return () => {
      if (pending) clearTimeout(pending);
      unsubscribe();
    };
  }, [feed]);

  return state;
}
