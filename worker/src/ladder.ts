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

import { FULL_CABIN, seatHolders, zoneRank } from '../../src/lib/seating';
import { readHolderList } from '../../src/lib/holderList';
import type { ZoneKey } from '../../src/content/cabin';

/** How long a holder list is reused before it is read again. */
const DEFAULT_CACHE_MS = 60_000;
/**
 * The whole aircraft, read from the shared seating rather than written down.
 *
 * The page defaults to the same constant from the same file, so the two agree
 * without anybody keeping two numbers in step. Setting `MANIFEST_SIZE` here
 * means setting `VITE_MANIFEST_SIZE` there.
 */
const DEFAULT_MANIFEST_SIZE = FULL_CABIN;

export interface LadderEnv {
  /** An indexer, as the page's `VITE_HOLDERS_URL`. The uncapped source. */
  HOLDERS_URL?: string;
  /** Falls back to the twenty largest accounts, as the page does. */
  RPC_URL?: string;
  TOKEN_MINT?: string;
  MANIFEST_SIZE?: string;
  /** How long seating is cached, in milliseconds. Defaults to a minute. */
  LADDER_CACHE_MS?: string;
}

export interface Ladder {
  /** False when no holder feed is configured, so nothing can be judged. */
  live: boolean;
  /** The cabin a wallet is in, or null when it is in the hold. */
  zoneOf(address: string): ZoneKey | null;
  /** Everybody with a seat, which is everybody the page draws. */
  seated(): readonly string[];
  /**
   * Seated wallets strictly aft of this zone.
   *
   * Asked as a list of people rather than as "everybody except those in
   * front" on purpose. The complement would sweep in every wallet that has
   * ever held the token, and the hold is not on the manifest, not on the
   * roster, and not something the page can put a name to — so a conversation
   * between two of them is nobody's to read and nothing anybody would want
   * queried. The aircraft is the list; the list is at most a cabinful.
   */
  seatedBehind(zone: ZoneKey | null): readonly string[];
}

/** A ladder that knows nothing, and therefore permits nothing. */
const NO_LADDER: Ladder = { live: false, zoneOf: () => null, seated: () => [], seatedBehind: () => [] };

let snapshot: { value: Ladder; expiresAt: number } | undefined;

/**
 * The current seating, cached per isolate.
 *
 * A stale ladder is the failure worth having here. The alternative is reading
 * the indexer on every request to the directory, which would put somebody
 * else's rate limit in the path of reading your own inbox. A holder who has
 * just moved up a cabin waits up to a minute for the view that comes with it.
 */
export async function readLadder(env: LadderEnv): Promise<Ladder> {
  // Nothing to read holders with at all: an indexer, or the chain.
  if (!env.HOLDERS_URL && !(env.RPC_URL && env.TOKEN_MINT)) return NO_LADDER;
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot.value;

  const size = Math.max(2, Number(env.MANIFEST_SIZE || DEFAULT_MANIFEST_SIZE));
  const list = await readHolderList({
    holdersUrl: env.HOLDERS_URL,
    rpcUrl: env.RPC_URL,
    mint: env.TOKEN_MINT,
    manifestSize: size,
  });
  if (!list) {
    /* An unreachable indexer is not evidence that anybody has moved. Keep the
       last good seating until it expires on its own; with nothing cached,
       judge nobody rather than judging everybody to be in the hold — the
       second would quietly hand every card to whoever asked first. */
    return snapshot?.value ?? NO_LADDER;
  }

  const manifest = seatHolders(list.holders, list.supply, true, size);
  const zones = new Map(manifest.entries.map((e) => [e.address, e.seat.zone] as const));
  const value: Ladder = {
    live: true,
    zoneOf: (address) => zones.get(address) ?? null,
    seated: () => manifest.entries.map((e) => e.address),
    seatedBehind: (zone) => manifest.entries
      .filter((e) => zoneRank(e.seat.zone) > zoneRank(zone))
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
