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
  const address = toBase58(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)));
  const signWith = async (msg) =>
    toBase58(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(msg))));
  return { address, sign: signWith };
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

const holders = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(holderList));
});
await new Promise((resolve) => holders.listen(8788, '127.0.0.1', resolve));
// The Worker caches seating for a second locally; let any older one lapse.
await new Promise((r) => setTimeout(r, 1200));

await check('GET /health reports the directory is bound', async () => {
  const body = await (await fetch(`${BASE}/health`, { headers: { origin: ORIGIN } })).json();
  assert(body.directory === true, 'the Worker does not see a D1 binding — apply the migrations first');
  assert(body.sections === true, 'the Worker has no holder feed, so it cannot tell the cabins apart');
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

await check('a conversation with the hold is fetched by nobody', async () => {
  /* `owner` is the wallet from the banner cases: it holds no seat, so it is
     on no manifest and no roster, and the page could not name it if it tried.
     A conversation it is part of is not the cabin's business, and — the
     reason this is a rule rather than a filter — not something the Worker
     should be reading out of the database to then decline to show. */
  const stranger = await wallet();
  const strangerToken =
    (await (await api('/session', { method: 'POST', body: await signInBody(stranger) })).json()).token;
  await api('/messages', {
    method: 'POST', token: strangerToken,
    body: { to: owner, body: 'Two wallets in the hold, talking.' },
  });

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

await check('signing out revokes the token', async () => {
  assert((await api('/session', { method: 'DELETE', token: bobToken })).status === 200, 'signing out failed');
  assert((await api('/messages', { token: bobToken })).status === 401, 'the token still worked after signing out');
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

console.log(`\n${pass} passed, ${fail} failed\n`);
holders.close();
process.exit(fail ? 1 : 0);
