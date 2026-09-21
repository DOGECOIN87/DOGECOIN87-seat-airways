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
 * Once the rules below decide who may read somebody's contact details, whose
 * conversations are visible from which cabin, and who may write into whose
 * inbox, they stop being an interface affordance and become a boundary — and
 * a boundary enforced only in the browser is not one. So the ladder lives here, in plain TypeScript
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

/**
 * Every seat there is.
 *
 * The default manifest size on both sides, so "how big is the aircraft" is
 * one number in one file rather than a 40 written in the page's build config
 * and another in the Worker's vars, waiting to disagree about who is seated
 * at the back.
 */
export const FULL_CABIN = SEAT_ORDER.length;

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

/**
 * Whether a viewer may send an introduction to a member.
 *
 * The same rule as reading their card: your own section, and every seated
 * section behind it. If you can see somebody's contact details you can
 * introduce yourself to them — which is the version that needs no explaining,
 * and why this delegates rather than restating the comparison.
 *
 * ── Why it used to be narrower ────────────────────────────────────────────
 * It was First Class to First Class and nothing else, on the reasoning that
 * an inbox is a claim on somebody's attention rather than a view, and that a
 * cabin should sell that in one place. The reasoning was sound; the rule
 * drawn from it was not. It left the flight deck — the two largest holders on
 * the aircraft — unable to write to anybody or be written to, and it left
 * every cabin behind First with a directory it could read and never use. A
 * perk that excludes the people at the front is not a perk.
 *
 * What that reasoning was protecting is still protected, by the same line
 * that protects everything else: nobody writes forward. A holder cannot mail
 * the seat ahead of them, so the flight deck's inbox reaches only the flight
 * deck, and the further forward you sit the fewer people can reach you at
 * all. The view forward is what the next seat up buys, and so is the quiet.
 *
 * ── Why it lives here ─────────────────────────────────────────────────────
 * It was in `sectionAccess.ts`, the page's own module, for as long as the
 * composer was the only thing that ever asked — which made it an interface
 * affordance rather than a rule. The button was hidden, and `POST /messages`
 * took the message anyway from anyone holding a session. So it sits here with
 * the other two, the Worker asks it before it writes a row, and what the
 * composer does is decline to offer a message that would be refused.
 *
 * The addresses are the part no seat can answer: a wallet is not an
 * introduction to itself.
 */
export function canMessage(
  viewerZone: ZoneKey | null,
  memberZone: ZoneKey | null,
  viewerAddress: string | null,
  memberAddress: string,
): boolean {
  return canViewContact(viewerZone, memberZone)
    && Boolean(viewerAddress)
    && viewerAddress !== memberAddress;
}

/* ── Rooms ─────────────────────────────────────────────────────────────────
   A cabin is a room as well as a rank. Every section has one channel, and a
   channel is addressed the way a wallet is — as the recipient of a message —
   because to everything that stores or reads a message that is exactly what
   it is: somewhere a message was sent.

   Writing a channel as a prefixed string rather than adding a column does
   happen to avoid a schema migration, and migrations here are applied by
   hand rather than by the deploy. But that is not the argument. The argument
   is that the one place a room and a person must never be confused is the
   one place they cannot be: base58 has no colon in it, so `section:first` is
   not a key anybody holds, and no wallet can ever be mistaken for a cabin. */

const CHANNEL_PREFIX = 'section:';

/** The PA. One line from the flight deck that the whole aircraft hears. */
export const ANNOUNCEMENT = 'announcement';

/** Where a section's conversation lives. */
export function channelFor(zone: ZoneKey): string {
  return `${CHANNEL_PREFIX}${zone}`;
}

/** The section a channel belongs to, or null when that is not a channel. */
export function zoneOfChannel(recipient: string): ZoneKey | null {
  if (!recipient.startsWith(CHANNEL_PREFIX)) return null;
  const zone = recipient.slice(CHANNEL_PREFIX.length) as ZoneKey;
  return ZONE_RANK.has(zone) ? zone : null;
}

/** True for anything addressed to a room rather than to a person. */
export function isChannel(recipient: string): boolean {
  return recipient === ANNOUNCEMENT || zoneOfChannel(recipient) !== null;
}

/**
 * Whether a holder may post in a section's channel.
 *
 * Your own, and only your own — which is the one place the rooms are narrower
 * than the cards. You can read a cabin behind you and write to anybody in it
 * personally, but you cannot walk into its conversation and talk. A section's
 * channel is the one thing on this aircraft that belongs to the people
 * sitting in it, and a room the rows in front can post into is not that.
 *
 * It is also what keeps moving up worth something in the other direction:
 * every seat forward is one more room you can hear and one fewer voice in
 * your own.
 */
export function canPostToChannel(viewerZone: ZoneKey | null, channelZone: ZoneKey | null): boolean {
  return Boolean(viewerZone) && viewerZone === channelZone;
}

/**
 * Whether a holder may read a section's channel.
 *
 * Your own and every one behind it — the same line as a contact card, and the
 * same line as everything else here. The flight deck hears the whole
 * aeroplane; the last row hears only itself.
 */
export function canReadChannel(viewerZone: ZoneKey | null, channelZone: ZoneKey | null): boolean {
  return canViewContact(viewerZone, channelZone);
}

/**
 * Who has the PA.
 *
 * The flight deck, because the boarding pass has promised exactly that since
 * before any of this was built: *"You have the PA. One announcement a day.
 * Use it well."* The once-a-day is what makes it worth listening to, and it
 * is enforced where the rows are rather than in the composer.
 */
export function canAnnounce(viewerZone: ZoneKey | null): boolean {
  return viewerZone === 'deck';
}
