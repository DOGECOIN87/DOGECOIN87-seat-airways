import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/**
 * The departure board.
 *
 * A split-flap display, the kind that still hangs over the gates in older
 * terminals. Every character is a drum of flaps hinged across its middle, and
 * changing one means the flaps falling one after another until the wanted one
 * is showing — so the cells finish at different times, letters nobody asked
 * for go past on the way, and the board settles a column at a time. That is
 * the whole reason anybody stops to watch one, so it is modelled rather than
 * faked with a cross-fade.
 *
 * It animates the way the instruments do: off refs, through one
 * requestAnimationFrame loop, with no React render per flap. Twenty drums each
 * turning several times a second would otherwise be hundreds of renders a
 * second of a component whose props never change.
 *
 * The board is a picture of words, not the words. It is hidden from assistive
 * technology, and the heading it sits in carries its text — a heading that
 * read out a different phrase on every visit, or half a letter mid-turn,
 * would be worse than a fixed one.
 */

/**
 * The flaps on every drum, in the order they turn: blank first, as on a real
 * board, then the set the reference board carries.
 */
const DRUM = ` ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-/:()%.,!?&$'`;
const BLANK = 0;

/**
 * One flap falling, top to bottom. Slow enough to see it fold, which at the
 * rate a real board turns — fifteen a second — nobody could.
 */
const FLIP_MS = 120;
/**
 * How many flaps a letter turns through to reach the next one.
 *
 * A real drum turns through every flap between the two letters, and at a
 * speed you can see that takes seconds. So each drum turns through the last
 * few flaps of that journey — the letters counting up to the one wanted — and
 * each a different number of them, so the columns land at different moments.
 */
const FLIPS_MIN = 4;
const FLIPS_MAX = 9;
/** How long a phrase stays up once its last flap has landed. */
const HOLD_MS = 4000;
/** The home phrase is the airline's own line, and stays up twice as long. */
const HOME_HOLD_MS = HOLD_MS * 2;
/** Drums start a little after the one to their left, and not quite on time. */
const STAGGER_MS = 45;
const JITTER_MS = 90;
/** The last flap on a drum bounces once when it lands. */
const SETTLE_MS = 200;
/** A beat before the first phrase boards, so it does not turn while the page is still arriving. */
const INTRO_MS = 450;

/** A phrase as the board shows it: every row padded to full width, one drum position per cell. */
function layout(phrase: readonly string[], rows: number, cols: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rows; r++) {
    const line = (phrase[r] ?? '').toUpperCase();
    for (let c = 0; c < cols; c++) {
      const at = DRUM.indexOf(line[c] ?? ' ');
      out.push(at < 0 ? BLANK : at);
    }
  }
  return out;
}

/** What a drum position prints. Blank prints nothing rather than a space. */
const face = (at: number) => (at === BLANK ? '' : DRUM[at]);

const prefersStill = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** One character cell, and everything the loop needs to turn it. */
interface Drum {
  /** The glyphs: the resting upper and lower halves, then the falling and rising leaves. */
  glyphs: readonly HTMLElement[];
  /** What each of those glyphs is printing now, so the loop only writes what changed. */
  printed: number[];
  /** The resting lower half, which the falling flap throws its shadow on. */
  lower: HTMLElement;
  fall: HTMLElement;
  rise: HTMLElement;
  /** Which leaf is drawn, likewise cached: 'fall', 'rise', or neither. */
  drawn: 'fall' | 'rise' | null;
  /** The flap on show. */
  at: number;
  /** The flap the current fall reveals. */
  next: number;
  /** The flap this drum is turning to. */
  target: number;
  state: 'idle' | 'waiting' | 'turning' | 'settling';
  /** When the wait ends, or when the current flip (or bounce) began. */
  from: number;
  /** This drum's own flip time — no two mechanisms are quite the same. */
  rate: number;
}

const UPPER = 0;
const LOWER = 1;
const FALL = 2;
const RISE = 3;

function print(d: Drum, which: number, at: number) {
  if (d.printed[which] === at) return;
  d.printed[which] = at;
  d.glyphs[which].textContent = face(at);
}

/** A flap has started to fall: the next one shows above it, and it still covers the old one below. */
function turn(d: Drum) {
  print(d, UPPER, d.next);
  print(d, LOWER, d.at);
  print(d, FALL, d.at);
  print(d, RISE, d.next);
}

/**
 * Point a resting drum at a new letter, starting at `when`.
 *
 * It turns through the last few flaps before the target, in drum order, so
 * the letter visibly counts up to the one wanted. A drum already showing it
 * stays put, as a real one would.
 */
function aim(d: Drum, target: number, when: number) {
  d.target = target;
  const distance = (target - d.at + DRUM.length) % DRUM.length;
  if (distance === 0) return;
  const flips = Math.min(distance, FLIPS_MIN + Math.floor(Math.random() * (FLIPS_MAX - FLIPS_MIN + 1)));
  d.next = (target - flips + 1 + DRUM.length) % DRUM.length;
  d.state = 'waiting';
  d.from = when;
  d.rate = FLIP_MS * (0.9 + Math.random() * 0.2);
}

/**
 * Draw one leaf and not the other.
 *
 * The leaf that is not in play is hidden rather than parked edge-on: a plane
 * turned exactly ninety degrees still rasterises as a hairline, and a
 * hairline with half a letter squashed into it reads as a stray dash across
 * the split.
 */
function draw(d: Drum, which: Drum['drawn']) {
  if (d.drawn === which) return;
  d.drawn = which;
  d.fall.style.visibility = which === 'fall' ? 'visible' : '';
  d.rise.style.visibility = which === 'rise' ? 'visible' : '';
}

function setLeaf(leaf: HTMLElement, degrees: number, shade: number) {
  leaf.style.transform = `rotateX(${degrees.toFixed(2)}deg)`;
  leaf.style.setProperty('--flap-shade', shade.toFixed(3));
}

/**
 * One flip, `p` of the way through.
 *
 * A flap falls rather than glides, so the angle accelerates. It swings through
 * 180 degrees: the first 90 are the upper leaf coming towards you, the second
 * are the same flap's back landing over the lower half. On the way down it
 * throws a shadow across the lower half, which is most of what makes a flat
 * card read as something falling out of the board.
 */
function paint(d: Drum, p: number) {
  const angle = 180 * Math.min(1, p) ** 1.35;
  if (angle < 90) {
    draw(d, 'fall');
    setLeaf(d.fall, -angle, (angle / 90) * 0.5);
  } else {
    draw(d, 'rise');
    setLeaf(d.rise, 180 - angle, ((180 - angle) / 90) * 0.45);
  }
  const cast = angle < 90 ? angle / 90 : (180 - angle) / 90;
  d.lower.style.setProperty('--flap-cast', (cast * 0.3).toFixed(3));
}

/** The last flap has landed on the one wanted, and bounces once off the stack. */
function settle(d: Drum, s: number) {
  const lift = 14 * Math.sin(Math.PI * s) * (1 - s);
  draw(d, 'rise');
  setLeaf(d.rise, lift, (lift / 90) * 0.45);
  d.lower.style.removeProperty('--flap-cast');
}

function rest(d: Drum) {
  d.state = 'idle';
  draw(d, null);
  d.lower.style.removeProperty('--flap-cast');
  print(d, UPPER, d.at);
  print(d, LOWER, d.at);
}

const Flap = ({ at }: { at: number }) => (
  <span className="sa-flap">
    <span className="sa-flap__half sa-flap__half--upper"><span className="sa-flap__glyph">{face(at)}</span></span>
    <span className="sa-flap__half sa-flap__half--lower"><span className="sa-flap__glyph">{face(at)}</span></span>
    <span className="sa-flap__half sa-flap__half--upper sa-flap__leaf"><span className="sa-flap__glyph" /></span>
    <span className="sa-flap__half sa-flap__half--lower sa-flap__leaf"><span className="sa-flap__glyph" /></span>
  </span>
);

interface SplitFlapBoardProps {
  /** What the board turns through, in order. Each is one line per row. */
  phrases: readonly (readonly string[])[];
}

const SplitFlapBoard = memo(function SplitFlapBoard({ phrases }: SplitFlapBoardProps) {
  const board = useRef<HTMLSpanElement>(null);
  /* Read once, the way the instruments read it. Asking for less motion
     stops the flaps, not the words: the board still changes phrase on the
     same schedule, each one simply appearing where the last one stood. The
     preference asks for no animation, not for no information. */
  const [still] = useState(prefersStill);

  const rows = Math.max(1, ...phrases.map((p) => p.length));
  const cols = Math.max(1, ...phrases.flatMap((p) => p.map((line) => line.length)));
  /* With motion it opens blank and boards the first phrase in front of you,
     which is the one moment that says what the thing is. Without, it opens on
     the first phrase. */
  const opening = useMemo(
    () => (still ? layout(phrases[0] ?? [], rows, cols) : new Array<number>(rows * cols).fill(BLANK)),
    [still, phrases, rows, cols],
  );
  /* Which phrase is up, kept across a remount so a development re-render
     does not send the board back to the start. -1 is blank. */
  const shown = useRef(still ? 0 : -1);

  useEffect(() => {
    const host = board.current;
    if (!host || phrases.length === 0) return;

    const drums = Array.from(host.querySelectorAll<HTMLElement>('.sa-flap'), (root): Drum => {
      const glyphs = Array.from(root.querySelectorAll<HTMLElement>('.sa-flap__glyph'));
      const halves = root.querySelectorAll<HTMLElement>('.sa-flap__half');
      /* Read the flap on show off the page rather than assuming it, so a
         remount picks up wherever the last mount left the board. */
      const at = Math.max(BLANK, DRUM.indexOf(glyphs[UPPER].textContent || ' '));
      return {
        glyphs, lower: halves[1], fall: halves[2], rise: halves[3], at,
        printed: [at, at, -1, -1],
        drawn: null,
        next: at, target: at, state: 'idle', from: 0, rate: FLIP_MS,
      };
    });

    let raf = 0;
    let timer = 0;
    let onScreen = !('IntersectionObserver' in window);

    const holdFor = (index: number) => (index === 0 ? HOME_HOLD_MS : HOLD_MS);

    /* The next phrase is only ever queued while somebody could see it
       arrive. Off screen or in a background tab the board finishes whatever
       it is doing and waits, and picks up again when it is looked at. */
    const queue = (wait: number) => {
      window.clearTimeout(timer);
      timer = 0;
      // One phrase has nowhere to turn to once it is up.
      if (!onScreen || document.hidden || (phrases.length < 2 && shown.current >= 0)) return;
      timer = window.setTimeout(() => {
        timer = 0;
        show((shown.current + 1) % phrases.length);
      }, wait);
    };

    const frame = (now: number) => {
      raf = 0;
      let moving = false;
      for (const d of drums) {
        if (d.state === 'waiting') {
          if (now < d.from) {
            moving = true;
            continue;
          }
          d.state = 'turning';
          turn(d);
        }
        if (d.state === 'turning') {
          /* Land every flip that is due. A late frame, or a tab brought back
             after a minute, catches up in one step rather than replaying. */
          while (now - d.from >= d.rate) {
            d.from += d.rate;
            d.at = d.next;
            if (d.at === d.target) {
              d.state = 'settling';
              print(d, UPPER, d.at);
              print(d, LOWER, d.at);
              print(d, RISE, d.at);
              break;
            }
            d.next = (d.at + 1) % DRUM.length;
          }
          if (d.state === 'turning') {
            turn(d);
            paint(d, (now - d.from) / d.rate);
          }
        }
        if (d.state === 'settling') {
          const s = (now - d.from) / SETTLE_MS;
          if (s >= 1) rest(d);
          else settle(d, s);
        }
        if (d.state !== 'idle') moving = true;
      }
      if (moving) raf = requestAnimationFrame(frame);
      else queue(holdFor(shown.current));
    };

    function show(index: number) {
      shown.current = index;
      const cells = layout(phrases[index], rows, cols);
      if (still) {
        for (const [k, d] of drums.entries()) {
          d.at = d.next = d.target = cells[k];
          print(d, UPPER, d.at);
          print(d, LOWER, d.at);
        }
        queue(holdFor(index));
        return;
      }
      const start = performance.now();
      drums.forEach((d, k) => {
        if (d.state !== 'idle') {
          d.target = cells[k];
          return;
        }
        const when = start
          + (k % cols) * STAGGER_MS
          + Math.floor(k / cols) * STAGGER_MS * 1.5
          + Math.random() * JITTER_MS;
        aim(d, cells[k], when);
      });
      if (!raf) raf = requestAnimationFrame(frame);
    }

    const wake = () => {
      if (raf || timer) return;
      queue(shown.current < 0 ? INTRO_MS : holdFor(shown.current));
    };
    const sleep = () => {
      window.clearTimeout(timer);
      timer = 0;
    };

    const observer = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => {
        // A quick scroll can batch several; the last is where it is now.
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) wake();
        else sleep();
      })
      : null;
    observer?.observe(host);

    const onVisibility = () => (document.hidden ? sleep() : wake());
    document.addEventListener('visibilitychange', onVisibility);
    if (!observer) wake();

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      /* Leave every drum at rest on the flap it was showing, which is where
         the next mount will read it from. */
      for (const d of drums) rest(d);
    };
  }, [still, phrases, rows, cols]);

  return (
    <span
      ref={board}
      className="sa-board"
      aria-hidden
      style={{ '--cols': cols } as CSSProperties}
    >
      <span className="sa-board__housing">
        {Array.from({ length: rows }, (_, r) => (
          <span key={r} className="sa-board__row">
            {Array.from({ length: cols }, (_, c) => (
              <Flap key={c} at={opening[r * cols + c]} />
            ))}
          </span>
        ))}
      </span>
    </span>
  );
});

export default SplitFlapBoard;
