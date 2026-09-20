/**
 * The seat ladder, and who it lets you see.
 *
 * ── Why this is its own module ────────────────────────────────────────────
 * The page used to be the only thing that knew who sat where, and the Worker
 * deliberately did not: a second copy of this logic would drift from the
 * page's the first time either changed, and a seating chart that disagrees
 * with itself is worse than one nobody checks.
 *
 * That argument is against a second *copy*, not against the server knowing.
 * Once the rules below decide who may read somebody's contact details and
 * whose conversations are visible from which cabin, they stop being an
 * interface affordance and become a boundary — and a boundary enforced only
 * in the browser is not one. So the ladder lives here, in plain TypeScript
 * with no browser and no Cloudflare in it, and both sides import this file.
 * There is one copy; it is this one.
 *
 * Nothing in here reads the environment. The page binds `MANIFEST_SIZE` from
 * its own build config in `manifest.ts`; the Worker passes its own.
 */

import { ALL_SEATS, CABIN_ZONES, type CabinSeat, type ZoneKey } from '../content/cabin';

/**
 * Every seat, best first.
 *
 * Zone order is the order the cabin is laid out in — deck, first, business,
 * exit, economy — then forward rows before aft ones, and inside a row a
 * window beats an aisle beats a middle. Rank *n* gets seat *n*.
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
export function seatHolders(
  holders: readonly Holder[],
  supply: number,
  live: boolean,
  manifestSize: number,
): Manifest {
  const ranked = [...holders]
    .filter((h) => h.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, Math.min(manifestSize, SEAT_ORDER.length));

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

/* ── Who can see what ──────────────────────────────────────────────────────
   One number decides all of it: how far forward in the aircraft you are.
   The flight deck is 0 and economy is the last zone; anybody not on the
   manifest is in the hold, which is below every seat there is.

   The rule the cabin runs on is that you can see down the aircraft and never
   up. Your bag bought a view of everything behind you, and nothing in front
   of you — which is the same thing the seat ladder itself says, applied to
   people rather than to legroom. */

const ZONE_RANK: ReadonlyMap<ZoneKey, number> = new Map(CABIN_ZONES.map((z, i) => [z.key, i] as const));

/** Lower is further forward. The hold — no seat at all — is last. */
export function zoneRank(zone: ZoneKey | null): number {
  if (!zone) return Number.POSITIVE_INFINITY;
  return ZONE_RANK.get(zone) ?? Number.POSITIVE_INFINITY;
}

/** True when `zone` is further forward than `other`. */
export function outranks(zone: ZoneKey | null, other: ZoneKey | null): boolean {
  return zoneRank(zone) < zoneRank(other);
}

/**
 * Whether a viewer may read a member's contact details.
 *
 * Your own section, and every seated section behind it. Somebody in front of
 * you keeps their card to themselves, which is what makes moving up the
 * aircraft worth something: the view forward is the thing you cannot buy with
 * a smaller bag.
 *
 * Both of you have to be on the manifest. The hold is not a section — it is
 * everybody who did not get a seat, it is on no roster, and the page cannot
 * put a name to any of it, so there is nothing there to show and nothing
 * worth fetching.
 */
export function canViewContact(viewerZone: ZoneKey | null, memberZone: ZoneKey | null): boolean {
  if (!viewerZone || !memberZone) return false;
  return zoneRank(viewerZone) <= zoneRank(memberZone);
}

/**
 * Whether a viewer may read a conversation they are not part of.
 *
 * Both ends seated, and both behind you. A chat with one end level with you
 * or in front of you is not yours to read — otherwise economy could follow a
 * conversation simply by being cc'd into the cabin it happened in, and the
 * whole point is that the aircraft is only transparent looking aft.
 *
 * Both ends *seated* for the same reason a card from the hold is not shown:
 * two wallets nobody can see, talking to each other, are not part of the
 * aircraft the page draws. The last row therefore hears nothing, which is
 * what being in the last row means.
 *
 * Being *on* the message is handled by the caller: sender and recipient can
 * always read their own, whatever anybody's seat is doing.
 */
export function canOverhear(
  viewerZone: ZoneKey | null,
  senderZone: ZoneKey | null,
  recipientZone: ZoneKey | null,
): boolean {
  if (!viewerZone || !senderZone || !recipientZone) return false;
  return outranks(viewerZone, senderZone) && outranks(viewerZone, recipientZone);
}
