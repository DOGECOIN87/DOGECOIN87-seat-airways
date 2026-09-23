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
import { dataUrlBytes, houseAdverts, publishBanner, ServerUnreachable } from '../dist-test/banners.js';

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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
