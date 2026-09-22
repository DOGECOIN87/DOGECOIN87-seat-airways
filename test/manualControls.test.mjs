/**
 * The manual controls, read back out of storage.
 *
 * These switches are cosmetic and local, so none of this is about security —
 * it is about a scene that has to keep rendering. `localStorage` is the one
 * piece of page state a person can edit by hand, and the reader is what
 * stands between a hand-edited `halfRolls: "banana"` and an aeroplane whose
 * rotation is NaN for the rest of the page's life. Every field is checked
 * rather than trusted, and every case here is one of the ways it could be
 * wrong.
 *
 *   npm test
 */
import { readFileSync } from 'node:fs';

/* A localStorage that behaves like one, including throwing when asked to,
   because a browser in private mode does exactly that. */
let store = new Map();
let refuse = false;
globalThis.window = {
  localStorage: {
    getItem: (k) => { if (refuse) throw new Error('blocked'); return store.has(k) ? store.get(k) : null; },
    setItem: (k, v) => { if (refuse) throw new Error('blocked'); store.set(k, v); },
    removeItem: (k) => { if (refuse) throw new Error('blocked'); store.delete(k); },
  },
};

const {
  HANDS_OFF, WEATHERS, clamped, coverFor, handsOff, keepControls, storedControls,
} = await import('../dist-test/manualControls.js');

let pass = 0, fail = 0;
const check = (name, fn) => {
  try { store = new Map(); refuse = false; fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const KEY = 'seat-airlines.manual.v1';
const put = (value) => store.set(KEY, typeof value === 'string' ? value : JSON.stringify(value));

console.log('\nmanual controls');

check('an empty browser is flying the market', () => {
  const c = storedControls();
  assert(handsOff(c), `not hands off: ${JSON.stringify(c)}`);
  assert(c.halfRolls === 0 && c.spin === 0, 'the aeroplane did not start level');
  assert(c.flaps === null && c.hour === null && c.weather === null, 'something was overridden from nothing');
});

check('so is a browser with rubbish in that key', () => {
  put('{not json at all');
  assert(handsOff(storedControls()), 'malformed storage was not ignored');
  put('null');
  assert(handsOff(storedControls()), 'a stored null was not ignored');
  put('"a string"');
  assert(handsOff(storedControls()), 'a stored string was not ignored');
});

check('and one where storage itself refuses', () => {
  refuse = true;
  assert(handsOff(storedControls()), 'a throwing localStorage was not survived');
  // Writing has to survive it too, or every switch throws in private mode.
  keepControls({ ...HANDS_OFF, halfRolls: 1 });
});

check('a value that is not a number never reaches the scene', () => {
  /* The one that matters. A NaN here is `rotation.z = NaN`, which is an
     aeroplane that disappears and a canvas that never comes back. */
  put({ halfRolls: 'banana', spin: 'fast', flaps: 'down', hour: 'noon', weather: 42 });
  const c = storedControls();
  assert(c.halfRolls === 0, `halfRolls: ${c.halfRolls}`);
  assert(c.spin === 0, `spin: ${c.spin}`);
  assert(c.flaps === null, `flaps: ${c.flaps}`);
  assert(c.hour === null, `hour: ${c.hour}`);
  assert(c.weather === null, `weather: ${c.weather}`);
});

check('nor does an infinity or a NaN', () => {
  // JSON cannot carry either, so they arrive as null — which must not read
  // as a number just because `Number(null)` is 0.
  put('{"halfRolls":null,"spin":null,"hour":null}');
  const c = storedControls();
  assert(c.halfRolls === 0 && c.spin === 0 && c.hour === null, JSON.stringify(c));
});

check('the roll is bounded, and whole', () => {
  /* Unbounded, a hand-edited 10,000 is an aeroplane that spins for an hour
     with no switch that stops it before it gets there. */
  put({ halfRolls: 10_000 });
  assert(storedControls().halfRolls === 8, `up: ${storedControls().halfRolls}`);
  put({ halfRolls: -10_000 });
  assert(storedControls().halfRolls === -8, `down: ${storedControls().halfRolls}`);
  put({ halfRolls: 1.4 });
  assert(storedControls().halfRolls === 1, 'a fractional half-turn was kept');
});

check('so are the camera, the flaps and the clock', () => {
  put({ spin: 900, flaps: 40, hour: 99 });
  const high = storedControls();
  assert(high.spin === 45, `spin: ${high.spin}`);
  assert(high.flaps === 1, `flaps: ${high.flaps}`);
  assert(high.hour === 23, `hour: ${high.hour}`);
  put({ spin: -900, flaps: -3, hour: -5 });
  const low = storedControls();
  assert(low.spin === -45, `spin: ${low.spin}`);
  assert(low.flaps === 0, `flaps: ${low.flaps}`);
  assert(low.hour === 0, `hour: ${low.hour}`);
});

check('the weather has to be a weather', () => {
  put({ weather: 'apocalypse' });
  assert(storedControls().weather === null, 'an invented weather was accepted');
  for (const w of WEATHERS) {
    put({ weather: w });
    assert(storedControls().weather === w, `${w} did not survive`);
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

check('the switches survive a round trip', () => {
  const flown = { halfRolls: 3, spin: 18, flaps: 0.5, hour: 21, weather: 'storm' };
  keepControls(flown);
  const back = storedControls();
  assert(JSON.stringify(back) === JSON.stringify(flown), `${JSON.stringify(back)}`);
});

check('putting them all back clears the key rather than storing a default', () => {
  keepControls({ ...HANDS_OFF, halfRolls: 1 });
  assert(store.has(KEY), 'a change was not stored');
  keepControls(HANDS_OFF);
  assert(!store.has(KEY), 'hands off left something behind in storage');
});

check('hands off is only ever hands off', () => {
  assert(handsOff(HANDS_OFF), 'the default did not read as hands off');
  assert(!handsOff({ ...HANDS_OFF, halfRolls: 1 }), 'an inverted aeroplane read as hands off');
  assert(!handsOff({ ...HANDS_OFF, spin: 6 }), 'a spinning camera read as hands off');
  assert(!handsOff({ ...HANDS_OFF, flaps: 0 }), 'flaps up read as hands off — it is not the same as auto');
  assert(!handsOff({ ...HANDS_OFF, hour: 0 }), 'midnight read as hands off — it is not the same as "now"');
  assert(!handsOff({ ...HANDS_OFF, weather: 'clear' }), 'forced clear read as hands off');
});

check('the panel goes through the same limits storage does', () => {
  /* Both doors, one function. The barrel-roll button adds two half-turns a
     press, so without this a session could queue twenty and then watch the
     aeroplane unwind to eight on the next reload — the switches disagreeing
     with themselves across a refresh. */
  const queued = clamped({ ...HANDS_OFF, halfRolls: 20 });
  assert(queued.halfRolls === 8, `the panel queued ${queued.halfRolls} half-turns`);
  keepControls({ ...HANDS_OFF, halfRolls: 20 });
  assert(storedControls().halfRolls === 8, 'storage and the panel disagree about the limit');
  assert(JSON.stringify(clamped(HANDS_OFF)) === JSON.stringify(HANDS_OFF), 'hands off did not survive clamping');
  assert(JSON.stringify(clamped({})) === JSON.stringify(HANDS_OFF), 'an empty object was not hands off');
});

check('the module is honest about being cosmetic', () => {
  /* Not a behaviour, a claim: nothing in here may grow a network call. The
     switches are local by construction, and the moment one of them posts
     somewhere it stops being safe that anybody can edit the key by hand. */
  const source = readFileSync(new URL('../src/lib/manualControls.ts', import.meta.url), 'utf8');
  assert(!/\bfetch\s*\(/.test(source), 'the manual controls learned to talk to a server');
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
