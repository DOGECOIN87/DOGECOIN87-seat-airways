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

/** A fake chain. Records every call so the batching is observable. */
function chain({ holders = [], programOwned = [], failPage = -1, largest = [] } = {}) {
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
        return reply({ value: { amount: '1000000', decimals: 0, uiAmount: 1_000_000 } });
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

await check('with no indexer it falls back to the largest accounts, resolved to owners', async () => {
  chain({
    largest: Array.from({ length: 20 }, (_, i) => ({
      address: `tokenacct${i}`, amount: String(100 - i), decimals: 0, uiAmount: 100 - i,
    })),
  });
  const list = await readHolderList({ rpcUrl: RPC, mint: 'MINT', manifestSize: 178 });
  assert(list, 'the RPC fallback returned nothing');
  assert(list.holders.length === 20, `expected the RPC cap of 20, got ${list.holders.length}`);
  assert(list.holders[0].address === 'owner-of-tokenacct0', `token account not resolved: ${list.holders[0].address}`);
});

await check('with neither an indexer nor an RPC there is no aircraft', async () => {
  chain({});
  assert(await readHolderList({ manifestSize: 178 }) === null, 'a manifest appeared from nowhere');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
