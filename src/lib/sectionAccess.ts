/**
 * What your seat entitles you to see.
 *
 * Cards and introductions themselves live in the Worker's database — see
 * `networkingApi.ts`. What is left here is the part that is nobody's to
 * store: which of them the page puts in front of you, read off the seat
 * ladder it has already worked out.
 *
 * This is the page's own filter, not the boundary. The server cannot check a
 * section without a second copy of that ladder; the rule it does hold is that
 * the directory opens only to a wallet holding the token, so everything in it
 * is a holders' room to begin with. The two work together — the server
 * decides who is let in, this decides what is worth showing them.
 */
import type { ZoneKey } from '../content/cabin';

/**
 * Who may read a card, and who may read a conversation.
 *
 * Both now live in `seating.ts`, because the Worker enforces them and the two
 * must be the same rule rather than two readings of it. Re-exported here so
 * the cabin components keep asking the module that is about access.
 */
export { canViewContact, canOverhear, outranks, zoneRank } from './seating';

/** First-class messaging is intentionally narrower than contact visibility. */
export function canMessage(
  viewerZone: ZoneKey | null,
  memberZone: ZoneKey,
  viewerAddress: string | null,
  memberAddress: string,
): boolean {
  return viewerZone === 'first'
    && memberZone === 'first'
    && Boolean(viewerAddress)
    && viewerAddress !== memberAddress;
}

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
