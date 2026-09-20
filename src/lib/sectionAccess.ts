/**
 * What your seat entitles you to see.
 *
 * Cards and introductions themselves live in the Worker's database — see
 * `networkingApi.ts`. What is left here is the part that is nobody's to
 * store: which of them the page puts in front of you, read off the seat
 * ladder it has already worked out.
 *
 * This is the page's own filter, not the boundary. The server cannot check a
 * section without a second copy of that ladder, so the rule it does hold is
 * consent: contact details reach nobody but their owner until that holder
 * opts in. These two work together — the server decides what may be sent,
 * this decides what is worth showing.
 */
import type { ZoneKey } from '../content/cabin';

/** Same-section contact access is the networking perk for seated holders. */
export function canViewContact(viewerZone: ZoneKey | null, memberZone: ZoneKey): boolean {
  return viewerZone !== null && viewerZone === memberZone;
}

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
