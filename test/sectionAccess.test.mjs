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
import {
  ANNOUNCEMENT, canAnnounce, canMessage, canOverhear, canPostToChannel, canReadChannel,
  canViewContact, channelFor, isChannel, isValidExternalUrl, outranks, zoneOfChannel,
} from '../dist-test/sectionAccess.js';

const deck = 'deck';
const first = 'first';
const business = 'business';
const exit = 'exit';
const economy = 'economy';
/** Every cabin, front to back, for the rules that must hold across all of them. */
const CABINS = [deck, first, business, exit, economy];
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

check('an introduction carries aft, the way a card does', () => {
  assert.equal(canMessage(first, first, alice, bob), true, 'a cabin cannot write to itself');
  assert.equal(canMessage(first, business, alice, bob), true, 'First Class cannot write to the cabin behind it');
  assert.equal(canMessage(deck, economy, alice, bob), true, 'the flight deck cannot reach the back');
  assert.equal(canMessage(first, first, alice, alice), false, 'a wallet introduced itself to itself');
});

check('and never forward', () => {
  /* The line that does the protecting. It used to be done by the rule being
     narrow — First Class to First Class and nothing else — which also left
     the two largest holders on the aircraft unable to write to anybody. This
     is what was actually worth keeping: the further forward you sit, the
     fewer people can reach you, and nobody at all can reach the flight deck
     from behind it. */
  assert.equal(canMessage(business, first, alice, bob), false, 'business wrote into the cabin in front of it');
  assert.equal(canMessage(economy, deck, alice, bob), false);
  assert.equal(canMessage(first, deck, alice, bob), false, 'the flight deck was written to from behind');
});

check('writing is the same line as reading, in every cabin', () => {
  /* The invariant, rather than five more examples of it: if you can read
     somebody's contact details you can introduce yourself to them, and if you
     cannot you cannot. Two rules that are meant to be one should fail here
     the moment they stop being one. */
  for (const viewer of CABINS) {
    for (const member of CABINS) {
      assert.equal(
        canMessage(viewer, member, alice, bob),
        canViewContact(viewer, member),
        `${viewer} → ${member}: who may write disagrees with who may read`,
      );
    }
  }
});

check('the hold sends nothing and is sent nothing', () => {
  assert.equal(canMessage(hold, first, alice, bob), false, 'a wallet with no seat introduced itself');
  assert.equal(canMessage(first, hold, alice, bob), false, 'an introduction was addressed to the hold');
  assert.equal(canMessage(hold, hold, alice, bob), false);
  assert.equal(canMessage(first, first, null, bob), false, 'a disconnected wallet sent one');
});

check('a room is addressed like a person, and can never be one', () => {
  /* A channel is stored as the recipient of a message, which is where a
     wallet goes. The two must never be confusable, and they cannot be: base58
     has no colon in it, so no key can ever spell `section:first`. */
  assert.equal(channelFor(first), 'section:first');
  assert.equal(zoneOfChannel('section:first'), first);
  assert.equal(zoneOfChannel('section:cargo'), null, 'a cabin that does not exist resolved to one');
  assert.equal(zoneOfChannel('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), null, 'a wallet read as a room');
  assert.equal(isChannel('section:economy'), true);
  assert.equal(isChannel(ANNOUNCEMENT), true);
  assert.equal(isChannel('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU'), false);
});

check('you speak in your own cabin and no other', () => {
  /* The one place posting is narrower than reading. You can read the cabin
     behind you and write to anybody in it personally — but you cannot walk
     into its conversation and talk, because that conversation belongs to the
     people sitting in it. */
  assert.equal(canPostToChannel(first, first), true);
  assert.equal(canPostToChannel(first, business), false, 'First Class talked in the room behind it');
  assert.equal(canPostToChannel(business, first), false, 'business talked in the room in front of it');
  assert.equal(canPostToChannel(deck, economy), false, 'the flight deck talked in economy');
  assert.equal(canPostToChannel(hold, economy), false, 'the hold talked in a cabin');
  assert.equal(canPostToChannel(hold, hold), false);
});

check('but you hear your own cabin and every one behind it', () => {
  for (const viewer of CABINS) {
    for (const room of CABINS) {
      assert.equal(
        canReadChannel(viewer, room),
        canViewContact(viewer, room),
        `${viewer} hearing ${room} disagrees with who may read the card`,
      );
    }
  }
  assert.equal(canReadChannel(deck, economy), true, 'the flight deck hears the whole aeroplane');
  assert.equal(canReadChannel(economy, business), false, 'the last row heard the cabin in front');
  assert.equal(canReadChannel(hold, economy), false, 'the hold heard a cabin');
});

check('the PA belongs to the flight deck', () => {
  assert.equal(canAnnounce(deck), true);
  assert.equal(canAnnounce(first), false, 'First Class took the PA');
  assert.equal(canAnnounce(economy), false);
  assert.equal(canAnnounce(hold), false);
});

check('contact links must be http(s)', () => {
  assert.equal(isValidExternalUrl('https://example.com'), true);
  assert.equal(isValidExternalUrl('javascript:alert(1)'), false);
});

console.log(`\n${pass} passed, 0 failed\n`);
