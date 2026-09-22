/**
 * The logbook's rules, and the one line that is the whole feature.
 *
 * `isAdmin` is the only thing standing between one person's private notes and
 * everybody else, so most of what is here is about the ways it could say yes
 * when it should say no: an unset config, a malformed one, a near-miss
 * address, a difference of case. A rule this short is exactly the kind that
 * gets "simplified" later by somebody who cannot see what each half was for.
 *
 * The rest is what the server will accept into the table, and one check that
 * the page and the Worker normalise a tag the same way — because a composer
 * that writes `Partner` where the filter looks for `partner` loses notes
 * silently, which is the worst way to lose them.
 *
 *   npm test
 */
import {
  conviction, entryId, isAdmin, packTags, readLogbookInput, readLogbookPatch,
  status, tagList, unpackTags,
  MAX_NOTE_CHARS, MAX_SOURCE_CHARS, MAX_TAGS, MAX_TAG_CHARS, STATUSES,
} from '../dist-test/workerLogbook.js';
import { LOG_STATUSES, parseTags } from '../dist-test/logbookApi.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* Two real base58 addresses, differing in ways somebody might not notice. */
const ADMIN = 'Hn1i7bLb7oHpAL5AoyGvkn7YgwmWrVTbVsjXA1LYnELo';
const OTHER = 'Ame7HoqEdhPsyuhtKR98J5onwUcQm96bNCViGfHprh8D';

console.log('\nthe logbook');

/* ── Whose it is ──────────────────────────────────────────────────────────
   Every case here is a way of accidentally letting somebody in. */

check('the configured wallet is the operator', () => {
  assert(isAdmin(ADMIN, ADMIN) === true, 'the operator was not recognised');
});

check('everybody else is not, however much they hold', () => {
  assert(isAdmin(ADMIN, OTHER) === false, 'another wallet was taken for the operator');
});

check('an unconfigured logbook belongs to nobody, not to everybody', () => {
  /* The failure this exists to prevent: an empty var read as "no restriction"
     would hand the notes to the first wallet that signed in. */
  assert(isAdmin(undefined, ADMIN) === false, 'an unset ADMIN_WALLET admitted somebody');
  assert(isAdmin('', ADMIN) === false, 'an empty ADMIN_WALLET admitted somebody');
  assert(isAdmin('   ', ADMIN) === false, 'a blank ADMIN_WALLET admitted somebody');
});

check('a malformed ADMIN_WALLET matches nothing at all', () => {
  /* Not even itself. A stray quote or a truncated paste should close the
     logbook rather than open it to whoever can reproduce the typo. */
  assert(isAdmin('"Hn1i7bLb"', '"Hn1i7bLb"') === false, 'a non-address was accepted as the operator');
  assert(isAdmin('not-a-key', 'not-a-key') === false, 'a non-address was accepted as the operator');
});

check('nobody is the operator when nobody is signed in', () => {
  assert(isAdmin(ADMIN, null) === false, 'a null address was admitted');
  assert(isAdmin(ADMIN, '') === false, 'an empty address was admitted');
});

check('whitespace around the configured value is tolerated, not ignored elsewhere', () => {
  /* A trailing newline in a `wrangler secret put` is easy to do and would
     otherwise lock the operator out of their own logbook silently. */
  assert(isAdmin(`  ${ADMIN}\n`, ADMIN) === true, 'a padded config did not match');
  assert(isAdmin(ADMIN, ` ${ADMIN}`) === false, 'a padded session address matched');
});

check('base58 is case-sensitive here, as it is everywhere else', () => {
  assert(isAdmin(ADMIN, ADMIN.toLowerCase()) === false, 'a lowercased address matched');
  assert(isAdmin(ADMIN.toLowerCase(), ADMIN) === false, 'a lowercased config matched');
});

/* ── What a note may be ─────────────────────────────────────────────────── */

check('a note needs a note in it', () => {
  assert('error' in readLogbookInput({ body: '' }), 'an empty note was accepted');
  assert('error' in readLogbookInput({ body: '   ' }), 'a whitespace note was accepted');
  assert('error' in readLogbookInput({}), 'a note with no body was accepted');
  assert('error' in readLogbookInput('just a string'), 'a string was accepted as a note');
  assert('error' in readLogbookInput(null), 'null was accepted as a note');
});

check('everything but the body has a sensible absence', () => {
  const read = readLogbookInput({ body: '  They are listing next week.  ' });
  assert('entry' in read, 'a perfectly good note was refused');
  const { entry } = read;
  assert(entry.body === 'They are listing next week.', `body: ${entry.body}`);
  assert(entry.source === '', 'source did not default to nothing');
  assert(entry.tags.length === 0, 'tags did not default to none');
  assert(entry.conviction === 0, 'conviction did not default to unrated');
  assert(entry.status === 'open', 'status did not default to open');
});

check('a note is capped rather than refused for being long', () => {
  const read = readLogbookInput({ body: 'x'.repeat(MAX_NOTE_CHARS + 500), source: 's'.repeat(400) });
  assert('entry' in read, 'a long note was refused outright');
  assert(read.entry.body.length === MAX_NOTE_CHARS, `body kept ${read.entry.body.length}`);
  assert(read.entry.source.length === MAX_SOURCE_CHARS, `source kept ${read.entry.source.length}`);
});

check('conviction is a rung on a ladder, whatever arrives', () => {
  assert(conviction(2) === 2, 'a valid rating changed');
  assert(conviction(9) === 3, 'a rating above the top was not clamped');
  assert(conviction(-4) === 0, 'a negative rating was not clamped');
  assert(conviction(1.6) === 2, 'a fractional rating was not rounded');
  assert(conviction('3') === 3, 'a numeric string was not read');
  assert(conviction('soon') === 0, 'nonsense did not fall back to unrated');
  assert(conviction(undefined) === 0, 'an absent rating was not unrated');
});

check('a new note with an unrecognised state is simply open', () => {
  assert(status('acted') === 'acted', 'a real status was lost');
  assert(status('hot') === 'open', 'an unknown status did not default to open');
  assert(status(undefined) === 'open', 'an absent status did not default to open');
});

/* ── Tags ─────────────────────────────────────────────────────────────── */

check('a tag has one spelling', () => {
  const tags = tagList(' Partner , partner,  #PARTNER , listing ');
  assert(tags.length === 2, `three spellings of two tags became ${tags.length}: ${tags}`);
  assert(tags[0] === 'partner' && tags[1] === 'listing', `tags: ${tags}`);
});

check('tags are bounded in both directions', () => {
  const many = tagList(Array.from({ length: 30 }, (_, i) => `tag${i}`).join(','));
  assert(many.length === MAX_TAGS, `${many.length} tags kept, cap is ${MAX_TAGS}`);
  const long = tagList('a'.repeat(100));
  assert(long[0].length === MAX_TAG_CHARS, `a tag kept ${long[0].length} characters`);
});

check('tags survive the round trip through the one column they live in', () => {
  const tags = tagList('listing, cex, partner');
  const back = unpackTags(packTags(tags));
  assert(back.join('|') === tags.join('|'), `${back} came back from ${tags}`);
});

check('the page and the Worker spell a tag the same way', () => {
  /* The invariant that matters most here. The composer normalises what
     somebody typed, the Worker normalises what it stores, and if those two
     ever disagree then a note is filed under a tag its own filter will never
     find — a loss with no error anywhere to show for it. */
  for (const typed of [' Partner ', '#CEX', 'Multi Word', 'ünïcödé', 'a-b_c/d+e', 'UPPER,lower']) {
    const page = parseTags(typed).join('|');
    const worker = tagList(typed).join('|');
    assert(page === worker, `"${typed}" is "${page}" on the page and "${worker}" in the Worker`);
  }
});

check('the page and the Worker agree on what a note can be marked', () => {
  assert(LOG_STATUSES.join(',') === STATUSES.join(','),
    `page: ${LOG_STATUSES}, worker: ${STATUSES}`);
});

/* ── Amending one ─────────────────────────────────────────────────────── */

check('an amendment touches only the fields it names', () => {
  const read = readLogbookPatch({ status: 'acted' });
  assert('patch' in read, 'marking a note acted was refused');
  const keys = Object.keys(read.patch);
  assert(keys.length === 1 && keys[0] === 'status', `it also wrote: ${keys}`);
});

check('an amendment cannot empty a note', () => {
  /* The bug this is here to catch: running an amendment through the reader
     for a *new* note would take an absent body as an empty one and blank
     every note somebody marked acted on. */
  assert('error' in readLogbookPatch({ body: '  ' }), 'a note was emptied by amendment');
  assert('patch' in readLogbookPatch({ conviction: 3 }), 'an absent body refused an amendment');
});

check('an unrecognised state is refused rather than read as open', () => {
  /* Where a new note defaults, an amendment must not: reopening a line
     somebody closed, on a typo, is the kind of wrong that looks right. */
  const read = readLogbookPatch({ status: 'warm' });
  assert('error' in read, 'an unknown status quietly reopened a note');
  assert(read.error.includes('warm'), `the refusal did not say what was wrong: ${read.error}`);
});

check('an amendment that changes nothing is refused', () => {
  assert('error' in readLogbookPatch({}), 'an empty amendment was accepted');
  assert('error' in readLogbookPatch({ id: 'abc' }), 'an amendment naming only an id was accepted');
  assert('error' in readLogbookPatch(null), 'null was accepted as an amendment');
});

check('clearing a field is a change, not an absence', () => {
  const read = readLogbookPatch({ source: '', tags: '' });
  assert('patch' in read, 'clearing the source was refused');
  assert(read.patch.source === '', 'the source was not cleared');
  assert(Array.isArray(read.patch.tags) && read.patch.tags.length === 0, 'the tags were not cleared');
});

/* ── Ids ──────────────────────────────────────────────────────────────── */

check('ids are unique and sort by when they were written', () => {
  const ids = new Set(Array.from({ length: 500 }, entryId));
  assert(ids.size === 500, `${500 - ids.size} collisions in 500 ids`);
  const [a, b] = [...ids];
  assert(a.split('-').length === 2, `an id is not two parts: ${a}`);
  assert(a.split('-')[0] === b.split('-')[0], 'ids written in the same millisecond disagree about when');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
