/**
 * Who can see whom, in one direction only.
 *
 * The cabin is transparent looking aft and opaque looking forward: a holder
 * reads their own section and everything behind it, and nothing ahead. These
 * are the rules the Worker enforces — it imports the same module — so a
 * change here that is not deliberate is a change to a privacy boundary.
 *
 *   npm test
 */
import assert from 'node:assert/strict';
import { canMessage, canOverhear, canViewContact, isValidExternalUrl, outranks } from '../dist-test/sectionAccess.js';

const deck = 'deck';
const first = 'first';
const business = 'business';
const economy = 'economy';
const hold = null;
const alice = 'alice-wallet';
const bob = 'bob-wallet';

let pass = 0;
const check = (name, fn) => { fn(); console.log(`  ok   ${name}`); pass++; };

console.log('\nsection access');

check('you can read your own section', () => {
  assert.equal(canViewContact(first, first), true);
  assert.equal(canViewContact(economy, economy), true);
});

check('you can read every cabin behind you', () => {
  assert.equal(canViewContact(deck, economy), true);
  assert.equal(canViewContact(first, business), true);
  assert.equal(canViewContact(business, economy), true);
});

check('you can read nothing ahead of you', () => {
  assert.equal(canViewContact(business, first), false);
  assert.equal(canViewContact(economy, deck), false);
  assert.equal(canViewContact(first, deck), false);
});

check('the hold is not a cabin: nobody reads it, and it reads nobody', () => {
  assert.equal(canViewContact(hold, economy), false, 'an unseated wallet reads nothing');
  assert.equal(canViewContact(economy, hold), false, 'there is no card in the hold to read');
  assert.equal(canViewContact(deck, hold), false, 'not even from the flight deck');
  assert.equal(canViewContact(hold, hold), false);
});

check('a conversation carries forward, never aft', () => {
  assert.equal(canOverhear(deck, first, business), true, 'the deck is ahead of both ends');
  assert.equal(canOverhear(first, business, economy), true);
  assert.equal(canOverhear(business, first, economy), false, 'one end is ahead of the reader');
  assert.equal(canOverhear(economy, first, first), false);
});

check('a section cannot read its own peers', () => {
  assert.equal(canOverhear(first, first, business), false, 'one end is level with the reader');
  assert.equal(canOverhear(first, first, first), false);
  assert.equal(canOverhear(business, business, business), false);
});

check('a conversation with the hold is nobody’s to read', () => {
  assert.equal(canOverhear(hold, first, economy), false, 'an unseated wallet overhears nothing');
  assert.equal(canOverhear(economy, hold, hold), false, 'two wallets nobody can see are not the cabin’s business');
  assert.equal(canOverhear(deck, economy, hold), false, 'one end off the manifest is enough to close it');
  assert.equal(canOverhear(economy, hold, economy), false);
});

check('outranks is strictly forward', () => {
  assert.equal(outranks(deck, first), true);
  assert.equal(outranks(first, first), false);
  assert.equal(outranks(economy, business), false);
  assert.equal(outranks(business, hold), true);
});

check('First Class messaging is unchanged', () => {
  assert.equal(canMessage(first, first, alice, bob), true);
  assert.equal(canMessage(first, business, alice, bob), false);
  assert.equal(canMessage(business, first, alice, bob), false);
  assert.equal(canMessage(first, first, alice, alice), false);
});

check('contact links must be http(s)', () => {
  assert.equal(isValidExternalUrl('https://example.com'), true);
  assert.equal(isValidExternalUrl('javascript:alert(1)'), false);
});

console.log(`\n${pass} passed, 0 failed\n`);
