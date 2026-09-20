/**
 * Who sits where, as the server needs to know it.
 *
 * ── Why this exists at all ────────────────────────────────────────────────
 * This service spent its whole life refusing to learn the seat ladder, and
 * the refusal was right: a second copy of that logic would drift from the
 * page's the first time either changed, and adverts never needed it — the
 * page knows which seat a wallet is in, so the wall can be keyed by wallet
 * and stay honest.
 *
 * The directory is not the wall. "Your own section and everything behind it"
 * is a rule about who may read somebody's email address and somebody else's
 * conversation, and a rule like that enforced only in the browser is not a
 * rule — it is a suggestion the network tab ignores. So the ladder is
 * computed here too.
 *
 * What makes that safe is that it is not a second copy: the seating itself
 * comes from `src/lib/seating.ts`, the same file the page imports, so there
 * is one definition of rank, one zone order, and one place to change them.
 * What is here is only the part that is this side's own business — fetching
 * the holder list, caching it, and answering "which cabin is this wallet in".
 */

import { seatHolders, zoneRank, type Holder } from '../../src/lib/seating';
import type { ZoneKey } from '../../src/content/cabin';

/** How long a holder list is reused before it is read again. */
const DEFAULT_CACHE_MS = 60_000;
/** Matches the page's default; a deployment that changes one changes both. */
const DEFAULT_MANIFEST_SIZE = 40;

export interface LadderEnv {
  HOLDERS_URL?: string;
  MANIFEST_SIZE?: string;
  /** How long seating is cached, in milliseconds. Defaults to a minute. */
  LADDER_CACHE_MS?: string;
}

export interface Ladder {
  /** False when no holder feed is configured, so nothing can be judged. */
  live: boolean;
  /** The cabin a wallet is in, or null when it is in the hold. */
  zoneOf(address: string): ZoneKey | null;
  /**
   * Every seated wallet level with this zone or forward of it.
   *
   * The complement is what a holder there may overhear: anybody not on this
   * list is behind them — a seat further aft, or the hold, which has no seat
   * at all. Asking it this way round is what lets the question be put to SQL,
   * since the people in front of you are a list of at most a cabinful and the
   * people behind you are however many wallets exist.
   */
  atOrAbove(zone: ZoneKey | null): readonly string[];
}

/** A ladder that knows nothing, and therefore permits nothing. */
const NO_LADDER: Ladder = { live: false, zoneOf: () => null, atOrAbove: () => [] };

let snapshot: { value: Ladder; expiresAt: number } | undefined;

/**
 * The holder list, from the same indexer the page reads.
 *
 * Pointing both at one URL is what keeps the two ladders identical. The page
 * additionally drops accounts owned by a program — a bonding curve is not a
 * passenger — which needs an RPC round trip per read and is the indexer's job
 * to have done already; a feed that lists contracts will seat one here and
 * not there, so use a feed of people.
 */
async function fetchHolders(url: string): Promise<Holder[] | null> {
  try {
    const res = await fetch(url, { cf: { cacheTtl: 30 } } as RequestInit);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return null;
    return body
      .map((h) => h as { address?: unknown; balance?: unknown })
      .filter((h): h is { address: string; balance: unknown } => typeof h.address === 'string')
      .map((h) => ({ address: h.address, balance: Number(h.balance) }))
      .filter((h) => Number.isFinite(h.balance) && h.balance > 0);
  } catch {
    return null;
  }
}

/**
 * The current seating, cached per isolate.
 *
 * A stale ladder is the failure worth having here. The alternative is reading
 * the indexer on every request to the directory, which would put somebody
 * else's rate limit in the path of reading your own inbox. A holder who has
 * just moved up a cabin waits up to a minute for the view that comes with it.
 */
export async function readLadder(env: LadderEnv): Promise<Ladder> {
  if (!env.HOLDERS_URL) return NO_LADDER;
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot.value;

  const holders = await fetchHolders(env.HOLDERS_URL);
  if (!holders) {
    /* An unreachable indexer is not evidence that anybody has moved. Keep the
       last good seating until it expires on its own; with nothing cached,
       judge nobody rather than judging everybody to be in the hold — the
       second would quietly hand every card to whoever asked first. */
    return snapshot?.value ?? NO_LADDER;
  }

  const size = Math.max(2, Number(env.MANIFEST_SIZE || DEFAULT_MANIFEST_SIZE));
  const manifest = seatHolders(holders, 0, true, size);
  const zones = new Map(manifest.entries.map((e) => [e.address, e.seat.zone] as const));
  const value: Ladder = {
    live: true,
    zoneOf: (address) => zones.get(address) ?? null,
    atOrAbove: (zone) => manifest.entries
      .filter((e) => zoneRank(e.seat.zone) <= zoneRank(zone))
      .map((e) => e.address),
  };

  const ttl = Number(env.LADDER_CACHE_MS || DEFAULT_CACHE_MS);
  snapshot = { value, expiresAt: Date.now() + (Number.isFinite(ttl) ? ttl : DEFAULT_CACHE_MS) };
  return value;
}

/** Only for tests: forget the cached seating. */
export function forgetLadder(): void {
  snapshot = undefined;
}

export { zoneRank };
