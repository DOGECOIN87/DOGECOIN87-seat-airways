/**
 * The security boundary, exercised directly.
 *
 * A real ed25519 keypair signs a real challenge; the checks then have to
 * accept it, and reject every way of bending it that matters. Run with:
 *
 *   npm test
 */
import { webcrypto as crypto } from 'node:crypto';
import assert from 'node:assert/strict';
import { challenge, decodeDataUrl, imageType, sha256Hex, verifySignature } from '../dist-test/verify.js';

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

let pass = 0;
let fail = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok   ${name}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL ${name}\n       ${e.message}`);
    fail++;
  }
};

// A wallet.
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const owner = toBase58(raw);

// A JPEG, as a data URL, the way the client sends one.
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const dataUrl = 'data:image/jpeg;base64,' + Buffer.from(JPEG).toString('base64');

const sign = async (msg) =>
  toBase58(
    new Uint8Array(
      await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(msg)),
    ),
  );

const issued = new Date().toISOString();
const hash = await sha256Hex(JPEG);
const message = challenge(owner, hash, issued);
const signature = await sign(message);

console.log('\nverify.ts');

await check('accepts a genuine signature', async () => {
  assert.equal(await verifySignature(owner, message, signature), true);
});

await check('rejects a signature from a different wallet', async () => {
  const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const otherRaw = new Uint8Array(await crypto.subtle.exportKey('raw', other.publicKey));
  assert.equal(await verifySignature(toBase58(otherRaw), message, signature), false);
});

await check('rejects a captured signature reused for OTHER artwork', async () => {
  // The whole reason the image hash lives inside the signed text.
  const evil = Uint8Array.from([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]);
  const evilMessage = challenge(owner, await sha256Hex(evil), issued);
  assert.equal(await verifySignature(owner, evilMessage, signature), false);
});

await check('rejects a tampered timestamp', async () => {
  const moved = challenge(owner, hash, new Date(Date.now() + 60_000).toISOString());
  assert.equal(await verifySignature(owner, moved, signature), false);
});

await check('rejects malformed base58', async () => {
  assert.equal(await verifySignature('not-base58-0OIl', message, signature), false);
  assert.equal(await verifySignature(owner, message, 'zzz'), false);
});

await check('sniffs JPEG and PNG from magic bytes', async () => {
  assert.equal(imageType(JPEG), 'image/jpeg');
  assert.equal(
    imageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    'image/png',
  );
});

await check('refuses SVG however it is labelled', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal(imageType(svg), null);
});

await check('refuses a JPEG-labelled data URL carrying SVG bytes', async () => {
  const svg = new TextEncoder().encode('<svg onload="alert(1)">');
  const lying = 'data:image/jpeg;base64,' + Buffer.from(svg).toString('base64');
  assert.equal(imageType(decodeDataUrl(lying)), null);
});

await check('decodes a data URL to the exact bytes', async () => {
  assert.deepEqual(decodeDataUrl(dataUrl), JPEG);
  assert.equal(decodeDataUrl('not a data url'), null);
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
