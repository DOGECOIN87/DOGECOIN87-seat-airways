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
import { dataUrlBytes, houseAdverts } from '../dist-test/banners.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
