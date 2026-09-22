/**
 * What a legal set of flight controls is.
 *
 * These switches are the aircraft's rather than one browser's: the Worker
 * stores them and every visitor's page reads them, so a bad value is not one
 * person's problem — it is a rotation of NaN on every open tab at once, which
 * is an aeroplane that disappears and a canvas that never comes back.
 *
 * The clamp is the only thing standing between that and a hand-written `PUT`,
 * and both sides run this exact function: the panel before it sends, the
 * Worker before it stores, and the Worker again on the way back out. So every
 * case here is a way somebody could get a value past it.
 *
 *   npm test
 */
import { readFileSync } from 'node:fs';
import {
  HANDS_OFF, WEATHERS, clamped, coverFor, handsOff,
} from '../dist-test/manualControls.js';

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log('\nmanual controls');

check('nothing at all is an aeroplane flying the market', () => {
  const c = clamped({});
  assert(handsOff(c), `not hands off: ${JSON.stringify(c)}`);
  assert(c.halfRolls === 0 && c.spin === 0, 'the aeroplane did not start level');
  assert(c.flaps === null && c.hour === null && c.weather === null, 'something was overridden from nothing');
});

check('a value that is not a number never reaches the scene', () => {
  /* The one that matters most. A NaN here is `rotation.z = NaN` on every
     page that has the site open. */
  const c = clamped({ halfRolls: 'banana', spin: 'fast', flaps: 'down', hour: 'noon', weather: 42 });
  assert(c.halfRolls === 0, `halfRolls: ${c.halfRolls}`);
  assert(c.spin === 0, `spin: ${c.spin}`);
  assert(c.flaps === null, `flaps: ${c.flaps}`);
  assert(c.hour === null, `hour: ${c.hour}`);
  assert(c.weather === null, `weather: ${c.weather}`);
});

check('nor does a null, an infinity or a NaN', () => {
  // JSON cannot carry the last two, so they arrive as null — which must not
  // read as a number just because `Number(null)` is 0.
  const c = clamped(JSON.parse('{"halfRolls":null,"spin":null,"hour":null,"flaps":null}'));
  assert(c.halfRolls === 0 && c.spin === 0 && c.hour === null && c.flaps === null, JSON.stringify(c));
  const live = clamped({ halfRolls: NaN, spin: Infinity, flaps: -Infinity, hour: NaN });
  assert(live.halfRolls === 0 && live.spin === 0 && live.flaps === null && live.hour === null, JSON.stringify(live));
});

check('the roll is bounded, and whole', () => {
  /* Unbounded, a hand-written 10,000 is every visitor watching an aeroplane
     spin for an hour with no switch that stops it before it gets there. */
  assert(clamped({ halfRolls: 10_000 }).halfRolls === 8, 'up');
  assert(clamped({ halfRolls: -10_000 }).halfRolls === -8, 'down');
  assert(clamped({ halfRolls: 1.4 }).halfRolls === 1, 'a fractional half-turn was kept');
});

check('so are the camera, the flaps and the clock', () => {
  const high = clamped({ spin: 900, flaps: 40, hour: 99 });
  assert(high.spin === 45 && high.flaps === 1 && high.hour === 23, JSON.stringify(high));
  const low = clamped({ spin: -900, flaps: -3, hour: -5 });
  assert(low.spin === -45 && low.flaps === 0 && low.hour === 0, JSON.stringify(low));
  assert(clamped({ hour: 14.6 }).hour === 15, 'a fractional hour was kept');
});

check('the weather has to be a weather', () => {
  assert(clamped({ weather: 'apocalypse' }).weather === null, 'an invented weather was accepted');
  for (const w of WEATHERS) {
    assert(clamped({ weather: w }).weather === w, `${w} did not survive`);
  }
});

check('every weather knows how much cloud it means', () => {
  /* A missing entry would be `cloudCover: undefined`, which is a cloud count
     of NaN and an instanced mesh drawing nothing. */
  for (const w of WEATHERS) {
    const cover = coverFor(w);
    assert(Number.isFinite(cover) && cover >= 0 && cover <= 1, `${w}: ${cover}`);
  }
});

check('clamping is idempotent', () => {
  /* It runs three times on the round trip — panel, store, read — so a second
     pass changing anything would mean a switch that drifts on its own. */
  const flown = clamped({ halfRolls: 3, spin: 18, flaps: 0.5, hour: 21, weather: 'storm' });
  assert(JSON.stringify(clamped(flown)) === JSON.stringify(flown), JSON.stringify(flown));
  assert(JSON.stringify(clamped(HANDS_OFF)) === JSON.stringify(HANDS_OFF), 'hands off did not survive');
});

check('hands off is only ever hands off', () => {
  /* The Worker stores hands-off as an absence, so this decides whether the
     record is deleted or written — a wrong answer leaves a stale one behind. */
  assert(handsOff(HANDS_OFF), 'the default did not read as hands off');
  assert(!handsOff({ ...HANDS_OFF, halfRolls: 1 }), 'an inverted aeroplane read as hands off');
  assert(!handsOff({ ...HANDS_OFF, spin: 6 }), 'a spinning camera read as hands off');
  assert(!handsOff({ ...HANDS_OFF, flaps: 0 }), 'flaps up read as hands off — it is not the same as auto');
  assert(!handsOff({ ...HANDS_OFF, hour: 0 }), 'midnight read as hands off — it is not the same as "now"');
  assert(!handsOff({ ...HANDS_OFF, weather: 'clear' }), 'forced clear read as hands off');
});

check('the shared module stays shareable', () => {
  /* Not a behaviour, a claim. The Worker imports this file, so anything in
     it that touches a browser or a network is a deploy that does not build —
     and the reason both sides agree on what a legal set of controls is, is
     that there is only one of this function. */
  const source = readFileSync(new URL('../src/lib/manualControls.ts', import.meta.url), 'utf8');
  // Comments stripped first: this file talks about cabin windows, and a test
  // that cannot tell prose from code fails on its own documentation.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert(!/\bfetch\s*\(/.test(code), 'the shared controls module learned to talk to a server');
  assert(!/\bwindow\b|localStorage|document\./.test(code), 'the shared controls module reached for a browser');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
