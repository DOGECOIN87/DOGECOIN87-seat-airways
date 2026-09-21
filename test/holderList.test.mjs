/**
 * Reading the aircraft off the chain.
 *
 * The case this exists for: `getMultipleAccounts` refuses more than a hundred
 * addresses. With a cabin of forty nobody ever noticed; with the whole
 * aircraft of 178 an unbatched call errors, which this module reads as "the
 * chain could not be asked" — so a full manifest would quietly fall back to
 * the twenty largest accounts and the aeroplane would look like it had sold
 * out at row 4. A wrong aircraft is also a wrong set of section permissions,
 * since the ladder is what decides who may read whose card.
 *
 *   npm test
 */
import { readHolderList } from '../dist-test/holderList.js';

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const SYSTEM = '11111111111111111111111111111111';
const RPC = 'https://rpc.test';
const INDEXER = 'https://indexer.test/holders';

/* A token account as `getProgramAccounts` hands it back with the slice this
   code asks for: 32 bytes of owner, then the balance as a little-endian u64.
   Built here as bytes on purpose — the point of the case is that the bytes
   decode to the address a holder would recognise. */
const account = (owner, amount) => {
  const bytes = new Uint8Array(40);
  bytes.set(owner, 0);
  new DataView(bytes.buffer).setBigUint64(32, BigInt(amount), true);
  return { account: { data: [Buffer.from(bytes).toString('base64'), 'base64'] } };
};

/* 31 zero bytes and then n. Base58 writes leading zeros as '1', so such an
   address is 31 ones and a single digit — which means the address a given
   owner must decode to can be written down here rather than produced by a
   second copy of the encoder that could be wrong in the same way. */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ownerBytes = (n) => { const b = new Uint8Array(32); b[30] = n >> 8; b[31] = n & 0xff; return b; };
const ownerAddress = (n) => '1'.repeat(31) + B58[n];

/** A fake chain. Records every call so the batching is observable. */
function chain({ holders = [], programOwned = [], failPage = -1, largest = [], tokenAccounts = null, decimals = 0 } = {}) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url) === INDEXER) {
      calls.push({ method: 'indexer' });
      return { ok: true, json: async () => holders };
    }
    const body = JSON.parse(init.body);
    calls.push({ method: body.method, params: body.params });
    const reply = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });

    switch (body.method) {
      case 'getTokenSupply':
        return reply({ value: { amount: '1000000', decimals, uiAmount: 1_000_000 } });
      // Unset means an endpoint that will not run the scan, which is several
      // of the public ones and the reason the twenty are still in the code.
      case 'getProgramAccounts':
        return reply(tokenAccounts);
      case 'getTokenLargestAccounts':
        return reply({ value: largest });
      case 'getMultipleAccounts': {
        const page = calls.filter((c) => c.method === 'getMultipleAccounts').length - 1;
        if (page === failPage) return { ok: false, json: async () => ({}) };
        const addresses = body.params[0];
        return reply({
          value: addresses.map((address) => (
            body.params[1]?.encoding === 'jsonParsed'
              // Resolving token accounts to their owners: "owner-of-<account>".
              ? { data: { parsed: { info: { owner: `owner-of-${address}` } } } }
              // Existence check: a program-owned account is a contract.
              : programOwned.includes(address) ? { owner: 'SomeProgram1111111111111111111111111111111' } : null
          )),
        });
      }
      default:
        return reply(null);
    }
  };
  return calls;
}

const people = (n) => Array.from({ length: n }, (_, i) => ({ address: `wallet${i}`, balance: 1000 - i }));

console.log('\nholder list');

await check('an indexer of 178 holders is read in batches of a hundred', async () => {
  const calls = chain({ holders: people(178) });
  const list = await readHolderList({ holdersUrl: INDEXER, rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });

  assert(list, 'no holder list came back');
  const lookups = calls.filter((c) => c.method === 'getMultipleAccounts');
  assert(lookups.length === 2, `expected 2 account lookups, got ${lookups.length}`);
  assert(lookups[0].params[0].length === 100, `first batch was ${lookups[0].params[0].length}, must not exceed 100`);
  assert(lookups[1].params[0].length === 78, `second batch was ${lookups[1].params[0].length}`);
  assert(list.holders.length === 178, `seated ${list.holders.length} of 178`);
});

await check('a cabin of forty still asks once', async () => {
  const calls = chain({ holders: people(178) });
  await readHolderList({ holdersUrl: INDEXER, rpcUrl: RPC, mint: 'MINT', manifestSize: 40 });
  const lookups = calls.filter((c) => c.method === 'getMultipleAccounts');
  assert(lookups.length === 1, `expected 1 lookup for 50 addresses, got ${lookups.length}`);
});

await check('a contract is not a passenger, whichever batch it is in', async () => {
  chain({ holders: people(150), programOwned: ['wallet0', 'wallet120'] });
  const list = await readHolderList({ holdersUrl: INDEXER, rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });
  assert(list.holders.length === 148, `expected 148 people, got ${list.holders.length}`);
  assert(!list.holders.some((h) => h.address === 'wallet0'), 'a program-owned account in the first batch was seated');
  assert(!list.holders.some((h) => h.address === 'wallet120'), 'a program-owned account in the second batch was seated');
});

await check('one unanswered batch is not a half-read aircraft', async () => {
  /* The whole list is a guess if any page of it is, and guessing seats a
     bonding curve in 1A. Falling back to the largest accounts is the honest
     answer — so the fallback is what should appear here, not 100 of 150. */
  chain({
    holders: people(150),
    failPage: 1,
    largest: [{ address: 'tokenacct1', amount: '500', decimals: 0, uiAmount: 500 }],
  });
  const list = await readHolderList({ holdersUrl: INDEXER, rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });
  assert(list === null || list.holders.length !== 100, 'a partial read was passed off as the manifest');
});

await check('with no indexer the whole cabin still comes off the chain', async () => {
  /* The case this tier exists for. getTokenLargestAccounts stops at twenty —
     the flight deck, all of first, ten business seats — so without an indexer
     the aeroplane used to end in the middle of row 4 however many holders
     turned up. Asking the token program for its own accounts has no cap. */
  const calls = chain({
    tokenAccounts: Array.from({ length: 178 }, (_, i) => account(ownerBytes(i + 1), 1000 - i)),
  });
  const list = await readHolderList({ rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });

  assert(list, 'the chain returned no aircraft at all');
  assert(list.holders.length === 178, `seated ${list.holders.length} of 178 from the mint alone`);
  assert(new Set(list.holders.map((h) => h.address)).size === 178, 'two owners decoded to one address');
  assert(!calls.some((c) => c.method === 'getTokenLargestAccounts'),
    'settled for twenty accounts when the whole list was there to be had');
});

await check('the scan is pinned to token accounts, to this mint, and to 40 bytes', async () => {
  /* Every one of these is load-bearing. Without the size and the mint this
     reads every account the token program owns — every token on Solana —
     and without the slice it drags back the full 165 bytes of each of them
     on every cache miss. */
  const calls = chain({ tokenAccounts: [account(ownerBytes(1), 5)] });
  await readHolderList({ rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });

  const scan = calls.find((c) => c.method === 'getProgramAccounts');
  assert(scan, 'the chain was never asked for the holder list');
  const [program, options] = scan.params;
  assert(program === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', `asked the wrong program: ${program}`);
  assert(options.filters.some((f) => f.dataSize === 165), 'nothing pinned the results to token accounts');
  assert(options.filters.some((f) => f.memcmp?.offset === 0 && f.memcmp?.bytes === 'MINT'),
    'the scan was not pinned to this mint');
  assert(options.dataSlice?.offset === 32 && options.dataSlice?.length === 40,
    'the whole account was fetched where the owner and the balance would do');
});

await check('a wallet holding two token accounts gets one seat, for the total', async () => {
  /* A manifest names people, not accounts, and one wallet can hold the same
     mint several times over. Two bags is one passenger with a bigger bag. */
  chain({ tokenAccounts: [
    account(ownerBytes(1), 300),
    account(ownerBytes(2), 400),
    account(ownerBytes(1), 500),
  ] });
  const list = await readHolderList({ rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });

  assert(list.holders.length === 2, `expected 2 people, got ${list.holders.length}`);
  const top = list.holders.find((h) => h.address === ownerAddress(1));
  assert(top, `owner bytes did not decode to an address: ${list.holders.map((h) => h.address).join(', ')}`);
  assert(top.balance === 800, `two bags did not add up: ${top.balance}`);
});

await check('balances arrive in whole tokens, and an empty account is nobody', async () => {
  chain({ decimals: 6, tokenAccounts: [account(ownerBytes(1), 1_500_000), account(ownerBytes(2), 0)] });
  const list = await readHolderList({ rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });
  assert(list.holders.length === 1, `an account holding nothing was seated: ${list.holders.length}`);
  assert(list.holders[0].balance === 1.5, `the token's decimals were not applied: ${list.holders[0].balance}`);
});

await check('an endpoint that refuses the scan still seats the front of the aircraft', async () => {
  const calls = chain({
    largest: Array.from({ length: 20 }, (_, i) => ({
      address: `tokenacct${i}`, amount: String(100 - i), decimals: 0, uiAmount: 100 - i,
    })),
  });
  const list = await readHolderList({ rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });
  assert(calls.some((c) => c.method === 'getProgramAccounts'), 'the uncapped path was never tried');
  assert(list, 'the RPC fallback returned nothing');
  assert(list.holders.length === 20, `expected the RPC cap of 20, got ${list.holders.length}`);
  assert(list.holders[0].address === 'owner-of-tokenacct0', `token account not resolved: ${list.holders[0].address}`);
});

await check('an indexer is still preferred to scanning the chain', async () => {
  const calls = chain({ holders: people(30), tokenAccounts: [account(ownerBytes(1), 999)] });
  const list = await readHolderList({ holdersUrl: INDEXER, rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });
  assert(list.holders.length === 30, `the indexer's answer was not used: ${list.holders.length}`);
  assert(!calls.some((c) => c.method === 'getProgramAccounts'),
    'the chain was scanned although an indexer had already answered');
});

await check('with neither an indexer nor an RPC there is no aircraft', async () => {
  chain({});
  assert(await readHolderList({ manifestSize: 178 }) === null, 'a manifest appeared from nowhere');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
