import { ALL_SEATS, CABIN_ZONES, type CabinSeat } from '../content/cabin';

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
 */

/** How many holders are seated. Everyone below this is standby. */
export const MANIFEST_SIZE = Math.max(
  2,
  Math.min(ALL_SEATS.length, Number(import.meta.env.VITE_MANIFEST_SIZE || 40)),
);

/**
 * Every seat, best first.
 *
 * Zone order is the order the cabin is laid out in — deck, first, business,
 * exit, economy — then forward rows before aft ones, and inside a row a window
 * beats an aisle beats a middle. Rank *n* gets seat *n*.
 */
export const SEAT_ORDER: readonly CabinSeat[] = (() => {
  const zoneRank = new Map(CABIN_ZONES.map((z, i) => [z.key, i] as const));
  const posRank = { window: 0, aisle: 1, middle: 2 } as const;
  return [...ALL_SEATS].sort((a, b) => {
    const za = zoneRank.get(a.zone) ?? 99;
    const zb = zoneRank.get(b.zone) ?? 99;
    if (za !== zb) return za - zb;
    const ra = a.row ?? 0;
    const rb = b.row ?? 0;
    if (ra !== rb) return ra - rb;
    if (posRank[a.position] !== posRank[b.position]) return posRank[a.position] - posRank[b.position];
    return a.id.localeCompare(b.id);
  });
})();

/** One holder, as read from the chain (or made up, in demo). */
export interface Holder {
  address: string;
  balance: number;
}

export interface ManifestEntry {
  /** 1 is the biggest bag on the aircraft. */
  rank: number;
  address: string;
  balance: number;
  /** Share of total supply, 0–1. */
  share: number;
  seat: CabinSeat;
}

export interface Manifest {
  entries: readonly ManifestEntry[];
  /** Seat id to whoever is in it. */
  bySeat: ReadonlyMap<string, ManifestEntry>;
  /** Seat ids that are sold. */
  seats: ReadonlySet<string>;
  /** The balance holding the last seat — what it costs to get aboard. */
  cutoff: number;
  /** Seats still unsold. */
  open: number;
  /** False when these are demonstration figures. */
  live: boolean;
}

export const EMPTY_MANIFEST: Manifest = {
  entries: [],
  bySeat: new Map(),
  seats: new Set(),
  cutoff: 0,
  open: SEAT_ORDER.length,
  live: false,
};

/**
 * Seat a list of holders.
 *
 * Sorted by balance and truncated at the manifest size, so a holder's seat is
 * a function of everyone else's balance as well as their own — which is what
 * makes it worth watching.
 */
export function seatHolders(holders: readonly Holder[], supply: number, live: boolean): Manifest {
  const ranked = [...holders]
    .filter((h) => h.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, Math.min(MANIFEST_SIZE, SEAT_ORDER.length));

  const entries: ManifestEntry[] = ranked.map((h, i) => ({
    rank: i + 1,
    address: h.address,
    balance: h.balance,
    share: supply > 0 ? h.balance / supply : 0,
    seat: SEAT_ORDER[i],
  }));

  const bySeat = new Map(entries.map((e) => [e.seat.id, e] as const));
  return {
    entries,
    bySeat,
    seats: new Set(bySeat.keys()),
    cutoff: entries.length ? entries[entries.length - 1].balance : 0,
    open: SEAT_ORDER.length - entries.length,
    live,
  };
}

/** Where a given address sits, if it sits at all. */
export function findEntry(manifest: Manifest, address: string | null): ManifestEntry | null {
  if (!address) return null;
  return manifest.entries.find((e) => e.address === address) ?? null;
}

/** An address, shortened the way every explorer shortens them. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}
