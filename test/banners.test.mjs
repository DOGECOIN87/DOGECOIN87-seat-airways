/**
 * The advert encoder, in isolation.
 *
 * This exists because of a bug that reached production: the dialog opens
 * holding whatever is already on the seat, the house adverts are
 * percent-encoded SVG data URLs, and the publish path assumed base64. The
 * result was `atob` throwing "The string to be decoded is not correctly
 * encoded" into the page, in the browser's words rather than anyone's.
 *
 * So the cases below pair the two halves that were never tested together:
 * what `houseAdverts` actually produces, fed to the function that consumes it.
 *
 *   npm run test
 */
import {
  advertKey, challenge, dataUrlBytes, houseAdverts, publishBanner, takedownChallenge, unpublishBanner, ServerUnreachable,
} from '../dist-test/banners.js';
import { challenge as workerChallenge, takedownChallenge as workerTakedown } from '../dist-test/workerVerify.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const checkAsync = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const throws = (fn, re, msg) => {
  try { fn(); } catch (e) {
    assert(re.test(e.message), `${msg}: wrong message "${e.message}"`);
    assert(!/atob|DOMException/i.test(e.message), `${msg}: leaked a browser message "${e.message}"`);
    return;
  }
  throw new Error(`${msg}: did not throw`);
};

console.log('\nadvert encoding');

check('decodes a base64 data URL to the exact bytes', () => {
  const bytes = dataUrlBytes('data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'));
  assert(bytes.length === 4, `got ${bytes.length} bytes`);
  assert(bytes[0] === 0xff && bytes[1] === 0xd8, 'not the bytes that went in');
});

check('decodes a percent-encoded data URL, which used to throw', () => {
  const bytes = dataUrlBytes('data:image/svg+xml,' + encodeURIComponent('<svg><rect/></svg>'));
  assert(new TextDecoder().decode(bytes) === '<svg><rect/></svg>', 'did not round-trip');
});

check('every house advert decodes rather than throwing', () => {
  const ads = houseAdverts(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B']);
  const seats = Object.keys(ads);
  assert(seats.length === 8, `got ${seats.length} adverts`);
  for (const seat of seats) {
    const bytes = dataUrlBytes(ads[seat].image);
    assert(bytes.length > 0, `seat ${seat} decoded to nothing`);
    assert(new TextDecoder().decode(bytes).startsWith('<svg'), `seat ${seat} is not SVG`);
  }
});

check('the logo is drawn into the two house adverts that carry it, and they still decode', () => {
  const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500"><circle id="logo-probe" cx="250" cy="250" r="200"/></svg>';
  const ads = houseAdverts(['1A', '1B', '2A', '2B', '3A', '3B', '4A', '4B'], logo);
  const carrying = Object.values(ads).filter((ad) => new TextDecoder().decode(dataUrlBytes(ad.image)).includes('logo-probe'));
  assert(carrying.length === 2, `the logo is in ${carrying.length} adverts, expected 2`);
});

check('seats that share a layout share one image, so it is encoded once', () => {
  const ads = houseAdverts(['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A']);
  assert(ads['1A'].image === ads['9A'].image, 'the ninth seat re-encoded the first layout');
});

check('house adverts are marked as house, so the dialog can tell', () => {
  const ads = houseAdverts(['1A']);
  assert(ads['1A'].house === true, 'house flag missing — the dialog would seed itself from it');
});

check('a malformed base64 payload says something a person can act on', () => {
  throws(() => dataUrlBytes('data:image/jpeg;base64,%%%not base64%%%'), /could not be read/i, 'malformed base64');
});

check('a string that is not a data URL at all is refused', () => {
  throws(() => dataUrlBytes('https://example.com/cat.png'), /cannot publish|choose a file/i, 'plain url');
});

/* ────────────────────────────────────────────────────────────────────────
   Publishing, when the server is not there
   ────────────────────────────────────────────────────────────────────────
   The difference these two cases pin down is the whole reason the failure
   has a type. A server that answers and says no has judged the advert, and
   the holder has to hear its reason. A server that never answers has judged
   nothing, and an advert thrown away over that is an upload and a wallet
   signature spent on nothing. Only the second may fall back to a local save,
   and mixing them up in either direction is a bug worth a test. */

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
const publish = () =>
  publishBanner({ owner: 'WalletOne', image: JPEG, alt: 'An advert', sign: async () => 'sig' });

const rejects = async (fn, test, msg) => {
  try { await fn(); } catch (e) { test(e); return; }
  throw new Error(`${msg}: did not throw`);
};

console.log('\npublishing');

await checkAsync('an unreachable server is told apart from a refusal', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await rejects(publish, (e) => {
    assert(e instanceof ServerUnreachable, `got ${e.name}: ${e.message}`);
    assert(!/failed to fetch/i.test(e.message), `leaked the browser's words: "${e.message}"`);
  }, 'unreachable server');
});

await checkAsync('a refusal keeps the server’s reason, and is not an outage', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'Adverts must be JPEG or PNG.' }), { status: 415 });
  await rejects(publish, (e) => {
    assert(!(e instanceof ServerUnreachable), 'a 415 was mistaken for an outage — it would be saved locally');
    assert(/JPEG or PNG/.test(e.message), `lost the server's reason: "${e.message}"`);
  }, 'refused advert');
});

await checkAsync('a refusal with no readable body still names the status', async () => {
  globalThis.fetch = async () => new Response('<html>502</html>', { status: 502 });
  await rejects(publish, (e) => {
    assert(!(e instanceof ServerUnreachable), 'an answered request is not an outage');
    assert(/502/.test(e.message), `did not name the status: "${e.message}"`);
  }, 'gateway error');
});

/* Taking an advert down.

   The page and the Worker each write out the text the wallet signs, and if
   the two differ by a character every takedown fails with "that signature
   does not match the wallet" — a message that points at the wallet rather
   than at the typo. So the two are compared here, the same way the sign-in
   text is in the networking suite. */

console.log('\ntaking an advert down');

const KV_URL = 'https://seat-airlines-banners.example.workers.dev/images/banners/0123456789abcdef0123456789abcdef.webp';
const R2_URL = 'https://pub-123.r2.dev/banners/fedcba9876543210fedcba9876543210.jpg';

check('the page and the Worker sign the same text to publish', () => {
  const issued = '2026-09-24T00:00:00.000Z';
  assert(challenge('WalletOne', 'ab'.repeat(32), issued) === workerChallenge('WalletOne', 'ab'.repeat(32), issued),
    'the publish challenges differ');
});

check('the page and the Worker sign the same text to take one down', () => {
  const issued = '2026-09-24T00:00:00.000Z';
  const key = 'banners/0123456789abcdef0123456789abcdef.webp';
  assert(takedownChallenge('WalletOne', key, issued) === workerTakedown('WalletOne', key, issued),
    'the takedown challenges differ');
});

check('the takedown names the advert, not only the wallet', () => {
  const issued = '2026-09-24T00:00:00.000Z';
  assert(takedownChallenge('W', 'banners/a.webp', issued) !== takedownChallenge('W', 'banners/b.webp', issued),
    'two adverts signed as the same text');
});

check('an advert is found by its key under either kind of storage', () => {
  assert(advertKey(KV_URL) === 'banners/0123456789abcdef0123456789abcdef.webp', `KV: ${advertKey(KV_URL)}`);
  assert(advertKey(R2_URL) === 'banners/fedcba9876543210fedcba9876543210.jpg', `R2: ${advertKey(R2_URL)}`);
  assert(advertKey('https://x.test/images/banners%2FWallet.jpg?v=1') === 'banners/Wallet.jpg', 'an encoded, versioned legacy key');
  assert(advertKey('data:image/svg+xml,%3Csvg%3E') === null, 'a house advert has no key');
  assert(advertKey('not a url') === null, 'garbage has no key');
});

const unpublish = () =>
  unpublishBanner({ owner: 'WalletOne', image: KV_URL, sign: async (text) => `signed:${text}` });

await checkAsync('a takedown sends the key, and signs the takedown text', async () => {
  let sent;
  globalThis.fetch = async (url, init) => { sent = { url, init }; return new Response('{"ok":true}', { status: 200 }); };
  await unpublish();
  assert(sent.init.method === 'DELETE' && /\/banner$/.test(sent.url), `${sent.init.method} ${sent.url}`);
  const body = JSON.parse(sent.init.body);
  assert(body.key === 'banners/0123456789abcdef0123456789abcdef.webp', `key ${body.key}`);
  assert(body.signature === `signed:${takedownChallenge('WalletOne', body.key, body.issued)}`, 'signed the wrong text');
});

await checkAsync('an advert already gone counts as taken down', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'There is no advert up for this wallet.', gone: true }), { status: 404 });
  await unpublish();
});

await checkAsync('a Worker without the takedown route leaves the advert up, and says so', async () => {
  /* The fallthrough 404 a Worker deployed before the route gives the same
     DELETE. Taking it as done would report the advert down while it is
     still on the wall. */
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'No such route.' }), { status: 404 });
  await rejects(unpublish, (e) => {
    assert(!(e instanceof ServerUnreachable), 'a 404 was mistaken for an outage');
    assert(/still up/.test(e.message), `did not say the advert is still up: "${e.message}"`);
  }, 'takedown against a Worker without the route');
});

await checkAsync('a takedown refusal keeps the server’s reason', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'That advert has already been replaced.' }), { status: 409 });
  await rejects(unpublish, (e) => {
    assert(!(e instanceof ServerUnreachable), 'a 409 was mistaken for an outage');
    assert(/already been replaced/.test(e.message), `lost the server's reason: "${e.message}"`);
  }, 'refused takedown');
});

await checkAsync('an unreachable server leaves the advert up, and says so', async () => {
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await rejects(unpublish, (e) => assert(e instanceof ServerUnreachable, `got ${e.name}`), 'unreachable takedown');
});

console.log('\nhouse adverts');

check('the seated-by-rank advert names the real cabin size', () => {
  const svg = decodeURIComponent(Object.values(houseAdverts(Array.from({ length: 20 }, (_, i) => `S${i}`))).map((b) => b.image).join(''));
  assert(!/TOP 40 ONLY/.test(svg), 'still says TOP 40');
  assert(/TOP 178 ONLY/.test(svg), 'does not say TOP 178');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
