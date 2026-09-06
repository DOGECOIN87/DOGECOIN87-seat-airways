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
 * them the page runs in demo mode, which is stated on screen rather than
 * dressed up as a real balance.
 */

export interface Holding {
  /** The wallet's balance, in whole tokens. */
  balance: number;
  /** Total supply, in whole tokens. */
  supply: number;
  /** balance / supply, 0–1. */
  share: number;
  /** False when the numbers are demonstration figures, not chain state. */
  live: boolean;
}

export interface HoldingsSource {
  readonly live: boolean;
  /** Null means the lookup failed; the caller keeps whatever it had. */
  read(owner: string): Promise<Holding | null>;
}

const RPC_URL = import.meta.env.VITE_RPC_URL as string | undefined;
const TOKEN_MINT = import.meta.env.VITE_TOKEN_MINT as string | undefined;

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

/**
 * Demonstration holdings, for a deployment that has not been pointed at a
 * token yet.
 *
 * Derived from the address so a given wallet always gets the same bag, and
 * deliberately spread across the whole ladder so the mechanic can be seen
 * working. Everything that shows these numbers also says they are not real.
 */
export function createDemoHoldings(): HoldingsSource {
  return {
    live: false,
    async read(owner) {
      let h = 2166136261;
      for (let i = 0; i < owner.length; i++) {
        h ^= owner.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const roll = ((h ^ (h >>> 15)) >>> 0) / 4294967296;
      const supply = 1_000_000_000;
      // Log-spaced, so most wallets land in economy and a few reach the front.
      const share = 10 ** (-4.2 + roll * 3.0) / 1;
      return { balance: share * supply, supply, share, live: false };
    },
  };
}

export const holdingsSource: HoldingsSource = isConfigured ? createRpcHoldings() : createDemoHoldings();
