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

/**
 * Cards and introductions themselves live in the Worker's database rather
 * than here — see `networkingApi.ts`. What is left in this module is the part
 * that is nobody's to store: which of them you are allowed to see, which is
 * read off the seat ladder the page has already worked out.
 */

export function isValidExternalUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
