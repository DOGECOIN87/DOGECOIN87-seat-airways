---
description: A static page, one Worker, and a seating chart both of them share.
---

# How it is built

Seat Airlines is two deployments:

| Part | What it is | Where it runs |
| --- | --- | --- |
| **The page** | A static single-page app: React 19, Vite, Tailwind CSS 4 and three.js | GitHub Pages, at `seat-airlines.space` |
| **The Worker** | One Cloudflare Worker, `seat-airlines-banners` | Cloudflare, with KV, R2 and D1 bound to it |

The page reads three outside services:

| Service | For | From |
| --- | --- | --- |
| Jupiter token API | Market cap, the five-minute move, the holder count | The browser, every 20 s |
| Solana | Balances and the holder list | The Worker, which holds the RPC endpoint as a secret |
| Open-Meteo | Weather outside the aircraft | The browser |

## What the Worker does

* **The wall** — stores adverts against the wallet that signed them: records in KV, artwork in R2 (or in KV when R2 has no public URL).
* **The holder list** — reads every holder from the chain, caches it for a minute, and serves it to every visitor, so no RPC key is ever shipped to a browser.
* **The cabin directory** — cards, introductions, rooms and the PA, in a D1 database, behind a signed-in session.
* **The flight controls** — the crew's shared manual controls, which every open page reads.

## One seating chart, shared

Who sits where decides who may read whose contact details, so it is a boundary rather than a layout — and a boundary enforced only in the browser is not one. The seat ladder therefore lives in `src/lib/seating.ts`, plain TypeScript with no browser and no Cloudflare in it, and **the page and the Worker import the same file**. So do `src/lib/holderList.ts`, which reads the holder list, and `src/lib/manualControls.ts`, which clamps the flight controls. There is one copy of each rule, not two that could drift.

## Where things are

```
src/
├── App.tsx                  the page
├── index.css                the design system and the animations
├── content/cabin.ts         seat layout, cabin copy, chatter, the board's phrases
├── lib/
│   ├── flightModel.ts       pitch, bank, bands, lamps — pure functions
│   ├── marketFeed.ts        the market feed (Jupiter)
│   ├── seating.ts           the seat ladder, shared with the Worker
│   ├── holderList.ts        reading every holder, shared with the Worker
│   ├── banners.ts           the advert wall and the house adverts
│   ├── networkingApi.ts     the cabin directory, over the wire
│   ├── sky.ts               the sun and the weather
│   └── token.ts             the contract address
├── three/                   the 3D world, airframe and cabin
└── components/              the views, the wall, check-in, the hub, the board
worker/
├── src/index.ts             every route
├── src/verify.ts            signature and image checks
├── src/networking.ts        directory rules and limits
└── migrations/              the D1 schema
docs/                        this documentation
```

## Performance, briefly

* Every view animates off refs through **one** `requestAnimationFrame` loop, so the instruments never re-render React at 60 fps.
* Polling pauses in background tabs and aborts superseded requests.
* The 3D scene adapts its pixel ratio to measured render time, and React and three.js ship as separate cached chunks.
* `prefers-reduced-motion` drops the animation loop: values snap, and the view is repainted on a slow cadence.

The repository's own [README](https://github.com/DOGECOIN87/Seat-Airlines#readme) and [`worker/README.md`](https://github.com/DOGECOIN87/Seat-Airlines/blob/main/worker/README.md) go deeper on every decision here.
