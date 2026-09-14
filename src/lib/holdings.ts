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

/* A seat is for a person. The largest "holder" of a pump.fun token is its
   bonding curve, holding most of the supply until the token graduates, and
   after that it is the pool. Both are accounts owned by a program. A person's
   wallet is either owned by the System Program or does not exist on chain at
   all (a wallet that has only ever received tokens holds no SOL). Anything
   else is a contract, and a contract in 1A would be the first thing anybody
   noticed. Checked by owner program rather than by a list of known addresses,
   so the next launchpad or AMM is excluded without anybody remembering to. */
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/** Keeps the holders that are people. Null if the chain could not be asked. */
async function peopleOnly(holders: Holder[]): Promise<Holder[] | null> {
  if (!holders.length) return holders;
  const res = await rpc<{ value: ({ owner: string } | null)[] }>('getMultipleAccounts', [
    holders.map((h) => h.address),
    { encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
  ]);
  if (!res) return null;
  return holders.filter((_, i) => {
    const account = res.value[i];
    return account === null || account.owner === SYSTEM_PROGRAM;
  });
}

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
  if (indexed && indexed.length) {
    // Only as many as could be seated, with room for the contracts to drop
    // out, and inside getMultipleAccounts' limit of 100.
    const top = [...indexed].sort((a, b) => b.balance - a.balance).slice(0, Math.min(100, MANIFEST_SIZE + 10));
    const people = await peopleOnly(top);
    if (people) return { holders: people, supply, live: true };
  }

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

  const people = await peopleOnly(holders);
  if (!people) return null;
  return { holders: people, supply, live: true };
}

