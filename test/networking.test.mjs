/**
 * The directory's two halves, checked against each other.
 *
 * The first case here is the one that matters most and is the easiest to
 * break: the page and the Worker each write out the text the wallet signs,
 * and if those two strings differ by a character then every sign-in fails
 * with "that signature does not match the wallet" — a message that points at
 * the wallet rather than at the typo that caused it.
 *
 * The rest is what the server will accept into the database.
 *
 *   npm test
 */
import { webcrypto as crypto } from 'node:crypto';
import { signInChallenge as clientChallenge } from '../dist-test/networkingApi.js';
import {
  bearerToken, isAddress, mintToken, readMessageBody, readProfileInput,
  signInChallenge as workerChallenge, tokenHash, MAX_BODY_CHARS,
} from '../dist-test/workerNetworking.js';

let pass = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

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

const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const wallet = toBase58(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));

console.log('\ncabin directory');

await check('the page and the Worker sign the same text', () => {
  const issued = '2026-09-20T12:00:00.000Z';
  assert(
    clientChallenge(wallet, issued) === workerChallenge(wallet, issued),
    'the sign-in challenge differs between the page and the Worker',
  );
});

await check('the challenge names the wallet and the time', () => {
  const issued = '2026-09-20T12:00:00.000Z';
  const text = workerChallenge(wallet, issued);
  assert(text.includes(`wallet: ${wallet}`), 'the challenge does not name the wallet');
  assert(text.includes(`issued: ${issued}`), 'the challenge is not stamped with the time');
});

await check('a real public key is an address', () => {
  assert(isAddress(wallet), 'a genuine ed25519 key was refused');
});

await check('junk is not an address', () => {
  for (const value of ['', 'hello', '0OIl', wallet + wallet, 42, null, undefined]) {
    assert(!isAddress(value), `"${String(value)}" was accepted as an address`);
  }
});

await check('a card is trimmed and capped', () => {
  const out = readProfileInput({ displayName: '  Aisle Hopper  ', role: 'x'.repeat(500) });
  assert(!('error' in out), 'a valid card was refused');
  assert(out.profile.displayName === 'Aisle Hopper', 'the name was not trimmed');
  assert(out.profile.role.length === 120, `the role was not capped: ${out.profile.role.length}`);
  assert(out.profile.email === '', 'a missing field did not default to empty');
});

await check('a javascript: contact link is refused', () => {
  const out = readProfileInput({ website: 'javascript:alert(1)' });
  assert('error' in out, 'a javascript: URL was stored as a contact link');
});

await check('an email that is not one is refused', () => {
  assert('error' in readProfileInput({ email: 'not-an-email' }), 'a malformed email was accepted');
  assert(!('error' in readProfileInput({ email: 'pilot@seat-airlines.space' })), 'a real email was refused');
});

await check('an empty introduction is refused', () => {
  assert('error' in readMessageBody('   '), 'an empty message was accepted');
  assert('error' in readMessageBody(null), 'a non-string message was accepted');
});

await check('an oversized introduction is refused', () => {
  assert('error' in readMessageBody('x'.repeat(MAX_BODY_CHARS + 1)), 'an oversized message was accepted');
  assert(!('error' in readMessageBody('Hello from 3A')), 'a normal message was refused');
});

await check('a token is stored only as its hash', async () => {
  const token = mintToken();
  const hash = await tokenHash(token);
  assert(token.length >= 40, `the token is too short to be random: ${token.length}`);
  assert(hash.length === 64 && !hash.includes(token), 'the hash is not a SHA-256 of the token');
  assert(await tokenHash(token) === hash, 'hashing the same token twice gave two answers');
  assert(await tokenHash(mintToken()) !== hash, 'two tokens hashed the same');
});

await check('the bearer header is read, and only when it is one', () => {
  assert(bearerToken('Bearer abc-123') === 'abc-123', 'a valid bearer header was not read');
  assert(bearerToken('Basic abc') === null, 'a non-bearer scheme was accepted');
  assert(bearerToken(null) === null, 'a missing header was accepted');
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
