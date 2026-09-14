/**
 * Who is on the boarding pass.
 *
 * The flight has no accounts and no server, so a passenger is just a name in
 * localStorage — minted on the first visit and kept, so the pass you screenshot
 * today has the same name on it tomorrow. If storage is unavailable the name
 * holds for the session and nothing breaks.
 */

const KEY = 'seat_airlines_passenger';

const FIRST = [
  'Aisle', 'Overhead', 'Tray', 'Galley', 'Jetway', 'Terminal', 'Tarmac', 'Winglet',
  'Cargo', 'Standby', 'Duty', 'Transit', 'Layover', 'Redeye', 'Bulkhead', 'Turbulent',
];

const LAST = [
  'Hopper', 'Trolley', 'Recliner', 'Upgrade', 'Voucher', 'Carousel', 'Boarding', 'Holder',
  'Baggage', 'Middle', 'Window', 'Legroom', 'Cabin', 'Runway',
];

function mint(): string {
  const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(FIRST)}${pick(LAST)}${10 + Math.floor(Math.random() * 90)}`;
}

/** The passenger name on this browser's boarding pass. */
export function passengerName(): string {
  if (typeof window === 'undefined') return 'Passenger';
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) return stored;
  } catch {
    /* storage blocked — fall through and use a session-only name */
  }
  const fresh = mint();
  try {
    window.localStorage.setItem(KEY, fresh);
  } catch {
    /* nothing to do; the name simply will not survive a reload */
  }
  return fresh;
}
