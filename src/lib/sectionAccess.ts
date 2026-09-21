/**
 * What your seat entitles you to see.
 *
 * Cards and introductions themselves live in the Worker's database — see
 * `networkingApi.ts`. What is left here is the part that is nobody's to
 * store: which of them the page puts in front of you, read off the seat
 * ladder it has already worked out.
 *
 * This is the page's own filter, not the boundary — but it is the same rule.
 * The Worker computes the seating too now, in `worker/src/ladder.ts`, from
 * the very module this file re-exports, and refuses at the row what this file
 * declines to draw. That is the order the two belong in: the server decides,
 * and this decides what is worth putting in front of somebody, so that a
 * holder is not offered a card that will not open or a composer whose message
 * would come back refused.
 */
import type { ZoneKey } from '../content/cabin';

/**
 * Who may read a card, who may read a conversation, and who may start one.
 *
 * All three live in `seating.ts`, because the Worker enforces them and the
 * two sides must be the same rule rather than two readings of it. Re-exported
 * here so the cabin components keep asking the module that is about access.
 *
 * `canMessage` was the last one still written out in this file, and being the
 * page's alone is exactly what kept it from being a rule: the composer was
 * hidden from everybody it did not cover, and `POST /messages` took their
 * message regardless. It is the same line as `canViewContact` now — if you
 * can read somebody's card you can introduce yourself to them — so writing it
 * out again here would be keeping a copy of a rule that is one function away.
 */
export { canMessage, canViewContact, canOverhear, outranks, zoneRank } from './seating';

/**
 * And who may speak in which room.
 *
 * A cabin is a room as well as a rank. Reading one is the same line as
 * reading a card — your own and every one behind it — but *posting* is
 * narrower than both: your own section only. The conversation in a cabin
 * belongs to the people sitting in it, and a room the rows in front can talk
 * in is not that.
 */
export {
  ANNOUNCEMENT, canAnnounce, canPostToChannel, canReadChannel, channelFor, isChannel, zoneOfChannel,
} from './seating';

export function sectionLabel(zone: ZoneKey): string {
  switch (zone) {
    case 'deck': return 'Flight Deck';
    case 'first': return 'First Class';
    case 'business': return 'Business';
    case 'exit': return 'Exit Row';
    case 'economy': return 'Economy';
    default: return zone;
  }
}

export function defaultRole(zone: ZoneKey): string {
  switch (zone) {
    case 'deck': return 'Flight operations';
    case 'first': return 'Business development';
    case 'business': return 'Partnerships';
    case 'exit': return 'Campaigns & growth';
    case 'economy': return 'Community';
    default: return 'Holder';
  }
}

export function shortMember(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

export function isValidExternalUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
