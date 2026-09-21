/**
 * Reading a holding without shipping an RPC key to the browser.
 *
 * `VITE_RPC_URL` used to be how the page read the chain, and Vite inlines
 * every VITE_ value into the bundle it ships — so a paid endpoint's API key
 * was readable by anybody who opened the site. The defence on offer was to
 * restrict the key by domain at the provider, which is the `Origin` header,
 * which is a string anybody with curl can type.
 *
 * The page asks the Worker now. These cases pin the two halves of that: the
 * request goes to the Worker and nowhere else, and a Worker that cannot
 * answer is never mistaken for a wallet that holds nothing — a holder told
 * they hold nothing is reseated into the hold and shut out of the cabin.
 *
 *   npm test
 */
import { holdingsSource, isConfigured, readHolders } from '../dist-test/holdings.js';

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/** What `VITE_BANNERS_API` is defined as for the test build. */
const API = 'https://adverts.test';

/** Records every URL asked for, so "nothing else was asked" is checkable. */
function serving(reply) {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push(String(url));
    return reply(String(url), init);
  };
  return asked;
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const refuses = (status) => ({ ok: false, status, json: async () => ({ error: 'no' }) });

console.log('\nholdings');

await check('a Worker is enough: no RPC key needs to be in the bundle', () => {
  assert(isConfigured === true, 'a deployment with a Worker did not count as configured');
});

await check('a balance comes from the Worker', async () => {
  const asked = serving(() => ok({ balance: 250, supply: 1000 }));
  const holding = await holdingsSource.read('wallet-1');

  assert(holding, 'no holding came back');
  assert(holding.balance === 250, `balance: ${holding.balance}`);
  assert(holding.supply === 1000, `supply: ${holding.supply}`);
  assert(asked.length === 1, `expected one request, got ${asked.length}`);
  assert(asked[0].startsWith(`${API}/holding?address=`), `asked the wrong place: ${asked[0]}`);
});

await check('the share is worked out here rather than taken on trust', async () => {
  /* Share is what decides a seat. A feed that says the wrong one — by bug or
     otherwise — should not be able to move somebody up the aircraft. */
  serving(() => ok({ balance: 1, supply: 4, share: 0.99 }));
  const holding = await holdingsSource.read('wallet-1');
  assert(holding.share === 0.25, `a supplied share was believed: ${holding.share}`);
});

await check('a Worker that cannot ask is not a zero balance', async () => {
  serving(() => refuses(503));
  assert(await holdingsSource.read('wallet-1') === null, 'a 503 was read as holding nothing');
});

await check('nor is an answer that is not a number', async () => {
  serving(() => ok({ balance: 'lots', supply: 1000 }));
  assert(await holdingsSource.read('wallet-1') === null, 'a non-number was read as a balance');
});

await check('nor is a request that throws', async () => {
  serving(() => { throw new Error('offline'); });
  assert(await holdingsSource.read('wallet-1') === null, 'an outage was read as holding nothing');
});

await check('the address is escaped into the query', async () => {
  const asked = serving(() => ok({ balance: 1, supply: 2 }));
  await holdingsSource.read('a b&c');
  assert(asked[0].endsWith('address=a%20b%26c'), `not escaped: ${asked[0]}`);
});

await check('the holder list comes from the Worker, supply and all', async () => {
  /* The other read the page used to open an RPC for. With no `VITE_RPC_URL`
     there is no endpoint to fall back to, so if this did not work the cabin
     would simply be empty — and the supply has to ride along with the list,
     because a bag is only interesting as a share of something. */
  const asked = serving((url) => (
    url.startsWith(`${API}/holders`)
      ? ok({ holders: [{ address: 'w1', balance: 9 }, { address: 'w2', balance: 4 }], supply: 5000 })
      : refuses(500)
  ));
  const list = await readHolders();

  assert(list, 'no holder list came back');
  assert(list.holders.length === 2, `holders: ${list.holders.length}`);
  assert(list.supply === 5000, `the feed's supply was dropped: ${list.supply}`);
  assert(asked.every((url) => url.startsWith(API)), `something other than the Worker was asked: ${asked}`);
});

await check('a bare array is still a holder list, for a third-party indexer', async () => {
  serving(() => ok([{ address: 'w1', balance: 3 }]));
  const list = await readHolders();
  assert(list?.holders.length === 1, 'the shape an indexer returns stopped being readable');
  assert(list.supply === 0, `a supply appeared from nowhere: ${list.supply}`);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
