import { ALL_SEATS } from '../content/cabin';
import { seatHolders as seat, type Holder, type Manifest } from './seating';

/**
 * Who is actually on this aircraft.
 *
 * The seat ladder answers "what does my bag earn me" from one wallet's share
 * of supply. This answers the harder and more interesting question: *who is in
 * front of me*. Seats are handed out by rank, not by hitting a threshold, and
 * the manifest stops at a fixed number of names — so the only way to move up
 * the aircraft is to move somebody else down it. That is the whole game: a
 * threshold you can reach and then forget about is not competitive, and a
 * finite cabin is.
 *
 * Everyone below the cut is still a holder; they are just not seated. They
 * ride in the hold and can see exactly what the last seat costs.
 *
 * ── Where the seating itself lives ────────────────────────────────────────
 * In `seating.ts`, which knows nothing about Vite and is imported by the
 * Worker as well as by this page. The rules about who may read whose card
 * and whose conversations are boundaries now rather than interface
 * affordances, and a boundary the server cannot check is not one — so there
 * is one copy of the ladder and both sides read it. This module is the page's
 * end of it: the build-time manifest size, bound once.
 */

/** How many holders are seated. Everyone below this is standby. */
export const MANIFEST_SIZE = Math.max(
  2,
  Math.min(ALL_SEATS.length, Number(import.meta.env.VITE_MANIFEST_SIZE || 40)),
);

/**
 * Seat a list of holders, at this deployment's manifest size.
 *
 * **The Worker has to agree with this.** It computes the same ladder to
 * decide who may read whose card, and it reads its own `MANIFEST_SIZE`, so a
 * deployment that changes `VITE_MANIFEST_SIZE` has to change both or the two
 * will disagree about who is seated at the very back.
 */
export function seatHolders(holders: readonly Holder[], supply: number, live: boolean): Manifest {
  return seat(holders, supply, live, MANIFEST_SIZE);
}

export {
  SEAT_ORDER,
  EMPTY_MANIFEST,
  findEntry,
  canViewContact,
  canOverhear,
  outranks,
  zoneRank,
  type Holder,
  type Manifest,
  type ManifestEntry,
} from './seating';

/** An address, shortened the way every explorer shortens them. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
