---
description: The reasoning behind the parts that are easy to break — the interface, the holder list, the market feed, the directory — and what to check before changing them.
---

# Engineering notes

The rest of this section says what things are and how to run them. This page says **why they are the way they are**, which is what you need before changing one.

## The interface

The page is a soft-UI panel with dark screens set into it — the way an aircraft's instrument panel is built. One light grey face, controls extruded out of it by light rather than outlined, displays recessed into it, and a single blue that lights whatever is live.

There are almost no borders in `src/index.css`. An edge is a change in shading: a white shadow up and to the left where the light is, a grey one down and to the right where it is not. Swap their positions to inset, and the same control reads as pressed. That is what lets the seat map explain itself without a legend: **an open seat is a socket pressed into the fuselage, a held seat is a tile extruded out of it, and your seat is the one wearing the blue.**

Two things about the palette to know before changing it:

* **There are two blues, and the difference is contrast.** The bright gradient `--g-accent` (`#00C9F1 → #0087EA`) lights anything that is a graphic — a meter, a lamp, a ring, an active edge. Anything carrying text gets `--g-accent-text` (`#007ACC → #005FB8`), which holds white at 4.5:1 where the bright one manages 3.7:1.
* **The greys are darker than a soft-UI kit's usually are.** Each was walked down until it carries small text at 4.5:1 against all four grounds it is ever set on — the page, a card, the wall card and the inside of a recess. If you change one, check it against the darkest of those, `--ui-sink`.

The values live in two places that must stay in step: the custom properties at the top of `src/index.css`, and the `ui` palette in `tailwind.config.js`.

Type and spacing are one ratio, φ. Every size is the 15px body size multiplied or divided by 1.618 (or its square root), and every measure of air is a rem stepped by the same number — the scale is `--t-xs` to `--t-5xl` and `--s-1` to `--s-6`.

The aircraft keeps its own materials. Inside the screens the livery is navy and the cabin lighting amber, because those are what the aeroplane is made of rather than interface colours — the `seat` palette in `tailwind.config.js`, kept apart from `ui` on purpose.

## Where the holder list comes from

The mint alone is famously not enough: Solana has no "list the holders of this token" call, and the closest, `getTokenLargestAccounts`, returns at most **20** accounts. The cabin seats **178** — twenty would fill the flight deck, first and a few business seats, and leave everything from row 4 back empty however many holders the token has.

So three sources are tried in order:

1. **`VITE_HOLDERS_URL`**, an indexer. Uncapped, and still the best answer.
2. **The Worker's `GET /holders`** — the default. It hands back the list the Worker has already read and cached to decide who may read whose card, with the supply alongside. The page and the Worker therefore agree about who is aboard by construction, the chain is read once a minute for the whole site, and no RPC key is ever shipped to a browser.
3. **The chain directly**: every account the token program owns for this mint, summed by owner. Uncapped too, but a scan — some public endpoints refuse it, in which case the twenty are still there underneath.

{% hint style="warning" %}
**Which token program is looked up first matters.** There are two, and a mint belongs to one. Asking the wrong one is not an error — it is an empty list, which reads as "this token has no holders", so the aircraft comes back empty and nothing says why. This code scanned only classic SPL Token until the first real mint it met turned out to be Token-2022.
{% endhint %}

Any list is then read in batches of a hundred, because `getMultipleAccounts` — which separates people from bonding curves — takes no more than that per call. Over the limit it errors, and an error reads as "the chain could not be asked".

## The market feed

`src/lib/marketFeed.ts` reads Jupiter's keyless API — no key, and it sends CORS headers, so the browser calls it directly. One request carries all three numbers the cabin reads: market cap, the five-minute move, and the holder count.

* **Rate.** The keyless tier allows 0.5 requests a second. The page polls every 20 seconds and, on a 429, backs off to 90 rather than retrying on schedule. The limit is per IP and this runs in each visitor's browser, so one visitor is nowhere near it.
* **Parsing by name.** Fields are found by name, at any depth, rather than by a fixed path. Jupiter serves this data from several endpoints that have each moved between versions and do not agree on nesting — only on what the fields are called. Anything missing leaves the previous reading in place: an aircraft that holds its last known altitude is better than one whose altimeter drops to zero because a key was renamed.

## The wall: adverts belong to wallets

**Adverts are stored against the wallet, not the seat.** The server has no idea what a seat is, and must not learn — that would be a second copy of the seat ladder, drifting from this one. The page resolves wallet to seat through the manifest it already holds, which is also why an advert follows its holder up and down the cabin, and comes down on its own when they drop off the manifest.

Every publish is signed over a challenge that names the wallet, **pins the exact image bytes**, and is stamped with the time. Pinning the image matters as much as naming the wallet: without it one captured signature would authorise any artwork for that wallet, forever.

## The directory: one seating chart, enforced on the server

* **One signature, not one per action.** A wallet popup for every message would be unusable, and worse, would teach people to approve things unread. The wallet signs one plain-text line to open a session and gets a bearer token good for a day; the server keeps only its hash.
* **Transparent looking aft, opaque looking forward.** Names and roles belong to everyone; contact details reach your own section and every cabin behind it; a conversation is readable by its two wallets and by any section seated ahead of both. Writing goes exactly as far as reading, and nothing carries forward.
* **The hold is not a cabin.** A wallet without a seat is on no roster. Its cards are not served and its conversations are never read out of the database only to be withheld — the queries ask for the seats, and never for the rest.
* **The seating is shared, not copied.** The ladder lives in `src/lib/seating.ts`, with no browser and no Cloudflare in it, and the page and the Worker import the same file. With no mint configured the Worker fails closed, and `GET /health` says so (`sections: false`, and `seated` out of `cabin`).

## The views

**Turning your head is seat-specific.** From 8A the window is one turn to the left and fills the frame; from 8F it is the far side of the cabin. Rather than special-casing seat letters, `lookFrom` in `src/content/cabin.ts` models the row as it physically is — port window, left bank, aisle, right bank, starboard window — and reads it outward from wherever you sit.

**One roll of occupancy.** The seat map, the passengers ahead of you, the people beside you and the lit windows outside all read the same seeded set, so a window lit from outside is a row somebody has genuinely booked.

## After a token change

The page detects a mint change on start-up and clears the old token's browser-only adverts and directory session. To force that while testing, run this in the production page's console and reload:

```js
['seat-airlines.banners.v1', 'seat-airlines.directory.session.v1', 'seat-airlines.active-mint.v1']
  .forEach((key) => localStorage.removeItem(key));
location.reload();
```

Avoid a blanket `localStorage.clear()` in production — it removes unrelated visitor state too.

## Performance

* **One animation loop.** Every view animates off refs through a single `requestAnimationFrame` loop; after mount, no React render is involved in the instruments at all.
* **Polling is polite.** It pauses in hidden tabs, aborts superseded requests, and reads fresh when the page is visible again.
* **The 3D scene adapts.** Cloud instances upload at 30 Hz, the pixel ratio follows measured render time, low-power devices ask for the low-power GPU, and the distant terrain's hex-tiling costs three texture reads only where it is used.
* **Vendor chunks.** React and three.js are split into stable chunks, so a routine change does not invalidate both in the browser cache.

## Accessibility

* The drawn and rendered views are `aria-hidden`; every value they show is also published as text in the annunciator strip and the readouts beneath them.
* Seats are real buttons with pressed state, the radio log is a polite live region, and zoom and pan are fully keyboard-driven.
* **Reduced motion calms the flight rather than parking it.** Attitude values snap instead of easing, the aircraft stops swaying and banking, and turns go flat — but the ground keeps going past, because an aircraft that is not moving is not an aircraft.
