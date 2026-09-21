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
 * There is a way to get the rest of them out of a plain RPC, though, and it
 * is the one every explorer uses: ask the token program for every account it
 * owns whose mint field is this mint. That is the whole holder list, and
 * it is not capped at twenty. It is only expensive — a scan the RPC has to do
 * — so some endpoints refuse it and none of them enjoy it.
 *
 * So there are three sources, tried in that order:
 *
 *   holdersUrl    JSON `[{ address, balance }, …]` from an indexer, uncapped
 *   rpcUrl+mint   every token account for the mint, summed by owner: the
 *                 whole aircraft, from the mint alone, no indexer required
 *   …and failing  the twenty largest accounts, which fills the front of the
 *   that          aircraft and leaves the rest empty
 *
 * All three then drop accounts owned by a program, because a bonding curve is
 * not a passenger.
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

/**
 * The two token programs, because there are two and a mint belongs to one.
 *
 * ── The failure this pair exists to prevent ───────────────────────────────
 * `getProgramAccounts` is asked *of a program*. Asking the wrong one is not
 * an error and does not look like a mistake: it is an empty list, and an
 * empty list reads here as "this token has no holders". The aeroplane comes
 * back with nobody on it and nothing anywhere says why.
 *
 * That is not hypothetical. This code scanned only classic SPL Token, and
 * the first real mint it was pointed at was a Token-2022 one — so it found
 * zero accounts for a token with a billion in supply, and was right to,
 * having asked a program that owns none of them.
 */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * A token account's layout, in the two fields worth reading.
 *
 * 165 bytes: the mint (which this asked for by name), then the owner, then
 * the balance. Asking for the 40 bytes spanning the last two is the whole
 * reason this path is affordable — the alternative is `jsonParsed`, which
 * returns every field of every account of a token that may have tens of
 * thousands of them, and does it on every cache miss.
 */
const OWNER_OFFSET = 32;
const OWNER_AND_AMOUNT = 40;
const TOKEN_ACCOUNT_BYTES = 165;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * 32 raw bytes back into the address a person would recognise.
 *
 * Needed because the compact read above hands back bytes rather than the
 * base58 the rest of the aircraft is keyed by — and a wallet has to arrive
 * here spelled exactly as it arrives from a signature, or the holder who owns
 * it will not match their own seat.
 */
function toBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => B58[d]).join('');
}

/** Base64 to bytes, with `atob` rather than a dependency. */
function fromBase64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

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

/**
 * Everybody who holds the mint, read off the chain itself.
 *
 * This is what makes "seat the cabin from the mint" true rather than nearly
 * true. `getTokenLargestAccounts` stops at twenty, which is the flight deck,
 * all of first and ten business seats — so without an indexer the aeroplane
 * ended in the middle of row 4 however many holders turned up, and the people
 * down the back had nobody behind them and nobody to read.
 *
 * Asking the token program for its own accounts has no such cap. The filters
 * are what keep it from being a scan of every token on Solana: the size pins
 * it to token accounts, and the memcmp pins those to this mint, both of which
 * the RPC indexes.
 *
 * ── What it costs, and why it is third rather than first ──────────────────
 * The RPC still has to walk that index, and a popular token has a lot of
 * accounts. So this is asked only when there is no indexer, the answer is
 * cached by both callers, and the slice above keeps the response to 40 bytes
 * of account data rather than a parsed object each. Endpoints that refuse the
 * call outright — several public ones do — return nothing, which reads here
 * as "could not be asked" and falls through to the twenty.
 *
 * Summed by owner, because one wallet can hold the same mint in several token
 * accounts and a manifest names people, not accounts. A wallet with two bags
 * has one seat, and it is the seat the total earns.
 */
async function fromTokenAccounts(
  rpc: <T>(method: string, params: unknown[]) => Promise<T | null>,
  mint: string,
  decimals: number,
  program: string,
): Promise<Holder[] | null> {
  /* ── Why the size filter is only for the classic program ─────────────────
     A classic SPL token account is exactly 165 bytes, so the size pins the
     results to token accounts precisely and cheaply.

     A Token-2022 account is those same 165 bytes and then, when it carries
     any extension, a type byte and the extension records after it. An
     associated token account made through the ATA program always carries
     ImmutableOwner — so demanding exactly 165 there would exclude very
     nearly every real holder, which is the same silence as asking the wrong
     program in the first place.

     Dropping it is safe because the memcmp is doing the work. Bytes 0 to 32
     of a token account are the mint, and nothing else this program owns has
     a 32-byte mint sitting at offset zero: a mint account begins with the
     four-byte option tag of its authority, and a multisig with two small
     integers. The first 165 bytes are laid out identically either way, which
     is why one slice reads both. */
  const filters: unknown[] = [{ memcmp: { offset: 0, bytes: mint } }];
  if (program === TOKEN_PROGRAM) filters.unshift({ dataSize: TOKEN_ACCOUNT_BYTES });

  const accounts = await rpc<{ account: { data: [string, string] } }[]>('getProgramAccounts', [
    program,
    {
      encoding: 'base64',
      dataSlice: { offset: OWNER_OFFSET, length: OWNER_AND_AMOUNT },
      filters,
    },
  ]);
  if (!Array.isArray(accounts)) return null;

  const byOwner = new Map<string, number>();
  for (const entry of accounts) {
    const bytes = typeof entry?.account?.data?.[0] === 'string' ? fromBase64(entry.account.data[0]) : null;
    // A short or unreadable account is one account skipped, not a failed read
    // of the aircraft: `null` here would mean "the chain could not be asked",
    // which is a different and much louder thing.
    if (!bytes || bytes.length < OWNER_AND_AMOUNT) continue;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const amount = view.getBigUint64(OWNER_OFFSET, true);
    if (amount === 0n) continue;
    const owner = toBase58(bytes.subarray(0, OWNER_OFFSET));
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + Number(amount) / 10 ** decimals);
  }
  return [...byOwner].map(([address, balance]) => ({ address, balance }));
}

interface IndexedList {
  holders: Holder[];
  /** Zero when the feed does not carry one. */
  supply: number;
}

/**
 * A holder list from a URL, in either of the two shapes one arrives in.
 *
 * A third-party indexer returns the bare array this has always read. The
 * Worker's own `GET /holders` wraps that in an object carrying the supply as
 * well — because a page reading it has no RPC of its own to ask for one, and
 * a balance is only interesting as a share of something.
 */
/**
 * Which of the two token programs owns this mint.
 *
 * One cheap call — no account data comes back, only the owner — and it is
 * what turns "scan for holders" from a guess into a question with an
 * address on it. Null when the chain cannot be asked, or when the mint is
 * owned by neither program and so is not a token this knows how to read:
 * both send the caller on to `getTokenLargestAccounts`, which needs no
 * program because the RPC resolves the mint itself.
 */
async function mintProgram(
  rpc: <T>(method: string, params: unknown[]) => Promise<T | null>,
  mint: string,
): Promise<string | null> {
  const info = await rpc<{ value: { owner?: unknown } | null }>('getAccountInfo', [
    mint,
    { encoding: 'base64', dataSlice: { offset: 0, length: 0 } },
  ]);
  const owner = info?.value?.owner;
  if (owner !== TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) return null;
  return owner;
}

async function fromIndexer(holdersUrl: string | undefined): Promise<IndexedList | null> {
  if (!holdersUrl) return null;
  try {
    const res = await fetch(holdersUrl);
    if (!res.ok) return null;
    const body: unknown = await res.json();

    const wrapped = body as { holders?: unknown; supply?: unknown };
    const rows = Array.isArray(body) ? body : Array.isArray(wrapped.holders) ? wrapped.holders : null;
    if (!rows) return null;

    const supply = Number(wrapped.supply);
    return {
      holders: rows
        .map((h) => h as { address?: unknown; balance?: unknown })
        .filter((h) => typeof h.address === 'string' && Number.isFinite(Number(h.balance)))
        .map((h) => ({ address: String(h.address), balance: Number(h.balance) })),
      supply: Number.isFinite(supply) ? supply : 0,
    };
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
  // Kept rather than discarded: the balances in a raw token account are
  // integers in the token's smallest unit, and this is what turns them back
  // into the number a holder recognises as their bag.
  let decimals = 0;
  if (rpc && mint) {
    const supplyRes = await rpc<{ value: TokenAmount }>('getTokenSupply', [mint]);
    if (supplyRes) {
      decimals = supplyRes.value.decimals;
      supply = supplyRes.value.uiAmount ?? Number(supplyRes.value.amount) / 10 ** decimals;
    } else if (!holdersUrl) {
      // No indexer and an RPC that will not answer: nothing to seat anybody by.
      return null;
    }
  }

  const indexed = await fromIndexer(holdersUrl);
  if (indexed && indexed.holders.length) {
    // Only as many as could be seated, with room for the contracts that will
    // drop out. The account lookup batches, so this is no longer pinned to
    // getMultipleAccounts' hundred.
    const top = [...indexed.holders].sort((a, b) => b.balance - a.balance).slice(0, manifestSize + 10);
    /* With no RPC there is nothing to check accounts against — which is the
       state a page is in once it reads holders from the Worker rather than
       the chain. Nothing is lost by it: that feed has already dropped the
       contracts, because the Worker had an RPC when it built the list. */
    const people = rpc ? await peopleOnly(rpc, top) : top;
    if (people) return { holders: people, supply: supply || indexed.supply, live: true };
  }

  if (!rpc || !mint) return null;

  /* The whole aircraft, off the chain. Only as many as could be seated, with
     room for the contracts that will drop out — the same slice the indexer
     path takes, and for the same reason: a row nobody can be shown is a row
     not worth looking up. */
  const program = await mintProgram(rpc, mint);
  const everybody = program ? await fromTokenAccounts(rpc, mint, decimals, program) : null;
  if (everybody && everybody.length) {
    const top = [...everybody].sort((a, b) => b.balance - a.balance).slice(0, manifestSize + 10);
    const people = await peopleOnly(rpc, top);
    if (people) return { holders: people, supply, live: true };
  }

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
