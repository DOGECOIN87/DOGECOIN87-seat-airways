/**
 * The live market feed.
 *
 * Implements the same `FlightFeed` contract the simulator does, so nothing
 * downstream — the horizon, the tapes, the annunciators, the seat ladder, the
 * radio log — knows or cares which one it is talking to.
 *
 * ── Why the parser looks like this ────────────────────────────────────────
 * It reads fields by *name*, anywhere in the response, rather than by a fixed
 * path like `data[mint].stats24h.priceChange`.
 *
 * That is deliberate, and it is not defensive coding for its own sake.
 * Jupiter serves this data from several endpoints that have each moved
 * between versions — `price/v2`, `price/v3`, `tokens/v2/search` — and they do
 * not agree on nesting, only on what the fields are called. A fixed path
 * turns a shape change into a blank altimeter on a production page. Searching
 * by key survives the endpoint being swapped for a different one entirely,
 * which is exactly the kind of change somebody will make to this file later
 * without re-reading it.
 *
 * Every value is validated before it is used, and anything missing leaves the
 * previous reading in place rather than pushing a zero onto the tape. An
 * aircraft whose altimeter drops to nothing because a JSON key was renamed is
 * worse than one that holds its last known altitude.
 */

import type { FlightFeed, FlightMode, FlightTick } from './flightFeed';

const MINT = import.meta.env.VITE_TOKEN_MINT as string | undefined;
const MARKET_URL = import.meta.env.VITE_MARKET_URL as string | undefined;

/**
 * How often to ask. Jupiter's public tier is generous but not unlimited, and
 * the aircraft's attitude is smoothed over seconds anyway — polling faster
 * buys nothing a viewer can see.
 */
const POLL_MS = 20_000;

/**
 * Jupiter's free public endpoint, which needs no key and sends CORS headers.
 * `tokens/v2/search` is used rather than the price endpoints because it is
 * the one that carries all three numbers the cabin reads — market cap, the
 * 24-hour move, and the holder count — in a single request.
 */
export function defaultMarketUrl(mint: string): string {
  return `https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(mint)}`;
}

/** True when this deployment has been pointed at a real token. */
export const hasLiveMarket = Boolean(MINT);

type Json = unknown;

/**
 * Find the first finite number stored under any of `keys`, at any depth.
 *
 * Breadth-first, so a top-level `mcap` wins over one nested inside some
 * unrelated sub-object further down.
 */
function findNumber(root: Json, keys: readonly string[]): number | null {
  const queue: Json[] = [root];
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    for (const key of keys) {
      const v = obj[key];
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && Number.isFinite(n)) return n;
    }
    queue.push(...Object.values(obj));
  }
  return null;
}

/** What the cabin needs, pulled out of whatever shape arrived. */
export function readTick(body: Json, previous: FlightTick): FlightTick {
  const marketCap = findNumber(body, ['mcap', 'marketCap', 'market_cap', 'fdv']);
  const change = findNumber(body, [
    'priceChange24h', 'priceChange', 'price_change_24h', 'h24', 'change24h',
  ]);
  const holders = findNumber(body, ['holderCount', 'holder_count', 'holders']);

  return {
    // A market cap of zero is a parse failure, not a valuation.
    marketCap: marketCap && marketCap > 0 ? marketCap : previous.marketCap,
    change24h: change === null ? previous.change24h : change,
    holders: holders && holders > 0 ? Math.round(holders) : previous.holders,
  };
}

/**
 * A feed that reads the market.
 *
 * `setMode` is a no-op and `jumpTo` is absent: a real aircraft does not take
 * flight-sim input, and the controls that drive those hide themselves when
 * the feed does not offer them.
 */
export function createLiveFeed(start: FlightTick): FlightFeed {
  const url = MARKET_URL ?? (MINT ? defaultMarketUrl(MINT) : null);
  let latest: FlightTick = start;

  return {
    subscribe(listener) {
      if (!url) return () => {};
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const poll = async () => {
        try {
          const res = await fetch(url, { headers: { accept: 'application/json' } });
          if (res.ok) {
            latest = readTick(await res.json(), latest);
            if (!stopped) listener(latest);
          }
        } catch {
          /* Offline, rate-limited, or blocked. Hold the last reading: the
             aircraft keeps flying on what it knew, which is what a real
             instrument does when its source goes quiet. */
        }
        if (!stopped) timer = setTimeout(poll, POLL_MS);
      };

      // Report what we have immediately, then go and ask.
      listener(latest);
      poll();

      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    },
    setMode() {},
    get mode(): FlightMode {
      return 'live';
    },
  };
}
