---
description: The split-flap board at the top of the page — how it works and how to change what it says.
---

# The departure board

![](../.gitbook/assets/departure-board.png)

The headline at the top of the page is a split-flap board, drawn after the mechanical ones in terminals: a split across the middle of every flap and a hinge pin at each end of it, painted in the site's own colours — navy flaps from the ground the hero sits on, white letters, and the site's blue along the top edge. Every character is a drum of flaps. Changing a word, each letter falls through the last few flaps before the one it wants, so you see the letters count up to it, and the columns land at different moments in a wave from left to right.

## What it says

It turns through these, in order, and then starts again:

| # | Top row | Bottom row |
| --- | --- | --- |
| 1 | HOLD MORE | FLY HIGHER |
| 2 | TAKE A | SEAT |
| 3 | NETWORK | |
| 4 | BUILD | |
| 5 | RELAX | |
| 6 | ADVERTISE | |
| 7 | MOVE UP | |
| 8 | NOW | BOARDING |
| 9 | TO THE | MOON |

## Changing the words

The phrases are `BOARD_PHRASES` in `src/content/cabin.ts`, with the rest of the site's copy:

```ts
export const BOARD_PHRASES: readonly (readonly string[])[] = [
  ['HOLD MORE', 'FLY HIGHER'],
  ['TAKE A', 'SEAT'],
  ['NETWORK'],
  // …
];
```

* **Each entry is the board's rows, top to bottom** — one line or two.
* **The board is as wide as the longest line in the list**, so one long line shrinks every flap. Keep lines to **10 characters** or fewer to keep the letters big on a phone.
* **The drums carry** A–Z, 0–9 and `+ - / : ( ) % . , ! ? & $ '`. Lower case is shown in capitals, and any other character comes up blank.
* **The first entry is the home phrase.** The board boards it first and holds it twice as long.

The heading screen readers hear stays _Hold more. Fly higher._ whatever the board shows. It is in `src/App.tsx`, if the home phrase ever changes.

## How it behaves

| | |
| --- | --- |
| **On load** | It opens blank and boards the home phrase a moment after it comes into view. |
| **Each flap** | About 120 ms — slow enough to see it fold, with a shadow thrown on the half below — and each drum runs a little faster or slower than its neighbours, like real mechanisms. |
| **Each letter** | Falls through the last 4 to 9 flaps before its target, a different number for each, so a whole word lands in about a second and a half. Columns start a beat apart, left to right. |
| **Between phrases** | 4 seconds once the last flap has landed — 8 for the home phrase. |
| **Off screen, or in a background tab** | It finishes the turn in progress and waits. Nothing new is queued until it can be seen. |
| **Reduced motion** | The words change on the same schedule, but the flaps do not turn — each phrase simply appears. On Android this is the **Remove animations** setting. |

The timings are constants at the top of `src/components/SplitFlapBoard.tsx`: `FLIP_MS`, `FLIPS_MIN` and `FLIPS_MAX`, `HOLD_MS`, `HOME_HOLD_MS`, `STAGGER_MS`, `JITTER_MS`, `SETTLE_MS` and `INTRO_MS`. The order of the flaps on each drum is `DRUM`.

## How it is built

* **One animation loop.** Like the instruments, the board animates off DOM refs through a single `requestAnimationFrame` loop that runs only while flaps are turning — no React render per flap, and no loop at all between phrases.
* **Sized from its own width.** Every measure — the flap, its letter, its hinge pins — comes from the board's width through CSS container units, so it scales as one object from a 320px phone to a wide screen, with no breakpoints.
* **The typeface** is PT Sans Narrow Bold, loaded with the site's other fonts in `index.html`.
* **The styles** are the _departure board_ block in `src/index.css`, and the colours are tokens at the top of it, on `.sa-board` — `--board-housing`, `--flap-upper`, `--flap-lower`, `--flap-ink` and the rest — so the palette changes in one place.
* **Accessibility.** The board is hidden from assistive technology, because a heading that read out half a letter mid-turn would be worse than none; the heading's own text carries the words.
