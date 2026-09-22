/**
 * The aeroplane's own state, kept current.
 *
 * Every page on the site runs this, signed in or not, because the switches
 * are the aircraft's and not the viewer's: if the flight deck has rolled it,
 * a visitor who has never heard of the logbook should be looking at an
 * inverted aeroplane.
 *
 * The one wrinkle is the operator's own tab. They press a switch, the change
 * goes to the Worker, and a poll already in flight can come back with what
 * the aeroplane was doing a moment *before* the press — which puts the
 * aeroplane back the way it was and looks exactly like a button that does not
 * work. So a local change wins for a few seconds: long enough for the write
 * to land and the next poll to agree with it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HANDS_OFF, type ManualControls } from './manualControls';
import { fetchFlight, hasFlight } from './flightApi';
import { visibilityAwareInterval } from './visibility';

/**
 * How often the aeroplane is asked what it is doing.
 *
 * Far more often than anything else the page reads, because this is the one
 * reading that changes when somebody presses a button rather than when a
 * market moves. See `flightApi.ts` for why that is affordable.
 */
const REFRESH = 20_000;
/** How long a switch pressed here outranks whatever a poll says. */
const MINE_WINS_MS = 12_000;

export function useFlight(): [ManualControls, (next: ManualControls) => void] {
  const [controls, setControls] = useState<ManualControls>(HANDS_OFF);
  const pressedAt = useRef(0);

  useEffect(() => {
    if (!hasFlight) return;
    let alive = true;
    const load = async () => {
      const flight = await fetchFlight();
      if (!alive) return;
      // A poll that started before the last press is stale by definition.
      if (Date.now() - pressedAt.current < MINE_WINS_MS) return;
      setControls((current) => (same(current, flight) ? current : flight));
    };
    const stop = visibilityAwareInterval(load, REFRESH);
    return () => { alive = false; stop(); };
  }, []);

  /* What the panel calls. The write itself belongs to whoever holds the
     operator's session — this is only the page agreeing to show it
     immediately rather than at the top of the next poll. */
  const show = useCallback((next: ManualControls) => {
    pressedAt.current = Date.now();
    setControls(next);
  }, []);

  return [controls, show];
}

/* Compared field by field so that an unchanged poll — which is nearly all of
   them — does not hand every view a new object and restart a roll that was
   halfway done. */
function same(a: ManualControls, b: ManualControls): boolean {
  return a.halfRolls === b.halfRolls && a.spin === b.spin
    && a.flaps === b.flaps && a.hour === b.hour && a.weather === b.weather;
}
