/**
 * How much of the token a wallet holds.
 *
 * Two plain JSON-RPC calls — the mint's supply, and the caller's balance of it
 * — which is all the seat ladder needs. Doing it over `fetch` rather than a
 * client library keeps the whole app at two dependencies.
 *
 * ── Pointing it at a real token ───────────────────────────────────────────
 * Set both of these and the page reads the chain:
 *
 *   VITE_RPC_URL=https://your-rpc-endpoint
 *   VITE_TOKEN_MINT=<the SPL mint address>
 *
 * A public RPC will rate-limit a busy page; use your own endpoint. Without
 * them nothing is read and nothing is invented: the cabin is simply empty
 * until the chain answers.
 */

import { TOKEN_MINT } from './token';

export interface Holding {
  /** The wallet's balance, in whole tokens. */
  balance: number;
  /** Total supply, in whole tokens. */
  supply: number;
  /** balance / supply, 0–1. */
  share: number;
}

export interface HoldingsSource {
  readonly live: boolean;
  /** Null means the lookup failed; the caller keeps whatever it had. */
  read(owner: string): Promise<Holding | null>;
}

const RPC_URL = import.meta.env.VITE_RPC_URL as string | undefined;

/** True when this deployment has been pointed at a real token. */
export const isConfigured = Boolean(RPC_URL && TOKEN_MINT);

async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
  try {
    const res = await fetch(RPC_URL as string, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { result?: T; error?: unknown };
    if (body.error || body.result === undefined) return null;
    return body.result;
  } catch {
    return null;
  }
}

interface TokenAmount {
  amount: string;
  decimals: number;
  uiAmount: number | null;
}

/** Reads the chain. Any failure resolves to null rather than throwing. */
export function createRpcHoldings(): HoldingsSource {
  return {
    live: true,
    async read(owner) {
      const supplyRes = await rpc<{ value: TokenAmount }>('getTokenSupply', [TOKEN_MINT]);
      if (!supplyRes) return null;
      const supply = supplyRes.value.uiAmount ?? Number(supplyRes.value.amount) / 10 ** supplyRes.value.decimals;

      // A wallet can hold the same mint across several token accounts.
      const accounts = await rpc<{
        value: { account: { data: { parsed: { info: { tokenAmount: TokenAmount } } } } }[];
      }>('getTokenAccountsByOwner', [owner, { mint: TOKEN_MINT }, { encoding: 'jsonParsed' }]);
      if (!accounts) return null;

      const balance = accounts.value.reduce((sum, a) => {
        const t = a.account.data.parsed.info.tokenAmount;
        return sum + (t.uiAmount ?? Number(t.amount) / 10 ** t.decimals);
      }, 0);

      return { balance, supply, share: supply > 0 ? balance / supply : 0, live: true };
    },
  };
}


/* One source. Unconfigured, `read` simply returns null and the caller keeps
   whatever it had, which is nothing — an honest blank rather than a number
   somebody might believe. */
export const holdingsSource: HoldingsSource = isConfigured
  ? createRpcHoldings()
  : { live: false, async read() { return null; } };

/* ────────────────────────────────────────────────────────────────────────
   The holder list
   ────────────────────────────────────────────────────────────────────────
   Read by `holderList.ts`, which the Worker imports too — it seats the same
   aircraft to decide who may read whose card, and two readings of "who is
   aboard" would be two aircraft. This is only where the page's own build
   config is bound to it. */

import { readHolderList, type HolderList } from './holderList';
import { MANIFEST_SIZE } from './manifest';
import { WORKER_API } from './networkingApi';

/**
 * Where the holder list comes from.
 *
 * `VITE_HOLDERS_URL` is an indexer, and an indexer is still the best answer.
 * Unset, this falls back to the Worker's own `/holders`, which is the list it
 * has already read and cached to decide who may read whose card.
 *
 * That default is worth more than the convenience of not configuring one.
 * The page and the Worker have to agree about who is aboard — two readings
 * are two aircraft, and this one is a privacy boundary — and pointing the
 * page at the Worker's answer makes agreement the default rather than
 * something two environment variables have to be kept in step about.
 *
 * It is also the difference between one scan of the chain a minute for the
 * whole site and one per visitor every ninety seconds: getting the full
 * holder list out of a plain RPC is a scan, and the Worker has already paid
 * for it. With no Worker at all this stays undefined and the page reads the
 * chain itself, which is what it always did.
 */
const HOLDERS_URL = (import.meta.env.VITE_HOLDERS_URL as string | undefined)
  || (WORKER_API ? `${WORKER_API}/holders` : undefined);

export type { HolderList };

/** Reads the top holders. Null on any failure; the caller keeps what it had. */
export async function readHolders(): Promise<HolderList | null> {
  if (!isConfigured) return null;
  return readHolderList({
    holdersUrl: HOLDERS_URL,
    rpcUrl: RPC_URL,
    mint: TOKEN_MINT,
    manifestSize: MANIFEST_SIZE,
  });
}
