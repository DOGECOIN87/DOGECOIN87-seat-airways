/**
 * The Worker, over real HTTP.
 *
 * `verify.test.mjs` proves the checks are right in isolation. This proves the
 * routes wire them up: a real ed25519 keypair signs a real challenge, the
 * request goes over the wire to a running Worker with real KV and R2
 * bindings, and the advert comes back out of GET /banners afterwards.
 *
 * Run against `wrangler dev --local`:
 *   npm run test:e2e            # expects the Worker on :8787
 */
import { webcrypto as crypto } from 'node:crypto';
import { createServer } from 'node:http';

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const ORIGIN = 'http://localhost:3000';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const toBase58 = (bytes) => {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
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
};

const challenge = (owner, hash, issued) =>
  ['SEAT AIRLINES', 'Publish this advert on my seat.', '', `wallet: ${owner}`, `image:  sha256:${hash}`, `issued: ${issued}`].join('\n');

const sha256Hex = async (bytes) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const post = (body) =>
  fetch(`${BASE}/banner`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });

// A wallet, and a one-pixel JPEG.
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const owner = toBase58(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(JPEG).toString('base64');
const sign = async (msg) =>
  toBase58(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(msg))));

const signedBody = async (overrides = {}) => {
  const issued = overrides.issued ?? new Date().toISOString();
  const image = overrides.image ?? dataUrl;
  const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  const hash = await sha256Hex(bytes);
  return {
    owner, image, issued, alt: 'A test advert',
    signature: await sign(challenge(owner, hash, issued)),
    ...overrides,
  };
};

console.log('\nworker routes');

await check('GET /banners returns JSON', async () => {
  const res = await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } });
  assert(res.status === 200, `status ${res.status}`);
  assert(typeof (await res.json()) === 'object', 'not an object');
});

await check('CORS echoes the allowed origin', async () => {
  const res = await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } });
  assert(res.headers.get('access-control-allow-origin') === ORIGIN, 'origin not echoed');
});

await check('OPTIONS preflight is answered', async () => {
  const res = await fetch(`${BASE}/banner`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
  assert(res.status === 204, `status ${res.status}`);
});

await check('a genuine signed advert is accepted and stored', async () => {
  const res = await post(await signedBody());
  const body = await res.json();
  assert(res.status === 200, `status ${res.status}: ${JSON.stringify(body)}`);
  assert(typeof body.image === 'string' && /\/banners\/[0-9a-f]{32}\.jpg/.test(body.image),
    `no image url back: ${body.image}`);
});

await check('the stored advert appears on the wall', async () => {
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  assert(wall[owner], 'owner not on the wall');
  assert(wall[owner].alt === 'A test advert', 'alt did not round-trip');
});

await check('the artwork is addressable, and served correctly in KV mode', async () => {
  /* The gap the other cases left: they proved the record round-trips, not the
     bytes.

     What can be asserted depends on where the bytes went. In KV mode the
     Worker serves them, so this is the exact path an <img> takes and every
     header is checkable. In R2 mode the URL points at the bucket's public
     domain, which is not this Worker and is not reachable from a test runner
     — so the check is that the URL is well formed and on the configured base.
     Fetching it would be testing Cloudflare's CDN, not this code. */
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  const url = wall[owner].image;
  assert(typeof url === 'string' && /\/banners\/[0-9a-f]{32}\.(jpg|png|webp)$/.test(url),
    `image url is not addressed by its content: ${url}`);

  const servedByWorker = url.startsWith(BASE);
  if (!servedByWorker) {
    assert(/^https:\/\/.+\/banners\/[0-9a-f]{32}\.(jpg|png|webp)$/.test(url), `malformed R2 url: ${url}`);
    return;
  }

  const res = await fetch(url);
  assert(res.status === 200, `status ${res.status}`);
  assert(res.headers.get('content-type') === 'image/jpeg', `type ${res.headers.get('content-type')}`);
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
  const back = new Uint8Array(await res.arrayBuffer());
  assert(back.length === JPEG.length, `got ${back.length} bytes, sent ${JPEG.length}`);
  assert(back[0] === 0xff && back[1] === 0xd8 && back[2] === 0xff, 'not JPEG bytes');
});

await check('the artwork is readable as a WebGL texture', async () => {
  /* The regression this pins: the adverts on the cabin's seat-back screens
     are textures, not <img> tags, and three.js requests every texture with
     crossOrigin="anonymous". Answer one without access-control-allow-origin
     and the browser throws the bytes away — so the screens showed the
     airline's mark, the seat map showed the advert, and nothing in either
     console said why, because TextureLoader reports nothing when it is not
     given an error handler.

     `*` rather than the echoed origin on purpose: this is public artwork
     served without credentials, and it is read from a texture loader whose
     request carries the *page's* origin, not the wall's. */
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  const url = wall[owner].image;
  if (!url.startsWith(BASE)) return; // R2 mode: the bucket's CDN sets this.

  const res = await fetch(url, { headers: { origin: 'https://seat-airlines.space' } });
  assert(res.headers.get('access-control-allow-origin') === '*', 'a texture loader could not read this image');

  const head = await fetch(url, { method: 'HEAD' });
  assert(head.status === 200, `HEAD says ${head.status} where GET says 200`);
  assert(head.headers.get('content-type') === 'image/jpeg', `HEAD type ${head.headers.get('content-type')}`);
});

await check('the image URL is the image, so a replacement cannot be read from cache', async () => {
  /* The failure this pins: an advert overwritten in place keeps its URL, so
     the holder who publishes a second one is handed the URL their browser
     cached for the first. The publish succeeds, the seat keeps showing the
     old picture, and it looks like nothing saved.

     The key is the hash of the bytes, which settles it at the storage layer
     rather than with a cache-busting query: different artwork is a different
     URL because it is a different image, and the same artwork is the same
     URL, which is why these can then be served immutable for a year.

     Replacing one for real is not exercised here — the cooldown is a minute
     and an e2e suite should not sit through it. What is checked is the
     property the whole scheme rests on: the URL is derived from the bytes
     that were uploaded, and nothing else. */
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  const url = wall[owner].image;

  const hash = await sha256Hex(JPEG);
  assert(url.includes(`banners/${hash.slice(0, 32)}.jpg`), `the url is not this image's hash: ${url}`);

  if (!url.startsWith(BASE)) return; // R2 mode: the bucket serves these.
  const res = await fetch(url);
  assert(res.status === 200, `a content-addressed url did not serve the bytes: ${res.status}`);
  assert((await res.arrayBuffer()).byteLength === JPEG.length, 'it served the wrong bytes');
  assert(/immutable/.test(res.headers.get('cache-control') ?? ''),
    `a url that can only ever mean these bytes was not cacheable: ${res.headers.get('cache-control')}`);
});

await check('a second publish is rate limited', async () => {
  const res = await post(await signedBody());
  assert(res.status === 429, `status ${res.status}, expected 429`);
});

await check('a forged signature is refused', async () => {
  const body = await signedBody();
  const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  body.owner = toBase58(new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey)));
  const res = await post(body);
  assert(res.status === 401, `status ${res.status}, expected 401`);
});

await check('a stale signature is refused', async () => {
  const res = await post(await signedBody({ issued: new Date(Date.now() - 20 * 60_000).toISOString() }));
  assert(res.status === 400, `status ${res.status}, expected 400`);
});

await check('SVG wearing a JPEG label is refused', async () => {
  const svg = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
  const res = await post(await signedBody({ image: `data:image/jpeg;base64,${svg}` }));
  assert(res.status === 415, `status ${res.status}, expected 415`);
});

await check('an unsigned request is refused', async () => {
  const res = await post({ owner, image: dataUrl, issued: new Date().toISOString() });
  assert(res.status === 400, `status ${res.status}, expected 400`);
});

await check('an unknown route 404s', async () => {
  const res = await fetch(`${BASE}/nope`, { headers: { origin: ORIGIN } });
  assert(res.status === 404, `status ${res.status}`);
});

/* ── Taking an advert down ────────────────────────────────────────────────
   The advert published above is still up. A takedown is signed over text
   naming the wallet and the advert's own storage key, so these prove the
   route refuses every way of bending that, and then that a genuine one
   really does take the advert off the wall. */

const takedownChallenge = (who, key, issued) =>
  ['SEAT AIRLINES', 'Take the advert off my seat.', '', `wallet: ${who}`, `advert: ${key}`, `issued: ${issued}`].join('\n');
const takeDown = (body) =>
  fetch(`${BASE}/banner`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify(body),
  });
const publishedKey = async () => {
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  const url = wall[owner]?.image;
  return url ? /(banners\/[^/?]+)/.exec(decodeURIComponent(new URL(url).pathname))?.[1] : undefined;
};
const takedownBody = async (key, issued = new Date().toISOString()) =>
  ({ owner, key, issued, signature: await sign(takedownChallenge(owner, key, issued)) });

await check('a takedown signed for a different advert is refused', async () => {
  const res = await takeDown(await takedownBody('banners/00000000000000000000000000000000.jpg'));
  assert(res.status === 409, `status ${res.status}, expected 409`);
});

await check('a forged takedown is refused', async () => {
  const key = await publishedKey();
  assert(key, 'no advert on the wall to take down');
  const body = await takedownBody(key);
  const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  body.owner = toBase58(new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey)));
  const res = await takeDown(body);
  assert(res.status === 401, `status ${res.status}, expected 401`);
});

await check('a stale takedown is refused', async () => {
  const res = await takeDown(await takedownBody(await publishedKey(), new Date(Date.now() - 20 * 60_000).toISOString()));
  assert(res.status === 400, `status ${res.status}, expected 400`);
});

await check('a genuine takedown takes the advert off the wall', async () => {
  const res = await takeDown(await takedownBody(await publishedKey()));
  assert(res.status === 200, `status ${res.status}: ${await res.text()}`);
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  assert(!wall[owner], 'the advert is still on the wall');
});

await check('taking down an advert that is already gone is a 404', async () => {
  const res = await takeDown(await takedownBody('banners/0123456789abcdef0123456789abcdef.jpg'));
  assert(res.status === 404, `status ${res.status}, expected 404`);
});

/* ── The cabin directory ──────────────────────────────────────────────────
   Profiles and introductions, which used to be localStorage and so were
   never read by anybody else. These cases are the proof that they are now:
   one wallet publishes a card and sends a note, and a *different* wallet,
   with its own session, reads both back. */

console.log('\ncabin directory');

const signInText = (address, issued) =>
  [
    'SEAT AIRLINES',
    'Sign in to the cabin directory.',
    '',
    'This lets you publish your card, read your section, and send and',
    'receive introductions for one day. It authorises no transaction.',
    '',
    `wallet: ${address}`,
    `issued: ${issued}`,
  ].join('\n');

const wallet = async () => {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const address = toBase58(bytes);
  const signWith = async (msg) =>
    toBase58(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(msg))));
  return { address, bytes, sign: signWith };
};

/* A token account as the chain returns it under the slice the Worker asks
   for: 32 bytes of owner, then the balance as a little-endian u64. Built
   from a real public key so that what comes back out the far end can be
   checked against the address that key actually signs with. */
const tokenAccount = (owner, amount) => {
  const buf = new Uint8Array(40);
  buf.set(owner, 0);
  new DataView(buf.buffer).setBigUint64(32, BigInt(amount), true);
  return { account: { data: [Buffer.from(buf).toString('base64'), 'base64'] } };
};

const signInBody = async (who, issued = new Date().toISOString()) => ({
  address: who.address,
  issued,
  signature: await who.sign(signInText(who.address, issued)),
});

const api = (path, { method = 'GET', token, body } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const alice = await wallet();
const bob = await wallet();
// Seated ahead of them both, and seated well behind them.
const captain = await wallet();
const mabel = await wallet();
let aliceToken = '';
let bobToken = '';

/* The holder feed the Worker seats people from.

   The section rules cannot be tested without one: the Worker has to believe
   somebody is on the flight deck and somebody else is in business before
   "reads down the aircraft, never up" means anything. So the suite serves the
   list itself, at the URL wrangler.local.toml points the Worker at, and seats
   the wallets it has just generated.

   Ranks 1–2 are the flight deck, 3–10 first, 11 onwards business. */
const filler = await Promise.all(Array.from({ length: 7 }, () => wallet()));
const holderList = [
  { address: captain.address, balance: 1_000_000 },
  { address: filler[0].address, balance: 900_000 },
  { address: alice.address, balance: 800_000 },
  { address: bob.address, balance: 700_000 },
  ...filler.slice(1).map((w, i) => ({ address: w.address, balance: 600_000 - i * 1_000 })),
  { address: mabel.address, balance: 100_000 },
];

/* Wallets the chain has stopped vouching for. Empty until a case sells up. */
const soldOut = new Set();
/* Taking the indexer away, so the Worker has to read holders off the chain.

   The mint is Token-2022 here on purpose: it is the program the real one
   turned out to belong to, and asking the wrong token program is not an
   error — it is an empty list, which reads as "this token has no holders". */
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
let indexerDown = false;
let scanAccounts = [];
let scannedProgram = null;
/* And taking the chain away, which is a different thing from it saying no. */
let rpcDown = false;
/* What `getTokenLargestAccounts` answers: the capped tier the reading falls
   back to when the scan is refused. Null is "nothing to say", which is what
   the other cases want — a scan that did not work should seat nobody rather
   than quietly seat the twenty. A case that is *about* the fallback sets it. */
let largestAccounts = null;

const holders = createServer((req, res) => {
  if ((req.url ?? '').startsWith('/holders')) {
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(indexerDown ? [] : holderList));
    return;
  }

  /* The chain, as far as the Worker is concerned.

     It exists so the holder check is a real check here rather than one
     standing aside for want of an endpoint — which is what let a wallet that
     had sold everything keep reading the roster for a day. `soldOut` is the
     handle a case pulls to make somebody stop holding. */
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    if (rpcDown) {
      res.writeHead(500, { 'content-type': 'application/json' }).end('{}');
      return;
    }
    let call = {};
    try { call = JSON.parse(raw); } catch { /* answered as nothing, below */ }
    const reply = (result) => res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ jsonrpc: '2.0', id: call.id ?? 1, result }));

    switch (call.method) {
      case 'getTokenAccountsByOwner':
        return reply({
          value: soldOut.has(call.params?.[0]) ? [] : [
            { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 1000 } } } } } },
          ],
        });
      case 'getTokenSupply':
        return reply({ value: { amount: '1000000', decimals: 0, uiAmount: 1_000_000 } });
      case 'getAccountInfo':
        return reply({ value: { owner: TOKEN_2022 } });
      case 'getProgramAccounts':
        scannedProgram = call.params?.[0];
        return reply(scanAccounts);
      case 'getTokenLargestAccounts':
        return reply(largestAccounts && { value: largestAccounts });
      case 'getMultipleAccounts':
        /* Everybody here is a person. A null account is a wallet holding no
           SOL, which is exactly what a wallet that has only ever received
           tokens looks like — and what the holder list keeps. */
        return reply({ value: (call.params?.[0] ?? []).map(() => null) });
      default:
        return reply(null);
    }
  });
});
await new Promise((resolve) => holders.listen(8788, '127.0.0.1', resolve));
// The Worker caches seating for a second locally; let any older one lapse.
await new Promise((r) => setTimeout(r, 1200));

await check('GET /health reports the seating it actually has', async () => {
  /* Every field here is read rather than assumed, which is the whole point
     of the route: `sections` used to be `canSeat(env)`, true the moment a
     mint was set, and so it stayed true through exactly the failures an
     operator curls this route to find. */
  const body = await (await fetch(`${BASE}/health`, { headers: { origin: ORIGIN } })).json();
  assert(body.directory === true, 'the Worker does not see a D1 binding — apply the migrations first');
  assert(body.sections === true, 'the Worker cannot tell the cabins apart, so no card will show contact details');
  assert(body.configured === true, 'a holder feed and a mint are both set in wrangler.local.toml');
  assert(body.seated === holderList.length,
    `the feed has ${holderList.length} holders and the cabin seated ${body.seated}`);
  assert(body.cabin === 178, `the aircraft is 178 seats, reported as ${body.cabin}`);
});

await check('GET /holders hands the page the list the cabin is seated from', async () => {
  /* The page reads this instead of scanning the chain itself, which is what
     makes "the page and the Worker agree about who is aboard" the default
     rather than two environment variables somebody has to keep in step. */
  const res = await fetch(`${BASE}/holders`, { headers: { origin: ORIGIN } });
  assert(res.status === 200, `status ${res.status}`);
  const { holders: list, supply } = await res.json();
  assert(Array.isArray(list), 'the holder feed is not a list');
  assert(list.some((h) => h.address === captain.address), 'the flight deck is missing from the feed');
  assert(list.some((h) => h.address === mabel.address), 'the wallet in business is missing from the feed');
  assert(
    list.every((h) => typeof h.address === 'string' && Number.isFinite(h.balance)),
    'the feed is not in the shape the page reads, so the cabin would be empty',
  );
  /* The supply rides along because the page has no RPC of its own to ask for
     one, and a bag is only interesting as a share of something. */
  assert(supply === 1_000_000, `the supply did not come with the list: ${supply}`);
});

await check('GET /holding answers a balance, so no page has to carry an RPC key', async () => {
  const res = await fetch(`${BASE}/holding?address=${alice.address}`, { headers: { origin: ORIGIN } });
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(body.balance === 1000, `balance: ${body.balance}`);
  assert(body.supply === 1_000_000, `supply: ${body.supply}`);
  assert(Math.abs(body.share - 0.001) < 1e-9, `share: ${body.share}`);
});

await check('a chain that cannot be asked is a 503, never a zero balance', async () => {
  /* The failure this shape exists to prevent. A holder told they hold nothing
     is reseated into the hold, announced over the PA, and shut out of every
     card in the cabin — all of it wrong, and none of it visible as an error.
     A fresh wallet each time, so the balance cache cannot answer instead. */
  const fresh = await wallet();
  rpcDown = true;
  const res = await fetch(`${BASE}/holding?address=${fresh.address}`, { headers: { origin: ORIGIN } });
  rpcDown = false;
  assert(res.status === 503, `an unanswerable chain came back as ${res.status}`);
  assert(res.headers.get('cache-control') === 'no-store', 'a failure was made cacheable');
});

await check('and something that is not a wallet is refused outright', async () => {
  const res = await fetch(`${BASE}/holding?address=not-a-wallet`, { headers: { origin: ORIGIN } });
  assert(res.status === 400, `status ${res.status}, expected 400`);
});

await check('a signed sign-in opens a session', async () => {
  const res = await api('/session', { method: 'POST', body: await signInBody(alice) });
  assert(res.status === 200, `status ${res.status}`);
  const body = await res.json();
  assert(typeof body.token === 'string' && body.token.length > 20, 'no token came back');
  assert(body.address === alice.address, 'the session names the wrong wallet');
  assert(body.expires > Date.now(), 'the session is already expired');
  assert(res.headers.get('cache-control') === 'no-store', 'a credential was sent cacheable');
  aliceToken = body.token;
});

await check('the same sign-in cannot be replayed', async () => {
  const issued = new Date().toISOString();
  const body = await signInBody(alice, issued);
  assert((await api('/session', { method: 'POST', body })).status === 200, 'a fresh sign-in was refused');
  const again = await api('/session', { method: 'POST', body });
  assert(again.status === 401, `a replayed signature minted a second token: ${again.status}`);
});

await check('a forged sign-in is refused', async () => {
  const body = await signInBody(alice);
  body.address = bob.address;
  assert((await api('/session', { method: 'POST', body })).status === 401, 'a signature from another wallet was accepted');
});

await check('a stale sign-in is refused', async () => {
  const stale = new Date(Date.now() - 20 * 60_000).toISOString();
  const res = await api('/session', { method: 'POST', body: await signInBody(alice, stale) });
  assert(res.status === 400, `status ${res.status}, expected 400`);
});

await check('the directory is closed without a session', async () => {
  assert((await api('/directory')).status === 401, 'the roster was readable unauthenticated');
  assert((await api('/messages')).status === 401, 'an inbox was readable unauthenticated');
  assert((await api('/directory', { token: 'not-a-real-token' })).status === 401, 'an invented token was accepted');
});

await check('a card is published and read back', async () => {
  const card = {
    displayName: 'Aisle Hopper', role: 'Partnerships',
    email: 'aisle@seat-airlines.space', website: 'https://seat-airlines.space', linkedin: '',
  };
  const put = await api('/profile', { method: 'PUT', token: aliceToken, body: card });
  assert(put.status === 200, `publishing the card failed: ${put.status}`);

  const roster = await (await api('/directory', { token: aliceToken })).json();
  const mine = roster[alice.address];
  assert(mine, 'the published card is not in the directory');
  assert(mine.displayName === 'Aisle Hopper', `the wrong name came back: ${mine.displayName}`);
  assert(mine.email === card.email, 'the email did not survive the round trip');
});

await check('a card survives a new session, which localStorage never did', async () => {
  const fresh = await (await api('/session', { method: 'POST', body: await signInBody(alice) })).json();
  const roster = await (await api('/directory', { token: fresh.token })).json();
  assert(roster[alice.address]?.displayName === 'Aisle Hopper', 'the card did not outlive the session that wrote it');
  aliceToken = fresh.token;
});

await check('a javascript: contact link is refused', async () => {
  const res = await api('/profile', {
    method: 'PUT', token: aliceToken, body: { website: 'javascript:alert(1)' },
  });
  assert(res.status === 400, `status ${res.status}, expected 400`);
});

await check('a card reaches another holder, contact details and all', async () => {
  /* Contact details are a holder's perk, and the gate is the session: it is
     opened only by a wallet that proved its key and holds the token, so a
     non-holder has no token to ask with. This is the other half of
     "the directory is closed without a session" above — what a holder who
     *is* in the room gets to read. */
  bobToken = (await (await api('/session', { method: 'POST', body: await signInBody(bob) })).json()).token;

  const theirs = (await (await api('/directory', { token: bobToken })).json())[alice.address];
  assert(theirs, 'the card is missing from another holder’s roster');
  assert(theirs.displayName === 'Aisle Hopper', `the wrong name came back: ${theirs.displayName}`);
  assert(theirs.email === 'aisle@seat-airlines.space', 'another holder could not read the contact details');
  assert(theirs.website === 'https://seat-airlines.space', 'the website did not reach another holder');
});

await check('an introduction reaches the other wallet', async () => {

  const sent = await api('/messages', {
    method: 'POST', token: aliceToken, body: { to: bob.address, body: 'Row 1 here — shall we talk?' },
  });
  assert(sent.status === 200, `sending failed: ${sent.status}`);

  const theirs = await (await api('/messages', { token: bobToken })).json();
  const received = theirs.inbox.find((m) => m.body === 'Row 1 here — shall we talk?');
  assert(received, 'the introduction never arrived in the recipient inbox');
  assert(received.from === alice.address, 'the message names the wrong sender');
  assert(theirs.sent.length === 0, 'the recipient was credited with sending it');

  const mine = await (await api('/messages', { token: aliceToken })).json();
  assert(mine.sent.some((m) => m.id === received.id), 'the sender cannot see what they sent');
  assert(mine.inbox.length === 0, 'the sender received their own introduction');
});

await check('an empty introduction, and one to yourself, are refused', async () => {
  const empty = await api('/messages', { method: 'POST', token: aliceToken, body: { to: bob.address, body: '   ' } });
  assert(empty.status === 400, `an empty message got ${empty.status}`);
  const self = await api('/messages', { method: 'POST', token: aliceToken, body: { to: alice.address, body: 'hello me' } });
  assert(self.status === 400, `a message to yourself got ${self.status}`);
});

/* ── Reading down the aircraft, and not up ────────────────────────────────
   alice and bob are both in First. The captain is on the flight deck, ahead
   of them; mabel is in business, behind them. */

await check('a card in a cabin ahead is name and role only', async () => {
  const hers = (await (await api('/session', { method: 'POST', body: await signInBody(mabel) })).json()).token;
  const card = (await (await api('/directory', { token: hers })).json())[alice.address];
  assert(card, 'the roster should list everyone, whatever cabin they are in');
  assert(card.displayName === 'Aisle Hopper', 'the name is the roster and belongs to the whole cabin');
  assert(card.readable === false, 'business was told it could read a First Class card');
  assert(card.email === '', `business read an email from the cabin in front: ${card.email}`);
  assert(card.website === '', 'business read a link from the cabin in front');
});

await check('a card from behind is readable in full', async () => {
  await api('/profile', {
    method: 'PUT', token: bobToken,
    body: { displayName: 'Middle Seat Ventures', role: 'Growth', email: 'bob@seat-airlines.space' },
  });
  const captainToken = (await (await api('/session', { method: 'POST', body: await signInBody(captain) })).json()).token;
  const card = (await (await api('/directory', { token: captainToken })).json())[bob.address];
  assert(card.readable === true, 'the flight deck could not read a First Class card');
  assert(card.email === 'bob@seat-airlines.space', 'the contact details did not carry forward');
});

await check('a conversation carries forward to the section ahead', async () => {
  const captainToken = (await (await api('/session', { method: 'POST', body: await signInBody(captain) })).json()).token;
  const heard = await (await api('/messages', { token: captainToken })).json();
  const theirs = heard.overheard.find((m) => m.from === alice.address && m.to === bob.address);
  assert(theirs, 'the flight deck cannot read a First Class conversation it is seated ahead of');
  assert(heard.inbox.length === 0 && heard.sent.length === 0, 'the captain was credited with somebody else’s post');
});

await check('and never aft', async () => {
  const hers = (await (await api('/session', { method: 'POST', body: await signInBody(mabel) })).json()).token;
  const heard = await (await api('/messages', { token: hers })).json();
  assert(Array.isArray(heard.overheard), 'no overheard list came back at all');
  assert(
    !heard.overheard.some((m) => m.from === alice.address || m.to === alice.address),
    'business read a conversation from the cabin in front of it',
  );
});

/* ── Writing, which goes exactly as far as reading ────────────────────────
   A card you can read is a card you can answer, and nothing carries forward.
   The page hides a composer it knows would be refused; until this route
   checked for itself, that was the whole of the rule, and it was one fetch
   away from not existing. These cases are that fetch. */

await check('a cabin behind cannot introduce itself forward', async () => {
  const hers = (await (await api('/session', { method: 'POST', body: await signInBody(mabel) })).json()).token;
  const res = await api('/messages', {
    method: 'POST', token: hers, body: { to: alice.address, body: 'Business here, coming through.' },
  });
  assert(res.status === 403, `business posted into a First Class inbox: ${res.status}`);

  const theirs = await (await api('/messages', { token: aliceToken })).json();
  assert(
    !theirs.inbox.some((m) => m.body === 'Business here, coming through.'),
    'the refusal was reported and the row written anyway',
  );
});

await check('but First Class can write aft, because it can read aft', async () => {
  /* alice reads every word of mabel's card, so she can answer it. This used
     to be refused, back when the rule was First Class to First Class and
     nothing else — which also left the whole aircraft behind First with a
     directory it could read and never use. */
  const res = await api('/messages', {
    method: 'POST', token: aliceToken, body: { to: mabel.address, body: 'Row 1, writing to row 11.' },
  });
  assert(res.status === 200, `First Class could not post into business: ${res.status}`);

  const hers = (await (await api('/session', { method: 'POST', body: await signInBody(mabel) })).json()).token;
  const theirs = await (await api('/messages', { token: hers })).json();
  assert(
    theirs.inbox.some((m) => m.body === 'Row 1, writing to row 11.'),
    'it was accepted and never arrived',
  );
});

await check('and the flight deck can reach anybody, which is the point of it', async () => {
  /* The case that made the old rule wrong rather than merely narrow: the two
     largest holders on the aircraft could not write to a single person, nor
     be written to. Being at the front should not be the one seat with no
     directory. */
  const captainToken = (await (await api('/session', { method: 'POST', body: await signInBody(captain) })).json()).token;
  const res = await api('/messages', {
    method: 'POST', token: captainToken, body: { to: alice.address, body: 'From the deck.' },
  });
  assert(res.status === 200, `the flight deck could not post into First Class: ${res.status}`);
});

await check('and nobody at all can write to the flight deck', async () => {
  /* The other half, and the reason the quiet at the front survives widening
     the rule. Nothing carries forward, so the deck's inbox reaches only the
     deck — the further forward you sit, the fewer people can reach you. */
  const res = await api('/messages', {
    method: 'POST', token: aliceToken, body: { to: captain.address, body: 'Row 1 to the cockpit.' },
  });
  assert(res.status === 403, `First Class posted into the flight deck: ${res.status}`);
});

/* ── The rooms ────────────────────────────────────────────────────────────
   A cabin is somewhere to talk as well as somewhere to sit. Reading one is
   the same line as reading a card — your own and every one behind it — and
   posting is narrower than both: your own section only, because a cabin's
   conversation belongs to the people sitting in it. */

const room = (zone) => `section:${zone}`;

await check('a holder speaks in their own cabin', async () => {
  const res = await api('/messages', {
    method: 'POST', token: aliceToken, body: { to: room('first'), body: 'First Class, anyone awake?' },
  });
  assert(res.status === 200, `First Class could not speak in its own room: ${res.status}`);

  const heard = await (await api('/messages', { token: aliceToken })).json();
  assert(
    (heard.channels?.first ?? []).some((m) => m.body === 'First Class, anyone awake?'),
    'it was accepted and never appeared in the room',
  );
});

await check('and cannot speak in the cabin behind, though they can hear it', async () => {
  /* The one place reading and posting come apart. alice reads every word said
     in business and can write to anybody in it personally — but she cannot
     walk into their conversation and talk. */
  const res = await api('/messages', {
    method: 'POST', token: aliceToken, body: { to: room('business'), body: 'First Class, visiting.' },
  });
  assert(res.status === 403, `First Class talked in the room behind it: ${res.status}`);
});

await check('nor in the one ahead of them', async () => {
  const hers = (await (await api('/session', { method: 'POST', body: await signInBody(mabel) })).json()).token;
  const res = await api('/messages', {
    method: 'POST', token: hers, body: { to: room('first'), body: 'Business, coming forward.' },
  });
  assert(res.status === 403, `business talked in the room in front of it: ${res.status}`);
});

await check('a sign-in fetches only the room you are sitting in', async () => {
  /* The hub opens on your own cabin, so fetching every room you *may* hear on
     every sign-in was up to five rooms read to paint one. What a seat is
     allowed to hear has not changed; when it is fetched has. */
  const captainToken = (await (await api('/session', { method: 'POST', body: await signInBody(captain) })).json()).token;
  const deck = await (await api('/messages', { token: captainToken })).json();
  const rooms = Object.keys(deck.channels ?? {}).sort();
  assert(rooms.join(',') === 'deck', `a sign-in fetched: ${rooms.join(',') || 'nothing'}`);
});

await check('and the cabins behind it only when asked for', async () => {
  const captainToken = (await (await api('/session', { method: 'POST', body: await signInBody(captain) })).json()).token;
  const deck = await (await api('/messages?rooms=all', { token: captainToken })).json();
  const rooms = Object.keys(deck.channels ?? {}).sort();
  assert(rooms.join(',') === 'business,deck,first', `the flight deck heard: ${rooms.join(',') || 'nothing'}`);
  assert(
    (deck.channels.first ?? []).some((m) => m.body === 'First Class, anyone awake?'),
    'the flight deck could not hear First Class talking',
  );
});

await check('asking for all of them is still only the ones behind you', async () => {
  /* `?rooms=all` is a request for what this seat may hear, not a way around
     it. Business asking for everything gets its own room and nothing else. */
  const hers = (await (await api('/session', { method: 'POST', body: await signInBody(mabel) })).json()).token;
  const business = await (await api('/messages?rooms=all', { token: hers })).json();
  assert(
    Object.keys(business.channels ?? {}).join(',') === 'business',
    `business heard more than its own room: ${Object.keys(business.channels ?? {}).join(',')}`,
  );
});

await check('the PA belongs to the flight deck, and is one a day', async () => {
  /* A promise printed on the boarding pass before any of this was built:
     "You have the PA. One announcement a day. Use it well." */
  const refused = await api('/messages', {
    method: 'POST', token: aliceToken, body: { to: 'announcement', body: 'First Class, on the PA.' },
  });
  assert(refused.status === 403, `First Class took the PA: ${refused.status}`);

  const captainToken = (await (await api('/session', { method: 'POST', body: await signInBody(captain) })).json()).token;
  const said = await api('/messages', {
    method: 'POST', token: captainToken, body: { to: 'announcement', body: 'Cabin crew, doors to arrival.' },
  });
  assert(said.status === 200, `the flight deck could not use the PA: ${said.status}`);

  const again = await api('/messages', {
    method: 'POST', token: captainToken, body: { to: 'announcement', body: 'And another thing.' },
  });
  assert(again.status === 429, `the PA was used twice in a day: ${again.status}`);
});

await check('and the whole aircraft hears it, the hold included', async () => {
  const hers = (await (await api('/session', { method: 'POST', body: await signInBody(mabel) })).json()).token;
  const business = await (await api('/messages', { token: hers })).json();
  assert(
    (business.announcements ?? []).some((m) => m.body === 'Cabin crew, doors to arrival.'),
    'business could not hear the PA',
  );

  const stranger = await wallet();
  const theirs = (await (await api('/session', { method: 'POST', body: await signInBody(stranger) })).json()).token;
  const hold = await (await api('/messages', { token: theirs })).json();
  assert(
    (hold.announcements ?? []).some((m) => m.body === 'Cabin crew, doors to arrival.'),
    'the hold could not hear the PA, and being aboard is the only qualification for hearing it',
  );
  assert(
    Object.keys(hold.channels ?? {}).length === 0,
    'an unseated wallet was given a cabin to listen to',
  );
});

await check('a room post is not an outgoing letter', async () => {
  /* `sent` is the outbox of introductions. A line said in your own section
     comes back in `channels`, with everybody else's, and counting it twice
     would make the hub claim you had written to somebody. */
  const mine = await (await api('/messages', { token: aliceToken })).json();
  assert(
    !mine.sent.some((m) => m.to.startsWith('section:') || m.to === 'announcement'),
    'a room post was filed as an introduction',
  );
});

await check('a conversation with the hold is started by nobody, and fetched by nobody', async () => {
  /* `owner` is the wallet from the banner cases: it holds no seat, so it is
     on no manifest and no roster, and the page could not name it if it tried.
     A conversation it is part of is not the cabin's business, and — the
     reason this is a rule rather than a filter — not something the Worker
     should be reading out of the database to then decline to show.

     Both halves are asserted because the send being refused would otherwise
     make the read assertion pass for the wrong reason. The read side still
     has work to do: rows written before this rule existed are in the table,
     and what keeps them out of somebody's `overheard` is the query naming
     the seats rather than the sender having been turned away. */
  const stranger = await wallet();
  const strangerToken =
    (await (await api('/session', { method: 'POST', body: await signInBody(stranger) })).json()).token;
  const refused = await api('/messages', {
    method: 'POST', token: strangerToken,
    body: { to: owner, body: 'Two wallets in the hold, talking.' },
  });
  assert(refused.status === 403, `a wallet with no seat posted an introduction: ${refused.status}`);

  const captainToken = (await (await api('/session', { method: 'POST', body: await signInBody(captain) })).json()).token;
  const heard = await (await api('/messages', { token: captainToken })).json();
  assert(
    !heard.overheard.some((m) => m.body === 'Two wallets in the hold, talking.'),
    'the flight deck was served a conversation between two wallets with no seats',
  );
});

await check('the two wallets on a message always read it', async () => {
  const mine = await (await api('/messages', { token: aliceToken })).json();
  assert(mine.sent.some((m) => m.to === bob.address), 'the sender lost their own message');
  const theirs = await (await api('/messages', { token: bobToken })).json();
  assert(theirs.inbox.some((m) => m.from === alice.address), 'the recipient lost their own message');
  assert(
    !theirs.overheard.some((m) => m.from === alice.address),
    'a peer’s message was served as something overheard rather than as the inbox',
  );
});

/* ── The door, and how long it stays open ─────────────────────────────────
   A session is proof of two things — that somebody holds their key, and that
   they hold the token — and only the first of those stays true by itself. */

await check('the door turns away a wallet that holds nothing', async () => {
  const empty = await wallet();
  soldOut.add(empty.address);
  const res = await api('/session', { method: 'POST', body: await signInBody(empty) });
  assert(res.status === 403, `a wallet with no bag was let into the directory: ${res.status}`);
});

await check('a wallet that sells its bag loses the session it opened', async () => {
  /* The session lasts a day. A bag can be gone in a minute. Most of what
     selling up costs somebody the seating handles on its own — off the
     manifest, and contact details close behind you — but the roster itself
     was only ever gated at sign-in, and the roster is most of what the room
     is for. */
  const seller = await wallet();
  const token = (await (await api('/session', { method: 'POST', body: await signInBody(seller) })).json()).token;
  assert((await api('/directory', { token })).status === 200, 'the session never opened');

  soldOut.add(seller.address);
  // Past OWNER_CACHE_MS, which wrangler.local.toml shortens for this.
  await new Promise((r) => setTimeout(r, 400));

  const after = await api('/directory', { token });
  assert(after.status === 401, `a wallet that sold everything kept the roster: ${after.status}`);
  assert((await api('/messages', { token })).status === 401, 'the session row outlived the holding');

  const again = await api('/session', { method: 'POST', body: await signInBody(seller) });
  assert(again.status === 403, `and it could sign straight back in: ${again.status}`);
});

await check('being out-held is not selling: an unseated holder keeps everything', async () => {
  /* The rule this must not overreach into. `owner` is the banner wallet: it
     holds the token and has no seat, which is the hold — part of this
     aeroplane, and its card is still its own to edit. */
  const outheld = await wallet();
  const token = (await (await api('/session', { method: 'POST', body: await signInBody(outheld) })).json()).token;
  await new Promise((r) => setTimeout(r, 400));
  const res = await api('/profile', { method: 'PUT', token, body: { displayName: 'Standby' } });
  assert(res.status === 200, `a holder with no seat was thrown out of the directory: ${res.status}`);
  const roster = await (await api('/directory', { token })).json();
  assert(roster[outheld.address]?.displayName === 'Standby', 'the hold lost its own card');
});

await check('signing out revokes the token', async () => {
  assert((await api('/session', { method: 'DELETE', token: bobToken })).status === 200, 'signing out failed');
  assert((await api('/messages', { token: bobToken })).status === 401, 'the token still worked after signing out');
});

await check('with no indexer, the cabin is seated off the chain', async () => {
  /* The tier that makes "seat the cabin from the mint" true rather than
     nearly true, exercised in the runtime that has to run it rather than in
     Node. Reading a token account means base64 in, a little-endian u64 out,
     and 32 bytes of owner encoded back to base58 — and the address that comes
     out has to be spelled exactly as the wallet signs it, or a holder will
     not match their own seat. These are real keypairs, so that is checkable.

     `getTokenLargestAccounts` is deliberately left with nothing to say: if
     the scan did not work, this seats nobody rather than quietly seating the
     twenty. */
  const first = await wallet();
  const second = await wallet();
  scanAccounts = [
    tokenAccount(first.bytes, 900_000),
    tokenAccount(second.bytes, 100_000),
    // One wallet, two bags: a manifest names people, not token accounts.
    tokenAccount(second.bytes, 50_000),
  ];
  indexerDown = true;
  // Past LADDER_CACHE_MS, so the seating is read again rather than reused.
  await new Promise((r) => setTimeout(r, 1300));

  const { holders: list } = await (await fetch(`${BASE}/holders`, { headers: { origin: ORIGIN } })).json();
  assert(scannedProgram === TOKEN_2022,
    `the mint is Token-2022 and the Worker scanned ${scannedProgram} — which owns none of its accounts`);
  assert(Array.isArray(list) && list.length === 2, `expected 2 holders off the chain, got ${JSON.stringify(list)}`);
  const top = list.find((h) => h.address === first.address);
  assert(top, `the owner bytes did not decode to the address the key signs with: ${list.map((h) => h.address)}`);
  assert(top.balance === 900_000, `the balance did not survive the u64: ${top.balance}`);
  const doubled = list.find((h) => h.address === second.address);
  assert(doubled?.balance === 150_000, `two token accounts did not add up: ${doubled?.balance}`);

  indexerDown = false;
  scanAccounts = [];
});

await check('an aircraft that fills to a fraction of itself says so', async () => {
  /* The failure the `seated`/`cabin` pair exists for, and the one a
     deployment actually lands in. With no indexer and an endpoint that
     refuses `getProgramAccounts` — which is what Solana's public endpoint
     does, and an unset `RPC_URL` is how a deployment ends up on it — the
     reading falls back to `getTokenLargestAccounts` and seats at most twenty
     of a hundred and seventy-eight.

     Nothing about that is visible from the directory. It works, correctly,
     for the handful of people it can place, and does not exist for anybody
     else. `sections` is true and should be: the cabins genuinely can be told
     apart. The number is the only tell, which is why it is reported. */
  const first = await wallet();
  const second = await wallet();
  indexerDown = true;
  scanAccounts = [];
  largestAccounts = [
    { address: first.address, uiAmount: 900_000, amount: '900000', decimals: 0 },
    { address: second.address, uiAmount: 100_000, amount: '100000', decimals: 0 },
  ];
  // Past LADDER_CACHE_MS, so the seating is read again rather than reused.
  await new Promise((r) => setTimeout(r, 1300));

  const body = await (await fetch(`${BASE}/health`, { headers: { origin: ORIGIN } })).json();
  assert(body.sections === true, 'the cabins can still be told apart, so this is not a sections failure');
  assert(body.configured === true, 'the mint and the feed are both still configured');
  assert(body.seated === 2, `the capped fallback seats 2, and /health reported ${body.seated}`);
  assert(body.cabin === 178, `the aircraft is still 178 seats, reported as ${body.cabin}`);
  assert(body.seated < body.cabin, 'a partly full aircraft must not read as a full one');

  indexerDown = false;
  largestAccounts = null;
  await new Promise((r) => setTimeout(r, 1300));
});

await check('the preflight allows the headers the directory needs', async () => {
  const res = await fetch(`${BASE}/profile`, {
    method: 'OPTIONS',
    headers: { origin: ORIGIN, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization' },
  });
  assert(res.status === 204, `status ${res.status}`);
  assert(/PUT/.test(res.headers.get('access-control-allow-methods') ?? ''), 'PUT is not allowed');
  assert(/authorization/i.test(res.headers.get('access-control-allow-headers') ?? ''), 'authorization is not allowed');
});

/* ── The logbook ──────────────────────────────────────────────────────────
   One wallet's private notes, and the only route here that is not about
   cabins at all.

   The operator is a fixed keypair rather than a generated one, because
   `wrangler.local.toml` has to name the address before the suite runs. Its
   private half sits in this file in plain sight, which is fine precisely
   because it has never held anything: it exists to prove one wallet gets in
   and no other can tell the route is there.

   And it is put on the sold-out list first, deliberately. Every case below
   therefore runs against a wallet the chain says holds nothing — which is the
   strongest version of what the exemption is for. The logbook belongs to a
   wallet, not to a bag. */
const ADMIN_PKCS8 = 'MC4CAQAwBQYDK2VwBCIEIGF+P8WPuT2hS0p/PgSJoKxiCKOSisbGYAlpDAHg8wxw';
const adminKey = await crypto.subtle.importKey(
  'pkcs8', Buffer.from(ADMIN_PKCS8, 'base64'), { name: 'Ed25519' }, false, ['sign'],
);
const admin = {
  address: 'Ame7HoqEdhPsyuhtKR98J5onwUcQm96bNCViGfHprh8D',
  sign: async (msg) => toBase58(new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, adminKey, new TextEncoder().encode(msg)),
  )),
};
soldOut.add(admin.address);

let adminToken = '';
let noted = '';

await check('the operator signs in holding nothing at all', async () => {
  /* The door is for holders, and this wallet is not one. It gets in anyway,
     and that is the point: an operator locked out of their own notes by a
     balance would be a failure with no error in it and nothing on the page
     to read it off. */
  const res = await api('/session', { method: 'POST', body: await signInBody(admin) });
  const body = await res.json();
  assert(res.status === 200, `status ${res.status}: ${JSON.stringify(body)}`);
  adminToken = body.token;
  assert(adminToken, 'no token came back');
});

await check('a holder who is not the operator cannot tell the route exists', async () => {
  /* The whole design of the gate, in one assertion. Not "403 forbidden",
     which would confirm there is something there worth guarding — the same
     404 a misspelt path gets, byte for byte, so that guessing the URL and
     guessing it wrong come back identical. */
  const mine = await api('/logbook', { token: aliceToken });
  const typo = await api('/lgobook', { token: aliceToken });
  assert(mine.status === 404, `a stranger got ${mine.status} rather than a 404`);
  assert(mine.status === typo.status, 'the real route and a typo answered with different statuses');
  assert(await mine.text() === await typo.text(), 'the real route and a typo answered differently');
});

await check('nor can somebody with no session, or a made-up one', async () => {
  const typo = await api('/lgobook');
  for (const [what, res] of [
    ['no token', await api('/logbook')],
    ['a made-up token', await api('/logbook', { token: 'not-a-real-token' })],
  ]) {
    assert(res.status === 404, `${what} got ${res.status} rather than a 404`);
    assert(await res.clone().text() === await typo.clone().text(), `${what} got a different answer from a typo`);
  }
});

await check('and cannot write to it, amend it, or strike anything out', async () => {
  /* A read that 404s and a write that 400s would give the game away just as
     surely — the refusal has to come before anything looks at the request. */
  const writes = [
    await api('/logbook', { method: 'POST', token: aliceToken, body: { body: 'let me in' } }),
    await api('/logbook', { method: 'PATCH', token: aliceToken, body: { id: 'x', status: 'acted' } }),
    await api('/logbook?id=x', { method: 'DELETE', token: aliceToken }),
  ];
  for (const res of writes) {
    assert(res.status === 404, `a stranger's write got ${res.status} rather than a 404`);
    assert((await res.json()).error === 'No such route.', 'a stranger was told more than a typo would be');
  }
});

await check('the operator writes one down and reads it back', async () => {
  const res = await api('/logbook', {
    method: 'POST',
    token: adminToken,
    body: {
      body: '  Mabel says they are listing on a CEX next week.  ',
      source: mabel.address,
      tags: ' Listing , #listing,  CEX ',
      conviction: 9,
    },
  });
  const entry = await res.json();
  assert(res.status === 200, `status ${res.status}: ${JSON.stringify(entry)}`);
  noted = entry.id;
  assert(entry.body === 'Mabel says they are listing on a CEX next week.', `body: ${entry.body}`);
  assert(entry.source === mabel.address, 'the source did not survive');
  /* Normalised on the way in rather than on the way out: three spellings of
     two tags, and a rating past the top of the ladder. */
  assert(entry.tags.join(',') === 'listing,cex', `tags: ${entry.tags}`);
  assert(entry.conviction === 3, `conviction: ${entry.conviction}`);
  assert(entry.status === 'open', `status: ${entry.status}`);

  const back = await (await api('/logbook', { token: adminToken })).json();
  assert(back.entries.some((e) => e.id === noted), 'the note was not in the logbook afterwards');
});

await check('a note needs a note in it', async () => {
  const res = await api('/logbook', { method: 'POST', token: adminToken, body: { body: '   ' } });
  assert(res.status === 400, `an empty note came back ${res.status}`);
});

await check('marking one acted on changes that and nothing else', async () => {
  const res = await api('/logbook', { method: 'PATCH', token: adminToken, body: { id: noted, status: 'acted' } });
  const entry = await res.json();
  assert(res.status === 200, `status ${res.status}: ${JSON.stringify(entry)}`);
  assert(entry.status === 'acted', `status: ${entry.status}`);
  assert(entry.body === 'Mabel says they are listing on a CEX next week.', 'the note itself was rewritten');
  assert(entry.tags.join(',') === 'listing,cex', 'the tags were lost');
  assert(entry.updatedAt >= entry.createdAt, 'the amendment left no trace of when');
});

await check('a state nobody recognises is refused rather than read as open', async () => {
  /* Reopening a line somebody closed, on a typo, is the kind of wrong that
     looks right. */
  const res = await api('/logbook', { method: 'PATCH', token: adminToken, body: { id: noted, status: 'warm' } });
  assert(res.status === 400, `an unknown state came back ${res.status}`);
  const still = await (await api('/logbook', { token: adminToken })).json();
  assert(still.entries.find((e) => e.id === noted).status === 'acted', 'the refused amendment took effect anyway');
});

await check('an amendment to a note that is not there is a 404 about the note', async () => {
  /* The one 404 here that is allowed to be informative: whoever is asking has
     already proved they are the operator, so there is nothing left to hide. */
  const res = await api('/logbook', { method: 'PATCH', token: adminToken, body: { id: 'nothing', status: 'cold' } });
  assert(res.status === 404, `status ${res.status}`);
  assert((await res.json()).error === 'No such entry.', 'the operator was told the route did not exist');
});

await check('the logbook still opens for a wallet holding nothing', async () => {
  /* Belt and braces on the exemption: the session survived the sign-in, and
     it has to survive the re-check on every request after it too. */
  const res = await api('/logbook', { token: adminToken });
  assert(res.status === 200, `the operator was shut out with ${res.status}`);
});

await check('a note can be struck out, and only once', async () => {
  const gone = await api(`/logbook?id=${noted}`, { method: 'DELETE', token: adminToken });
  assert(gone.status === 200, `status ${gone.status}`);
  const again = await api(`/logbook?id=${noted}`, { method: 'DELETE', token: adminToken });
  assert(again.status === 404, `striking out a struck-out note came back ${again.status}`);
  const back = await (await api('/logbook', { token: adminToken })).json();
  assert(!back.entries.some((e) => e.id === noted), 'the note was still there afterwards');
});

await check('the preflight allows the amendment the logbook is edited with', async () => {
  const res = await fetch(`${BASE}/logbook`, {
    method: 'OPTIONS',
    headers: { origin: ORIGIN, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization' },
  });
  assert(res.status === 204, `status ${res.status}`);
  assert(/PATCH/.test(res.headers.get('access-control-allow-methods') ?? ''), 'PATCH is not allowed');
});

/* ── The flight controls ──────────────────────────────────────────────────
   Read by everybody, written by one wallet. The opposite of the logbook on
   purpose: an aeroplane that only its operator can see rolled is a
   screensaver, so `GET` is public and says so. */

await check('what the aeroplane is doing is public, and it starts hands off', async () => {
  const res = await fetch(`${BASE}/flight`, { headers: { origin: ORIGIN } });
  assert(res.status === 200, `status ${res.status}`);
  const flight = await res.json();
  assert(flight.halfRolls === 0 && flight.spin === 0, `not level: ${JSON.stringify(flight)}`);
  assert(flight.flaps === null && flight.hour === null && flight.weather === null,
    `something was overridden from nothing: ${JSON.stringify(flight)}`);
  assert(/max-age/.test(res.headers.get('cache-control') ?? ''), 'every visitor polls this; it must be cacheable');
});

await check('a holder cannot fly the aeroplane', async () => {
  /* A 403 rather than the logbook's 404, and deliberately so: this route is
     not hidden. Everybody watching the aeroplane roll knows somebody did it. */
  const res = await api('/flight', { method: 'PUT', token: aliceToken, body: { halfRolls: 1 } });
  assert(res.status === 403, `a passenger got ${res.status}`);
  const still = await (await fetch(`${BASE}/flight`, { headers: { origin: ORIGIN } })).json();
  assert(still.halfRolls === 0, 'the refused roll happened anyway');
});

await check('and neither can somebody with no session at all', async () => {
  const res = await api('/flight', { method: 'PUT', body: { halfRolls: 1 } });
  assert(res.status === 403, `an anonymous request got ${res.status}`);
});

await check('the flight deck rolls it, and everybody reads the same answer', async () => {
  const put = await api('/flight', {
    method: 'PUT', token: adminToken,
    body: { halfRolls: 1, spin: 6, flaps: 0.5, hour: 21, weather: 'storm' },
  });
  const flown = await put.json();
  assert(put.status === 200, `status ${put.status}: ${JSON.stringify(flown)}`);
  assert(flown.halfRolls === 1, `halfRolls: ${flown.halfRolls}`);

  /* Read back with no credentials whatsoever, because that is who this is
     for: the visitor who has never heard of the logbook and is looking at an
     upside-down aeroplane. The warm snapshot is five seconds, so wait it
     out rather than reading back the isolate's own memory. */
  await new Promise((r) => setTimeout(r, 5200));
  const seen = await (await fetch(`${BASE}/flight`, { headers: { origin: ORIGIN } })).json();
  assert(seen.halfRolls === 1 && seen.spin === 6, `a stranger saw ${JSON.stringify(seen)}`);
  assert(seen.weather === 'storm' && seen.hour === 21, `a stranger saw ${JSON.stringify(seen)}`);
});

await check('nothing gets past the clamp on the way in', async () => {
  /* The failure this exists to prevent: a stored NaN is a rotation of NaN on
     every open page at once — an aeroplane that disappears and a canvas that
     never comes back. */
  const put = await api('/flight', {
    method: 'PUT', token: adminToken,
    body: { halfRolls: 'banana', spin: 9e9, flaps: 40, hour: -5, weather: 'apocalypse' },
  });
  const flown = await put.json();
  assert(put.status === 200, `status ${put.status}`);
  assert(flown.halfRolls === 0, `halfRolls: ${flown.halfRolls}`);
  assert(flown.spin === 45, `spin: ${flown.spin}`);
  assert(flown.flaps === 1, `flaps: ${flown.flaps}`);
  assert(flown.hour === 0, `hour: ${flown.hour}`);
  assert(flown.weather === null, `weather: ${flown.weather}`);
});

await check('giving it back to the market leaves nothing behind', async () => {
  const put = await api('/flight', {
    method: 'PUT', token: adminToken,
    body: { halfRolls: 0, spin: 0, flaps: null, hour: null, weather: null },
  });
  assert(put.status === 200, `status ${put.status}`);
  await new Promise((r) => setTimeout(r, 5200));
  const seen = await (await fetch(`${BASE}/flight`, { headers: { origin: ORIGIN } })).json();
  assert(seen.halfRolls === 0 && seen.spin === 0 && seen.weather === null,
    `the aeroplane kept flying itself: ${JSON.stringify(seen)}`);
});

await check('a body that is not a set of controls is refused', async () => {
  const notJson = await fetch(`${BASE}/flight`, {
    method: 'PUT',
    headers: { origin: ORIGIN, 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: 'not json at all',
  });
  assert(notJson.status === 400, `status ${notJson.status}`);
  const notObject = await api('/flight', { method: 'PUT', token: adminToken, body: 'a string' });
  assert(notObject.status === 400, `status ${notObject.status}`);
});

await check('the flight controls cannot be deleted, only levelled', async () => {
  const res = await api('/flight', { method: 'DELETE', token: adminToken });
  assert(res.status === 405, `status ${res.status}`);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
holders.close();
process.exit(fail ? 1 : 0);
