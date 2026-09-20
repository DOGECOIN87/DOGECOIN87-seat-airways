import assert from 'node:assert/strict';
import { canMessage, canViewContact, isValidExternalUrl } from '../dist-test/sectionAccess.js';

const first = 'first';
const business = 'business';
const alice = 'alice-wallet';
const bob = 'bob-wallet';

assert.equal(canViewContact(first, first), true, 'same-section members can view contact details');
assert.equal(canViewContact(first, business), false, 'different sections cannot view contact details');
assert.equal(canViewContact(null, first), false, 'unseated visitors cannot view contact details');
assert.equal(canMessage(first, first, alice, bob), true, 'First Class members can message peers');
assert.equal(canMessage(first, business, alice, bob), false, 'First Class cannot message other sections');
assert.equal(canMessage(business, first, alice, bob), false, 'non-First members cannot message First Class');
assert.equal(canMessage(first, first, alice, alice), false, 'members cannot message themselves');
assert.equal(isValidExternalUrl('https://example.com'), true);
assert.equal(isValidExternalUrl('javascript:alert(1)'), false);

console.log('section access: 9 passed, 0 failed');
