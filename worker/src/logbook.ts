/**
 * The logbook: what a note is allowed to be, and whose it is.
 *
 * Split out from the Worker for the same reason `networking.ts` is — nothing
 * in here is Cloudflare-shaped, so the line that decides who the operator is
 * can be run and tested without deploying anything. That line is the whole
 * feature, so it is worth being able to run.
 *
 * ── Why one wallet and not a role ─────────────────────────────────────────
 * Everything else in this service is a rule about cabins: your section and
 * every one behind it, decided from the holder list, true of whoever happens
 * to be sitting there this minute. The logbook is not that. It is one
 * person's notebook, and the person is named in the deployment rather than
 * inferred from a balance — because a notebook that changed hands when
 * somebody bought more of the token would not be a notebook.
 *
 * So there is no `admins` table and no role column anywhere. The operator is
 * `ADMIN_WALLET`, set once where the deploy is configured, and a wallet is
 * the operator or it is not. A permission stored as a row is a permission a
 * bug can grant; this one cannot be granted by any request.
 *
 * The address itself is not a secret and is not treated as one. It is a
 * public key — it is on the chain, and if the operator holds the token it is
 * already drawn on the seat map. What guards the logbook is the signature
 * that opens a session, which needs the private key, and nothing else.
 */

import { isAddress } from './networking';

/** How many entries a read hands back. One person's notebook, newest first. */
export const LOGBOOK_PAGE = 200;
/** Long enough for what somebody actually said, short of a document. */
export const MAX_NOTE_CHARS = 2_000;
/** Where it came from, in as many characters as a handle or an address needs. */
export const MAX_SOURCE_CHARS = 120;
/** How many tags one note may carry, and how long each may be. */
export const MAX_TAGS = 8;
export const MAX_TAG_CHARS = 24;

/** What a note can be marked as. */
export const STATUSES = ['open', 'acted', 'cold'] as const;
export type LogStatus = (typeof STATUSES)[number];

export interface LogEntry {
  id: string;
  body: string;
  source: string;
  tags: string[];
  /** 0 unrated, then 1 heard it, 2 plausible, 3 acting on it. */
  conviction: number;
  status: LogStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Is this the wallet the logbook belongs to?
 *
 * Both halves matter. An unset `ADMIN_WALLET` means *nobody* is the operator,
 * rather than everybody — a deployment that forgot to name one has no logbook,
 * which is the safe direction for a route whose answer is somebody's private
 * notes. And a malformed one is treated the same way rather than compared
 * against, so a stray quote in the config cannot become a match.
 *
 * The comparison is exact. Base58 is case-sensitive and Solana addresses are
 * compared byte for byte everywhere else in this service; lowercasing either
 * side here would be inventing a second spelling of somebody's key.
 */
export function isAdmin(configured: string | undefined, address: string | null): boolean {
  if (!configured || !address) return false;
  const admin = configured.trim();
  return isAddress(admin) && admin === address;
}

/**
 * Tags, from either a comma-separated string or a list of them.
 *
 * Both shapes because the composer sends what somebody typed and an
 * amendment sends what it already holds, and normalising in one place is what
 * keeps a filter from missing two thirds of its matches.
 */
export function tagList(value: unknown): string[] {
  const raw = typeof value === 'string'
    ? value.split(',')
    : Array.isArray(value) ? value.map((t) => (typeof t === 'string' ? t : '')) : [];
  const seen = new Set<string>();
  for (const tag of raw) {
    /* Lowercased and stripped of everything a tag is not, so that "Partner",
       " partner" and "#partner" are one tag rather than three ways of
       filtering out two thirds of the notes about partners. */
    const clean = tag.trim().toLowerCase().replace(/[^a-z0-9 _+/-]/g, '').trim().slice(0, MAX_TAG_CHARS);
    if (clean) seen.add(clean);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** 0–3, whatever arrives. A rating out of range is a rating misread. */
export function conviction(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, Math.round(n)));
}

/** One of the three, or `open`. A note always has a state. */
export function status(value: unknown): LogStatus {
  return STATUSES.includes(value as LogStatus) ? (value as LogStatus) : 'open';
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export interface LogbookInput {
  body: string;
  source: string;
  tags: string[];
  conviction: number;
  status: LogStatus;
}

/**
 * A submitted note, or the reason it is not one.
 *
 * Only the body is required, and only because a note with no note in it is
 * nothing. Everything else has a sensible absence: no source, no tags,
 * unrated, open. Alpha gets written down in a hurry or it does not get
 * written down, so the one field this insists on is the one that is the point.
 */
export function readLogbookInput(value: unknown): { entry: LogbookInput } | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'That note was not an object.' };
  const v = value as Record<string, unknown>;
  const body = text(v.body, MAX_NOTE_CHARS);
  if (!body) return { error: 'Write the note before logging it.' };
  return {
    entry: {
      body,
      source: text(v.source, MAX_SOURCE_CHARS),
      tags: tagList(v.tags),
      conviction: conviction(v.conviction),
      status: status(v.status),
    },
  };
}

/**
 * An amendment: the fields actually named, and nothing else.
 *
 * The difference from `readLogbookInput` is the whole reason there are two.
 * Marking a note `acted` is one field, and running it through the reader
 * above would take the absent body as an empty one and blank the note. So an
 * absent key means "leave it alone" here, and only `body` cannot be set to
 * nothing.
 */
export function readLogbookPatch(value: unknown): { patch: Partial<LogbookInput> } | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'That amendment was not an object.' };
  const v = value as Record<string, unknown>;
  const patch: Partial<LogbookInput> = {};

  if ('body' in v) {
    const body = text(v.body, MAX_NOTE_CHARS);
    if (!body) return { error: 'A note cannot be emptied. Strike it out instead.' };
    patch.body = body;
  }
  if ('source' in v) patch.source = text(v.source, MAX_SOURCE_CHARS);
  if ('tags' in v) patch.tags = tagList(v.tags);
  if ('conviction' in v) patch.conviction = conviction(v.conviction);
  if ('status' in v) {
    /* An unrecognised status is refused rather than quietly turned into
       `open`, because the two mean opposite things: `status()` above defaults
       a *new* note to open, while an amendment naming a state nobody
       recognises is a typo, and reopening a closed line on a typo is the kind
       of wrong that looks right. */
    if (!STATUSES.includes(v.status as LogStatus)) {
      return { error: `A note is ${STATUSES.join(', ')} — not "${String(v.status)}".` };
    }
    patch.status = v.status as LogStatus;
  }

  if (!Object.keys(patch).length) return { error: 'That amendment changed nothing.' };
  return { patch };
}

/** An id for an entry. Time-ordered prefix, so a listing sorts sensibly. */
export function entryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const tail = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${Date.now().toString(36)}-${tail}`;
}

/** Tags as they go into the one column, and as they come back out of it. */
export const packTags = (tags: string[]): string => tags.join(',');
export const unpackTags = (packed: string): string[] => tagList(packed);
