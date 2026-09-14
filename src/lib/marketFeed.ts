/**
 * The live market feed.
 *
 * The only implementation of `FlightFeed`. Everything downstream — the
 * horizon, the tapes, the annunciators, the seat ladder, the radio log —
 * reads it without knowing where the numbers came from.
 *
 * ── Why the parser looks like this ────────────────────────────────────────
 * It reads fields by *name*, anywhere in the response, rather than by a fixed
 * path like `data[mint].stats5m.priceChange`.
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

import type { FlightFeed, FlightTick } from './flightFeed';

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
 * five-minute move, and the holder count — in a single request.
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

/** Find the first object stored under any of `keys`, at any depth. */
function findObject(root: Json, keys: readonly string[]): Json | null {
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
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    }
    queue.push(...Object.values(obj));
  }
  return null;
}

/**
 * The five-minute move.
 *
 * This one cannot be looked up by name the way market cap can, and the
 * difference is worth being careful about. Jupiter reports each window as its
 * own object — `stats5m`, `stats1h`, `stats6h`, `stats24h` — and every one of
 * them has a field called `priceChange`. Searching for that name at any depth
 * would return whichever window happened to be traversed first, which is to
 * say: an arbitrary one, silently, and differently as the response shape
 * moves.
 *
 * So the window is found first and the number is read from inside it.
 *
 * If the five-minute window is missing there is deliberately no fall back to
 * a longer one. The page says five minutes on the tape, in the annunciators
 * and in the footer; flying it on a 24-hour number while claiming otherwise
 * is worse than holding the previous reading.
 */
function readChange(body: Json): number | null {
  const window = findObject(body, ['stats5m', 'stats_5m', 'm5', '5m']);
  if (window) {
    const inside = findNumber(window, ['priceChange', 'price_change', 'change', 'priceChangePercentage']);
    if (inside !== null) return inside;
  }
  // Flatter shapes name the window in the field itself.
  return findNumber(body, ['priceChange5m', 'price_change_5m', 'change5m', 'm5']);
}

/** What the cabin needs, pulled out of whatever shape arrived. */
export function readTick(body: Json, previous: FlightTick): FlightTick {
  const marketCap = findNumber(body, ['mcap', 'marketCap', 'market_cap', 'fdv']);
  const change = readChange(body);
  const holders = findNumber(body, ['holderCount', 'holder_count', 'holders']);

  return {
    // A market cap of zero is a parse failure, not a valuation.
    marketCap: marketCap && marketCap > 0 ? marketCap : previous.marketCap,
    change5m: change === null ? previous.change5m : change,
    holders: holders && holders > 0 ? Math.round(holders) : previous.holders,
  };
}

/** A feed that reads the market. */
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
  };
}
