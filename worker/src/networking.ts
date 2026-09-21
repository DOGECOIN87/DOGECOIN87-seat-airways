/**
 * The cabin directory: what a profile and a message are allowed to be.
 *
 * Split out from the Worker for the same reason `verify.ts` is — nothing in
 * here is Cloudflare-shaped, so the rules that decide whether a stranger can
 * write to somebody else's card can be run and tested without deploying
 * anything.
 *
 * ── Why a session token and not a signature per write ─────────────────────
 * The advert path signs every publish, because a publish is rare and pins one
 * exact image. The directory is the opposite: a holder saves a card, reads
 * the roster, sends a note, reads their replies. A wallet popup per action
 * would make the hub unusable, and people who are asked to sign constantly
 * stop reading what they sign.
 *
 * So the wallet signs once, for a session: the signature proves the key, and
 * what comes back is a bearer token good for a day. The token is stored here
 * only as a SHA-256 of itself, so this table cannot be read back into
 * anybody's account.
 */

import { fromBase58, sha256Hex } from './verify';

/** How long a signed-in session lasts before the wallet is asked again. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** How far out of date a sign-in signature may be. Same bound as an advert. */
export const SIGNIN_MAX_AGE_MS = 5 * 60 * 1000;
/** Anything one wallet may send an hour: introductions and room posts alike. */
export const MESSAGES_PER_HOUR = 20;
/** How many of each direction, and of each room, the hub reads back. */
export const MESSAGE_PAGE = 50;
/**
 * The PA, rationed by the day rather than the hour.
 *
 * A thing said once a day is listened to; a thing said twenty times is
 * weather. This is the number the boarding pass has printed on it — *"You
 * have the PA. One announcement a day. Use it well."* — and it was a promise
 * on a ticket long before there was anywhere to keep it.
 */
export const ANNOUNCEMENTS_PER_DAY = 1;
/** How far back the PA is read. It is a notice board, not a history. */
export const ANNOUNCEMENT_PAGE = 5;
/** Long enough for an introduction, short of an essay. */
export const MAX_BODY_CHARS = 1_000;

const FIELD_LIMITS = {
  displayName: 80,
  role: 120,
  email: 254,
  website: 300,
  linkedin: 300,
} as const;

export interface NetworkingProfile {
  displayName: string;
  role: string;
  email: string;
  website: string;
  linkedin: string;
}

export interface NetworkingMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  sentAt: string;
}

export const EMPTY_PROFILE: NetworkingProfile = {
  displayName: '', role: '', email: '', website: '', linkedin: '',
};

/** A Solana address is a 32-byte ed25519 key wearing base58. */
export function isAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false;
  const bytes = fromBase58(value);
  return bytes !== null && bytes.length === 32;
}

/**
 * The text a holder signs to open a session. Readable on purpose: this is
 * what appears in the wallet popup, and it says what it gets them.
 */
export function signInChallenge(address: string, issued: string): string {
  return [
    'SEAT AIRLINES',
    'Sign in to the cabin directory.',
    '',
    'This lets you publish your card, read your section, and send and',
    'receive introductions for one day. It authorises no transaction.',
    '',
    `wallet: ${address}`,
    `issued: ${issued}`,
  ].join('\n');
}

/** Only http(s). A contact link is not a place to accept `javascript:`. */
export function isValidExternalUrl(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function field(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

/**
 * A submitted card, or the reason it was refused.
 *
 * Everything is optional — a holder who fills in nothing but a name has a
 * valid card — but a link that is not a link is refused rather than stored
 * and rendered as one.
 */
export function readProfileInput(value: unknown): { profile: NetworkingProfile } | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'That card was not an object.' };
  const v = value as Record<string, unknown>;
  const profile: NetworkingProfile = {
    displayName: field(v.displayName, FIELD_LIMITS.displayName),
    role: field(v.role, FIELD_LIMITS.role),
    email: field(v.email, FIELD_LIMITS.email),
    website: field(v.website, FIELD_LIMITS.website),
    linkedin: field(v.linkedin, FIELD_LIMITS.linkedin),
  };
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
    return { error: 'That email address does not look like one.' };
  }
  for (const link of [profile.website, profile.linkedin]) {
    if (!isValidExternalUrl(link)) {
      return { error: 'Use a full http:// or https:// link for contact URLs.' };
    }
  }
  return { profile };
}

/** An introduction's text, or the reason it is not one. */
export function readMessageBody(value: unknown): { body: string } | { error: string } {
  if (typeof value !== 'string') return { error: 'That message was not text.' };
  const body = value.trim();
  if (!body) return { error: 'Write a short introduction before sending.' };
  if (body.length > MAX_BODY_CHARS) {
    return { error: `An introduction is at most ${MAX_BODY_CHARS} characters.` };
  }
  return { body };
}

/**
 * A bearer token: 32 random bytes, base64url.
 *
 * Not a JWT. Nothing here needs a token that carries claims — the session row
 * has the address — and a random string that means nothing until it is looked
 * up cannot be forged by getting the signing details wrong.
 */
export function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** What actually goes in the sessions table. */
export function tokenHash(token: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(token));
}

/** The token out of an `Authorization: Bearer …` header, if there is one. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~-]+)$/.exec(header.trim());
  return match ? match[1] : null;
}

/** An id for a message. Time-ordered prefix, so a listing sorts sensibly. */
export function messageId(): string {
  return `${Date.now().toString(36)}-${mintToken().slice(0, 12)}`;
}
