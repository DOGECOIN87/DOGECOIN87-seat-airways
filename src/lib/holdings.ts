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

/* ────────────────────────────────────────────────────────────────────────
   The holder list
   ────────────────────────────────────────────────────────────────────────
   The manifest seats people by rank, which needs everybody's balance rather
   than just the caller's. `getTokenLargestAccounts` gives the twenty largest
   token accounts for a mint in one call — a hard RPC limit, and the reason
   the seated manifest is small by default. A deployment that wants a longer
   manifest points VITE_HOLDERS_URL at an indexer returning
   `[{ address, balance }, …]`, and this falls back to the RPC if that fails. */

import { type Holder, MANIFEST_SIZE } from './manifest';

const HOLDERS_URL = import.meta.env.VITE_HOLDERS_URL as string | undefined;

export interface HolderList {
  holders: Holder[];
  supply: number;
  live: boolean;
}

interface LargestAccount { address: string; amount: string; decimals: number; uiAmount: number | null }

/** Token accounts belong to owners; the manifest names owners, not accounts. */
async function ownersOf(accounts: string[]): Promise<(string | null)[]> {
  const res = await rpc<{
    value: ({ data: { parsed: { info: { owner: string } } } } | null)[];
  }>('getMultipleAccounts', [accounts, { encoding: 'jsonParsed' }]);
  if (!res) return accounts.map(() => null);
  return res.value.map((a) => a?.data?.parsed?.info?.owner ?? null);
}

async function fromIndexer(): Promise<Holder[] | null> {
  if (!HOLDERS_URL) return null;
  try {
    const res = await fetch(HOLDERS_URL);
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!Array.isArray(body)) return null;
    return body
      .map((h) => h as { address?: unknown; balance?: unknown })
      .filter((h) => typeof h.address === 'string' && Number.isFinite(Number(h.balance)))
      .map((h) => ({ address: String(h.address), balance: Number(h.balance) }));
  } catch {
    return null;
  }
}

/** Reads the top holders. Null on any failure; the caller keeps what it had. */
export async function readHolders(): Promise<HolderList | null> {
  if (!isConfigured) return null;

  const supplyRes = await rpc<{ value: TokenAmount }>('getTokenSupply', [TOKEN_MINT]);
  if (!supplyRes) return null;
  const supply = supplyRes.value.uiAmount ?? Number(supplyRes.value.amount) / 10 ** supplyRes.value.decimals;

  const indexed = await fromIndexer();
  if (indexed && indexed.length) return { holders: indexed, supply, live: true };

  const largest = await rpc<{ value: LargestAccount[] }>('getTokenLargestAccounts', [TOKEN_MINT]);
  if (!largest) return null;

  const rows = largest.value.slice(0, MANIFEST_SIZE);
  const owners = await ownersOf(rows.map((r) => r.address));
  const holders = rows
    .map((r, i) => ({
      address: owners[i] ?? r.address,
      balance: r.uiAmount ?? Number(r.amount) / 10 ** r.decimals,
    }))
    .filter((h) => h.balance > 0);

  return { holders, supply, live: true };
}

/**
 * A demonstration manifest.
 *
 * Balances on a power law, because that is the shape every token's holder
 * list actually has: a few whales, a long tail, and the interesting fight
 * happening around the cut. Seeded, so the aircraft does not reshuffle
 * itself between renders.
 */
export function demoHolders(seed = 20260101): HolderList {
  let h = seed >>> 0;
  const rand = () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const supply = 1_000_000_000;
  const holders: Holder[] = [];
  for (let i = 0; i < MANIFEST_SIZE + 24; i++) {
    let a = '';
    for (let j = 0; j < 44; j++) a += B58[Math.floor(rand() * B58.length)];
    // Zipf-ish: rank 1 holds low single-digit percent, the tail holds dust.
    holders.push({ address: a, balance: (supply * 0.045) / Math.pow(i + 1, 1.35) * (0.75 + rand() * 0.5) });
  }
  return { holders, supply, live: false };
}
