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

export interface NetworkingProfile {
  displayName: string;
  role: string;
  email: string;
  website: string;
  linkedin: string;
}

const PROFILE_KEY = 'seat_airlines_networking_profile';
const MESSAGE_KEY = 'seat_airlines_networking_messages';

export interface NetworkingMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  sentAt: string;
}

export function readProfile(address: string | null): NetworkingProfile {
  const empty: NetworkingProfile = { displayName: '', role: '', email: '', website: '', linkedin: '' };
  if (!address || typeof window === 'undefined') return empty;
  try {
    const raw = window.localStorage.getItem(`${PROFILE_KEY}:${address}`);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

export function writeProfile(address: string, profile: NetworkingProfile): void {
  try {
    window.localStorage.setItem(`${PROFILE_KEY}:${address}`, JSON.stringify(profile));
  } catch {
    // A blocked storage environment should not stop the rest of the cabin UI.
  }
}

export function readMessages(address: string | null): NetworkingMessage[] {
  if (!address || typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${MESSAGE_KEY}:${address}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function writeMessage(message: NetworkingMessage): void {
  try {
    const key = `${MESSAGE_KEY}:${message.from}`;
    const current = readMessages(message.from);
    window.localStorage.setItem(key, JSON.stringify([message, ...current].slice(0, 30)));
  } catch {
    // The UI still acknowledges the action when storage is unavailable.
  }
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
