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
  assert(typeof body.image === 'string' && body.image.includes(owner), 'no image url back');
});

await check('the stored advert appears on the wall', async () => {
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  assert(wall[owner], 'owner not on the wall');
  assert(wall[owner].alt === 'A test advert', 'alt did not round-trip');
});

await check('the artwork serves back as a real image', async () => {
  // The gap the other cases left: they proved the record round-trips, not the
  // bytes. Without R2 the Worker serves these itself, so this is the path an
  // <img> actually takes.
  const wall = await (await fetch(`${BASE}/banners`, { headers: { origin: ORIGIN } })).json();
  const res = await fetch(wall[owner].image);
  assert(res.status === 200, `status ${res.status}`);
  assert(res.headers.get('content-type') === 'image/jpeg', `type ${res.headers.get('content-type')}`);
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
  const back = new Uint8Array(await res.arrayBuffer());
  assert(back.length === JPEG.length, `got ${back.length} bytes, sent ${JPEG.length}`);
  assert(back[0] === 0xff && back[1] === 0xd8 && back[2] === 0xff, 'not JPEG bytes');
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
