/**
 * Everybody's balance, which is what a manifest needs.
 *
 * ── Why this is its own module ────────────────────────────────────────────
 * Same reason as `seating.ts`: the Worker has to arrive at the same aircraft
 * the page does, and the only safe way to do that is to run the same code
 * rather than a careful reimplementation of it. Seating decides who sits
 * where; this decides who is even on board, and getting either one slightly
 * different puts a wallet in business here and in first there — which, now
 * that the cabin decides who may read whose card, is a privacy boundary
 * disagreeing with itself.
 *
 * So nothing here reads the environment. The page binds its `VITE_` values in
 * `holdings.ts` and the Worker binds its vars in `ladder.ts`; both call this.
 *
 * ── Where a holder list comes from ────────────────────────────────────────
 * The mint alone is not enough, and this is the part that surprises people:
 * Solana has no "list the holders of this token" call. The closest is
 * `getTokenLargestAccounts`, which returns **at most twenty** token accounts
 * and is a hard RPC limit. Twenty accounts is not forty seats.
 *
 * So there are two sources, and the indexer is the real one:
 *
 *   holdersUrl   JSON `[{ address, balance }, …]` from an indexer, uncapped
 *   rpcUrl+mint  the twenty largest accounts, resolved to their owners
 *
 * The RPC path is the fallback, and it fills the front of the aircraft and
 * leaves the rest empty. Both paths then drop accounts owned by a program,
 * because a bonding curve is not a passenger.
 */

import type { Holder } from './seating';

export interface HolderSource {
  /** An indexer returning `[{ address, balance }, …]`. The uncapped path. */
  holdersUrl?: string;
  /** Solana JSON-RPC. Without an indexer this caps the cabin at twenty. */
  rpcUrl?: string;
  /** The SPL mint being flown. */
  mint?: string;
  /** How many can be seated, which bounds how many are worth reading. */
  manifestSize: number;
}

export interface HolderList {
  holders: Holder[];
  supply: number;
  live: boolean;
}

interface TokenAmount {
  amount: string;
  decimals: number;
  uiAmount: number | null;
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

function rpcCall(rpcUrl: string) {
  return async function rpc<T>(method: string, params: unknown[]): Promise<T | null> {
    try {
      const res = await fetch(rpcUrl, {
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
  };
}

/**
 * `getMultipleAccounts` takes a hard maximum of a hundred addresses.
 *
 * Which is fine for a cabin of forty and silently not fine for one of 178:
 * over the limit the call errors, the caller reads that as "the chain could
 * not be asked", and the whole manifest falls back to the twenty largest
 * accounts. A full aircraft that quietly seats twenty is worse than one that
 * refuses to start, so every account lookup goes through here in batches.
 */
const ACCOUNTS_PER_CALL = 100;

const inBatches = <T,>(items: readonly T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += ACCOUNTS_PER_CALL) {
    out.push(items.slice(i, i + ACCOUNTS_PER_CALL));
  }
  return out;
};

/** Keeps the holders that are people. Null if the chain could not be asked. */
async function peopleOnly(
  rpc: <T>(method: string, params: unknown[]) => Promise<T | null>,
  holders: Holder[],
): Promise<Holder[] | null> {
  if (!holders.length) return holders;

  const pages = await Promise.all(inBatches(holders).map((batch) =>
    rpc<{ value: ({ owner: string } | null)[] }>('getMultipleAccounts', [
      batch.map((h) => h.address),
      { encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
    ])));
  // One unanswered page makes the whole list a guess, and guessing here seats
  // a bonding curve in 1A.
  if (pages.some((page) => !page)) return null;

  const accounts = pages.flatMap((page) => page!.value);
  return holders.filter((_, i) => {
    const account = accounts[i];
    return account === null || account === undefined || account.owner === SYSTEM_PROGRAM;
  });
}

/** Token accounts belong to owners; the manifest names owners, not accounts. */
async function ownersOf(
  rpc: <T>(method: string, params: unknown[]) => Promise<T | null>,
  accounts: string[],
): Promise<(string | null)[]> {
  const pages = await Promise.all(inBatches(accounts).map((batch) =>
    rpc<{ value: ({ data: { parsed: { info: { owner: string } } } } | null)[] }>(
      'getMultipleAccounts', [batch, { encoding: 'jsonParsed' }],
    )));
  return pages.flatMap((page, i) => (
    page
      ? page.value.map((a) => a?.data?.parsed?.info?.owner ?? null)
      // A page that failed is that batch's worth of unknowns, not everyone's.
      : inBatches(accounts)[i].map(() => null)
  ));
}

async function fromIndexer(holdersUrl: string | undefined): Promise<Holder[] | null> {
  if (!holdersUrl) return null;
  try {
    const res = await fetch(holdersUrl);
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

/**
 * The top holders. Null on any failure; the caller keeps whatever it had.
 *
 * An indexer with no RPC beside it is usable: `supply` is only needed for the
 * share a holder owns, and ranking — which is what seats people — needs only
 * the balances.
 */
export async function readHolderList(source: HolderSource): Promise<HolderList | null> {
  const { holdersUrl, rpcUrl, mint, manifestSize } = source;
  const rpc = rpcUrl ? rpcCall(rpcUrl) : null;

  let supply = 0;
  if (rpc && mint) {
    const supplyRes = await rpc<{ value: TokenAmount }>('getTokenSupply', [mint]);
    if (supplyRes) {
      supply = supplyRes.value.uiAmount ?? Number(supplyRes.value.amount) / 10 ** supplyRes.value.decimals;
    } else if (!holdersUrl) {
      // No indexer and an RPC that will not answer: nothing to seat anybody by.
      return null;
    }
  }

  const indexed = await fromIndexer(holdersUrl);
  if (indexed && indexed.length) {
    // Only as many as could be seated, with room for the contracts that will
    // drop out. The account lookup batches, so this is no longer pinned to
    // getMultipleAccounts' hundred.
    const top = [...indexed].sort((a, b) => b.balance - a.balance).slice(0, manifestSize + 10);
    const people = rpc ? await peopleOnly(rpc, top) : top;
    if (people) return { holders: people, supply, live: true };
  }

  if (!rpc || !mint) return null;

  const largest = await rpc<{ value: LargestAccount[] }>('getTokenLargestAccounts', [mint]);
  if (!largest) return null;

  const rows = largest.value.slice(0, manifestSize);
  const owners = await ownersOf(rpc, rows.map((r) => r.address));
  const holders = rows
    .map((r, i) => ({
      address: owners[i] ?? r.address,
      balance: r.uiAmount ?? Number(r.amount) / 10 ** r.decimals,
    }))
    .filter((h) => h.balance > 0);

  const people = await peopleOnly(rpc, holders);
  if (!people) return null;
  return { holders: people, supply, live: true };
}
