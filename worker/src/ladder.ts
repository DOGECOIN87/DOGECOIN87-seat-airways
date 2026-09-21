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

import { FULL_CABIN, seatHolders, zoneRank, type Holder } from '../../src/lib/seating';
import { readHolderList } from '../../src/lib/holderList';
import type { ZoneKey } from '../../src/content/cabin';

/** How long a holder list is reused before it is read again. */
const DEFAULT_CACHE_MS = 60_000;

/**
 * Where to read the chain when nobody has said where.
 *
 * ── Why there is a default at all ─────────────────────────────────────────
 * `RPC_URL` is a secret rather than a var, because a paid endpoint carries
 * its key in the URL, and a secret is set out of band — by hand, once, on the
 * dashboard. CI cannot push it (an unset repository secret would write an
 * empty string on every deploy and silently turn the gate off), so a deploy
 * that is correct in every other respect can land with no way to read the
 * chain. That is not a loud failure. It is a directory that opens, lists
 * everybody, and withholds every contact detail from everybody, because it
 * cannot tell one cabin from another — and `sections: false` on `/health` is
 * the only place it says so.
 *
 * A deployment should not depend on somebody having remembered. Solana's own
 * public endpoint is the answer of last resort: rate-limited, unsuitable for
 * real traffic, and enormously better than not knowing who is aboard. Every
 * path that uses it already treats a refusal as "could not be asked" and
 * keeps whatever it had, so the failure mode of it being busy is the failure
 * mode that was already handled.
 *
 * Set `RPC_URL` to your own endpoint. This is what happens when you have not.
 */
const PUBLIC_RPC = 'https://api.mainnet-beta.solana.com';

/**
 * The endpoint this deployment reads the chain with.
 *
 * Exported because `holdsToken` in `index.ts` must ask the same one: a
 * deployment where the directory can see the seating but the door cannot
 * check the token is a room with a guest list and no doorman.
 */
export function rpcUrl(env: LadderEnv): string | undefined {
  // No mint means no token to read, so there is nothing to point an RPC at.
  return env.RPC_URL || (env.TOKEN_MINT ? PUBLIC_RPC : undefined);
}

/**
 * Whether this deployment is *configured* to tell one cabin from another.
 *
 * Reported by `/health` as `configured`, and deliberately no longer as
 * `sections`. This answers "was a feed or a mint ever set", which is a
 * question about the deployment. `sections` answers "was the seating
 * actually read", which is a question about right now. They were the same
 * field until the chain scan arrived and pulled them apart: with a mint set
 * and an endpoint that refuses the scan, this returns true while the cabin
 * seats nobody. Answering the first when an operator asked the second is how
 * a silent failure stays silent, so `/health` reports both, and they mean
 * different things on purpose.
 */
export function canSeat(env: LadderEnv): boolean {
  return Boolean(env.HOLDERS_URL || env.TOKEN_MINT);
}

/**
 * The whole aircraft, read from the shared seating rather than written down.
 *
 * The page defaults to the same constant from the same file, so the two agree
 * without anybody keeping two numbers in step. Setting `MANIFEST_SIZE` here
 * means setting `VITE_MANIFEST_SIZE` there.
 */
const DEFAULT_MANIFEST_SIZE = FULL_CABIN;

/** The manifest size this deployment asks for, sane or not. */
function requestedSize(env: LadderEnv): number {
  return Math.max(2, Number(env.MANIFEST_SIZE || DEFAULT_MANIFEST_SIZE));
}

/**
 * How many seats this deployment can fill, which is how many `/health`
 * reports `seated` out of.
 *
 * A cabin quietly filling to twenty of a hundred and seventy-eight is the
 * failure that survived every other fix in this file, because twenty seated
 * holders and a working directory look exactly like success from outside.
 * Reported as a number so it is something an operator reads rather than
 * something they have to already suspect.
 *
 * Capped at the aircraft because `seatHolders` caps there too: a
 * `MANIFEST_SIZE` above the seat count buys no extra seats, and reporting
 * one would invent an aeroplane the page does not draw.
 */
export function cabinSize(env: LadderEnv): number {
  return Math.min(requestedSize(env), FULL_CABIN);
}

export interface LadderEnv {
  /** An indexer, as the page's `VITE_HOLDERS_URL`. The uncapped source. */
  HOLDERS_URL?: string;
  /**
   * Solana JSON-RPC. Unset, Solana's public endpoint is used — see
   * `PUBLIC_RPC` on why a deployment should not need this to have been
   * remembered, and why you should still set it.
   */
  RPC_URL?: string;
  TOKEN_MINT?: string;
  MANIFEST_SIZE?: string;
  /** How long seating is cached, in milliseconds. Defaults to a minute. */
  LADDER_CACHE_MS?: string;
}

export interface Ladder {
  /** False when no holder feed is configured, so nothing can be judged. */
  live: boolean;
  /**
   * The list this seating was built from, in the shape an indexer gives.
   *
   * Kept so `GET /holders` can hand it straight back. The page needs the
   * same list this side is using — one feed is what keeps one seating chart
   * — and reading it from here means the chain is scanned once a minute for
   * the whole site rather than once every ninety seconds per visitor.
   */
  holders: readonly Holder[];
  /**
   * Total supply, in whole tokens, as the same read established it.
   *
   * Here so that "what share is this bag" can be answered without a second
   * `getTokenSupply` per asking. Zero when nothing could be read.
   */
  supply: number;
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
const NO_LADDER: Ladder = {
  live: false, holders: [], supply: 0, zoneOf: () => null, seated: () => [], seatedBehind: () => [],
};

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
  if (!canSeat(env)) return NO_LADDER;
  if (snapshot && snapshot.expiresAt > Date.now()) return snapshot.value;

  const size = requestedSize(env);
  const list = await readHolderList({
    holdersUrl: env.HOLDERS_URL,
    rpcUrl: rpcUrl(env),
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
    holders: list.holders,
    supply: list.supply,
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
