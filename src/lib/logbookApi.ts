/**
 * The logbook, over the wire.
 *
 * One wallet's private notes — the things heard in the cabin that might be
 * worth something later — kept in the same Worker and reached with the same
 * session token as the directory.
 *
 * ── Why a 404 is not an error here ────────────────────────────────────────
 * The Worker answers every non-operator with the same 404 a misspelt path
 * gets, on purpose: a 403 would tell whoever guessed the URL that there is
 * something behind it. That means this module has to read a 404 as *"this
 * wallet has no logbook"* rather than as a failure, and hand the page back a
 * null instead of an error to render. A page that said "forbidden" would give
 * away exactly what the status code was written to withhold.
 *
 * So `openLogbook` returns null for "not yours", and only throws when
 * something actually went wrong. Everything else here is only ever called
 * after that null has been ruled out.
 */

import {
  DirectoryRefused, workerRequest, type Session,
} from './networkingApi';

/** What a note can be marked as. Mirrors `STATUSES` in `worker/src/logbook.ts`. */
export const LOG_STATUSES = ['open', 'acted', 'cold'] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

/** How much a note is believed, and what each rung means to a reader. */
export const CONVICTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Unrated' },
  { value: 1, label: 'Heard it' },
  { value: 2, label: 'Plausible' },
  { value: 3, label: 'Acting on it' },
];

export const STATUS_LABELS: Record<LogStatus, string> = {
  open: 'Open',
  acted: 'Acted on',
  cold: 'Cold',
};

export interface LogEntry {
  id: string;
  body: string;
  /** Where it came from. A wallet, a handle, a room, a person. */
  source: string;
  tags: string[];
  conviction: number;
  status: LogStatus;
  createdAt: string;
  updatedAt: string;
}

/** A new note. Only the body is required; the rest have sensible absences. */
export interface LogDraft {
  body: string;
  source?: string;
  tags?: string[];
  conviction?: number;
  status?: LogStatus;
}

/**
 * Open the logbook, or find there is none for this wallet.
 *
 * Null is the answer for everybody who is not the operator, and it is the
 * same answer a deployment with no logbook configured gives. The page draws
 * nothing either way, which is the point: the two are indistinguishable from
 * the outside and should stay that way from the inside too.
 */
export async function openLogbook(session: Session): Promise<LogEntry[] | null> {
  try {
    const { entries } = await workerRequest<{ entries: LogEntry[] }>('/logbook', { token: session.token });
    return entries;
  } catch (e) {
    if (e instanceof DirectoryRefused && e.status === 404) return null;
    throw e;
  }
}

/** Write one down. */
export function logEntry(session: Session, draft: LogDraft): Promise<LogEntry> {
  return workerRequest<LogEntry>('/logbook', {
    method: 'POST',
    token: session.token,
    body: JSON.stringify(draft),
  });
}

/**
 * Amend one.
 *
 * Only the fields named are touched — marking a note `acted` sends one key —
 * because sending the whole entry back would mean every amendment racing
 * every other one over fields it was never about.
 */
export function amendEntry(
  session: Session,
  id: string,
  patch: Partial<Omit<LogEntry, 'id' | 'createdAt' | 'updatedAt'>>,
): Promise<LogEntry> {
  return workerRequest<LogEntry>('/logbook', {
    method: 'PATCH',
    token: session.token,
    body: JSON.stringify({ id, ...patch }),
  });
}

/** Strike one out, for good. */
export function strikeEntry(session: Session, id: string): Promise<void> {
  return workerRequest<{ ok: true }>(`/logbook?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token: session.token,
  }).then(() => undefined);
}

/** "partner, listing, cex" from whatever somebody typed into the tags box. */
export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  for (const raw of value.split(',')) {
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9 _+/-]/g, '').trim().slice(0, 24);
    if (tag) seen.add(tag);
    if (seen.size >= 8) break;
  }
  return [...seen];
}
