/**
 * The cabin directory, over the wire.
 *
 * Holder cards and introductions used to be `localStorage`, which made both
 * of them fictions: a card existed only in the browser that typed it, so
 * nobody in your section could ever read one, and a sent introduction was
 * written to the *sender's* own storage and delivered to nobody. The UI said
 * "queued in this browser", which was true and was the whole problem.
 *
 * They are rows in the Worker's database now, so a card follows its wallet to
 * any browser and an introduction actually arrives.
 *
 * ── Signing in ────────────────────────────────────────────────────────────
 * The advert wall signs every publish, because a publish is rare and pins one
 * exact image. The directory is read and written constantly, and a wallet
 * popup per action would be both unusable and a good way to teach people to
 * approve things unread. So the wallet signs once for a session and what
 * comes back is a bearer token good for a day.
 *
 * The token is the only thing this module keeps in `localStorage`, and it is
 * a credential rather than data: losing it costs a signature, and it is
 * scoped to the wallet that opened it, so switching wallets drops it.
 */

const API = (
  (import.meta.env.VITE_DIRECTORY_API as string | undefined)
  // Same Worker serves both by default, so an existing deployment only has to
  // bind the database rather than configure a second URL.
  ?? (import.meta.env.VITE_BANNERS_API as string | undefined)
)?.replace(/\/$/, '');

/** True when this deployment has a directory to talk to at all. */
export const hasDirectory = Boolean(API);

const SESSION_KEY = 'seat-airlines.directory.session.v1';

export interface NetworkingProfile {
  displayName: string;
  role: string;
  email: string;
  website: string;
  linkedin: string;
  /**
   * Whether the contact fields reach other holders at all.
   *
   * The page shows contact details to your own section, but the server
   * cannot enforce that — sections come off the seat ladder, which it
   * deliberately does not know — so the real audience is every signed-in
   * holder. This is the holder agreeing to that, and the server withholds
   * the fields from everybody but its owner until they do.
   */
  shareContact: boolean;
}

export const EMPTY_PROFILE: NetworkingProfile = {
  displayName: '', role: '', email: '', website: '', linkedin: '', shareContact: false,
};

export interface PublishedProfile extends NetworkingProfile {
  address: string;
  /** False when this card's contact fields were withheld from you. */
  sharesContact: boolean;
  updated: string;
}

export interface NetworkingMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  sentAt: string;
}

export interface Session {
  token: string;
  address: string;
  expires: number;
}

/**
 * The directory did not answer.
 *
 * Its own type for the same reason the advert server has one: a 401 or a 429
 * is the server having looked and said no, and worth repeating to the person.
 * A `fetch` that rejects is nobody having looked — not deployed, origin not on
 * the allowlist, no network — and says nothing about what was sent.
 */
export class DirectoryUnreachable extends Error {
  constructor(message = 'The directory could not be reached.') {
    super(message);
    this.name = 'DirectoryUnreachable';
  }
}

/** A session that has expired, or been revoked while the page was open. */
export class SessionExpired extends Error {
  constructor(message = 'Your directory session has expired. Sign in again.') {
    super(message);
    this.name = 'SessionExpired';
  }
}

/**
 * The text the wallet signs. Must match `signInChallenge` in the Worker
 * byte for byte, or the signature verifies against nothing.
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

/* ── The stored session ─────────────────────────────────────────────────── */

/** The live session for this wallet, if this browser still holds one. */
export function storedSession(address: string | null): Session | null {
  if (!address || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Session>;
    if (typeof value.token !== 'string' || typeof value.expires !== 'number') return null;
    // A session belongs to one wallet; switching wallets is not inheriting one.
    if (value.address !== address || value.expires < Date.now()) return null;
    return { token: value.token, address, expires: value.expires };
  } catch {
    return null;
  }
}

function keepSession(session: Session | null): void {
  try {
    if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* Storage blocked: the session holds for this page view and no longer. */
  }
}

/* ── Requests ───────────────────────────────────────────────────────────── */

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  if (!API) throw new Error('This deployment has no cabin directory configured.');
  const { token, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...rest,
      headers: {
        ...(rest.body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  } catch {
    throw new DirectoryUnreachable();
  }

  if (res.status === 401 && token) {
    keepSession(null);
    throw new SessionExpired();
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The directory refused that (${res.status}).`);
  }
  return (await res.json()) as T;
}

/** Prove the wallet, and keep the token it hands back. */
export async function signIn(
  address: string,
  sign: (message: string) => Promise<string>,
): Promise<Session> {
  const issued = new Date().toISOString();
  const signature = await sign(signInChallenge(address, issued));
  const session = await call<Session>('/session', {
    method: 'POST',
    body: JSON.stringify({ address, issued, signature }),
  });
  keepSession(session);
  return session;
}

/** Hand the token back, so a shared browser does not keep one alive. */
export async function signOut(session: Session | null): Promise<void> {
  keepSession(null);
  if (!session) return;
  try {
    await call('/session', { method: 'DELETE', token: session.token });
  } catch {
    /* The token is gone from this browser either way, and it expires. */
  }
}

/** Every published card, keyed by wallet. */
export function fetchDirectory(session: Session): Promise<Record<string, PublishedProfile>> {
  return call<Record<string, PublishedProfile>>('/directory', { token: session.token });
}

/** Publish or amend your own. */
export function saveProfile(session: Session, profile: NetworkingProfile): Promise<PublishedProfile> {
  return call<PublishedProfile>('/profile', {
    method: 'PUT',
    token: session.token,
    body: JSON.stringify(profile),
  });
}

/** Your introductions, both directions, newest first. */
export function fetchMessages(session: Session): Promise<{ inbox: NetworkingMessage[]; sent: NetworkingMessage[] }> {
  return call<{ inbox: NetworkingMessage[]; sent: NetworkingMessage[] }>('/messages', { token: session.token });
}

/** Send one. */
export function sendMessage(session: Session, to: string, body: string): Promise<NetworkingMessage> {
  return call<NetworkingMessage>('/messages', {
    method: 'POST',
    token: session.token,
    body: JSON.stringify({ to, body }),
  });
}
