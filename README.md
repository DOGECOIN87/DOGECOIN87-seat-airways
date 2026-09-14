# SEAT AIRWAYS

**One plane. Everyone's in it.**

A flight simulator flown by a single number. The aircraft's attitude, altitude,
speed and cabin lighting all read one input — a token's market data — and
nothing else. Point it at a real feed and the whole thing becomes a live
instrument.

The premise is the seat ladder: **your bag is your seat, bigger bag better
seat**. Seats are finite, so a bigger bag can take yours — you get reseated, and
the whole cabin hears about it over the PA.

## What drives it

| Input | Becomes |
| ----- | ------- |
| 24h price change | Pitch attitude; its rate of change becomes bank |
| Market cap | Altitude, in feet, read straight off the number |
| Holder count | Souls on board |
| Attitude | Overhead annunciators, and the PA announcements they trigger |

### Altitude bands

Market cap *is* altitude, so the milestones are literal:

| Market cap | Where you are |
| ---------- | ------------- |
| under $1M | In the weather — terrain, cloud and haze below you |
| **$1M** | You break out on top of the cloud deck; the air above thins and deepens |
| **$10M** | The sky drains from the zenith down, the ground becomes a curved limb, and the stars arrive |
| **$50M** | The lunar surface under a grazing sun, with Earthrise off the port side |

Thresholds live in `src/lib/flightModel.ts` (`BAND_CLOUDS`, `BAND_SPACE`,
`BAND_MOON`).

**Leaving the atmosphere is not the scattering coefficients going to zero.**
The Preetham model divides by them, so scaling them down does not thin the air
— it blows the whole dome out to white. The air is taken away instead by
dimming the dome's own output from the zenith downward (`skyFade` in
`src/three/WorldScene.ts`), which leaves the bright blue band on the limb that
is the whole photograph of the edge of space. Above the atmosphere the flat
ground plate is swapped for a sphere whose radius shrinks as you climb, so the
horizon bends further the higher the market cap goes.

## Views

The page opens **outside, on the whole aeroplane** — the one frame that states
the premise without a caption. From there you step inside, turn your head, walk
the aircraft, or drop into the hold.

| Camera | What it is |
| ------ | ---------- |
| Outside | The whole aircraft, in its own livery, over the ground it is actually flying |
| Seat · forward | The row ahead, its passengers, and your seat-back screen |
| Seat · look left / right | Your head turned — content depends on your seat |
| Flight deck | The cockpit: overhead panel, MCP, PFD and navigation display |
| Cargo hold | Below the floor, where everyone under the cutoff rides |

Zooming out past 1× from any interior view returns you outside.

**Turning your head is seat-specific**, which is the point of the ladder. From
8A the window is one turn to the left and fills the frame. From 8F that same
window is the far side of the cabin — two seats, the aisle, three more seats,
and a porthole the size of a coin. From 8C you look past 8B's shoulder to get
any of it.

Rather than special-case seat letters, `lookFrom` in `src/content/cabin.ts`
models the row as it physically is — port window, left bank, aisle, right bank,
starboard window — and reads it outward from wherever you are sitting. That is
what keeps 8C and 8D correct: they are the two seats either side of the aisle,
and each has three seats and a window one way, one seat and a window the other.

Every view zooms and pans: wheel, pinch, the buttons, or `+` / `-` / `0` and the
arrow keys.

### One roll of occupancy

The seat map, the passengers in the rows ahead, the people beside you when you
turn your head, and the lit windows on the exterior all read the same seeded
set. A window lit from outside is a row somebody has genuinely booked, and the
cabin is the same aircraft on every visit rather than reshuffling per render.
The forward cabin runs fuller than the back — the premise, made visible.

## The sky is live

**Time of day** comes from the visitor's own clock. Solar elevation is computed
properly for the date and latitude, so the cabin is dark at midnight in Sydney
and golden at 7pm in Lisbon, and the horizon burns in the right place either
way. No network needed — this always works.

**Weather** comes from [Open-Meteo](https://open-meteo.com/), which needs no key
and sends CORS headers. Coordinates are derived from the browser's own IANA
timezone rather than asking for a location permission: close enough for a sky,
and it costs the visitor nothing. If the request fails, is blocked, or the zone
is unknown, a modelled sky stands in — the page never waits on it, and the
readout says which is in use.

All of this is `src/lib/sky.ts`.

## The wall

Every seat on the map is a square, so every held seat is a billboard: its
holder can put a 1:1 image on it, and the whole aircraft reads as a mosaic with
the best placements at the front. The image is centre-cropped and re-encoded on
the way in, so nothing anybody uploads can stretch the grid.

Seats are drawn at a size that follows their class — the flight deck largest,
first next, the rest at par — because rank 1 and rank 40 are not the same
placement and a map that draws them identically argues that they are.

Held seats with nothing on them yet carry Seat Airways' own campaigns, the way
unsold inventory does on a real aircraft (`houseAdverts` in
`src/lib/banners.ts`). They are drawn rather than fetched, so they cost no
request, and each says in its alt text that the seat's holder is who replaces
it.

A deployment that wants everyone to see the same wall points `VITE_BANNERS_URL`
at a JSON document of `{ "<seat>": { image, alt, href } }`; that set is
read-only and beats anything a browser has put up locally.

## The interface

The page is a soft-UI panel with dark screens set into it — the same way the
instrument panel of an aircraft is built. One light grey face, controls
extruded out of it by light rather than outlined, displays recessed into it,
and a single blue that lights whatever is live.

There are almost no borders in `src/index.css`. An edge is a change in
shading: a white shadow up and to the left where the light is, a grey one
down and to the right where it is not. Swap their positions to inset and the
same control reads as pressed. That is the entire vocabulary, and it is what
lets the seat map state itself without a legend — **an open seat is a socket
pressed into the fuselage, a held seat is a tile extruded out of it, and your
seat is the one wearing the blue.**

Two things about the palette are worth knowing before changing it.

**There are two blues, and the difference is contrast.** The bright gradient
(`--g-accent`, `#00C9F1 → #0087EA`) lights anything that is a graphic — a
meter, a lamp, a ring, an active edge. Anything carrying text gets
`--g-accent-text` (`#007ACC → #005FB8`), which holds white at 4.5:1 where the
bright one manages 3.7:1. Same family; one of them is simply legible.

**The greys are darker than a soft-UI kit's usually are.** A label grey chosen
for how it looks manages about 2:1 on its own ground. Every grey here was
walked down until it carries small text at 4.5:1 against all four grounds it
is ever set on — the page, a card, the wall band, and the inside of a recess.
If you change one, check it against the darkest of those (`--ui-sink`), not
against the page.

The values live in two places that must stay in step: the custom properties at
the top of `src/index.css`, and the `ui` palette in `tailwind.config.js`. They
are the same palette reached two different ways.

Type and spacing are one ratio, φ. Every size is the 15px body size multiplied
or divided by 1.618 (or by its square root, where a whole step is too big a
jump), and every measure of air is a rem stepped by the same number — so
nothing on the page is nearly-but-not-quite related to anything else. The
scale is `--t-xs` through `--t-5xl` and `--s-1` through `--s-6`.

The aircraft keeps its own materials. Inside the dark screens the livery is
still navy and the cabin lighting is still amber, because those are things the
aeroplane is made of rather than interface colours — the `seat` palette in
`tailwind.config.js`, kept deliberately separate from `ui`.

## Going live

Nothing in the page is hard-wired to a simulation. Three seams read the world,
each is configured by environment variable, and each states on screen which
mode it is in rather than dressing a simulation up as a live reading.

| Set | And | 
| --- | --- |
| `VITE_TOKEN_MINT` | the market feed reads Jupiter instead of the simulator |
| `VITE_RPC_URL` | balances and the seat ladder come off the chain |
| `VITE_HOLDERS_URL` | the manifest seats real holders |
| `VITE_BANNERS_API` | holders publish their own adverts, signed |

See `.env.example`, which documents all of them.

**`VITE_HOLDERS_URL` is not really optional.** Without it the code falls back
to the RPC's `getTokenLargestAccounts`, which returns at most 20 accounts —
and the cabin seats 40. Half the aeroplane would sit empty however many
holders the token has.

### The market feed

`src/lib/marketFeed.ts` reads Jupiter's free public API, which needs no key
and sends CORS headers. One request carries all three numbers the cabin reads:
market cap, the 24-hour move, and the holder count.

Its parser looks up fields by **name, at any depth**, rather than by a fixed
path. That is deliberate. Jupiter serves this data from several endpoints that
have each moved between versions, and they do not agree on nesting — only on
what the fields are called. A fixed path turns a shape change into a blank
altimeter on a production page. Every value is validated, and anything missing
leaves the previous reading in place: an aircraft that holds its last known
altitude is better than one whose altimeter drops to zero because a key was
renamed.

To use something else, set `VITE_MARKET_URL` to any JSON endpoint with those
numbers in it, under any of the names the parser knows.

### The advertising wall

`worker/` is the server that stores what holders upload — a Cloudflare Worker
with R2 for the artwork and KV for the records. It has its own
[README](worker/README.md) covering deployment and how a write is authorised.

The thing worth knowing here: **adverts are stored against the wallet, not the
seat.** The server has no idea what a seat is, and it must not learn — that
would mean a second copy of the seat ladder, drifting from this one. The page
resolves wallet to seat through the manifest it is already holding.

Which also means an advert follows its holder. Get out-held from 3A to 7C and
it moves with you; drop off the manifest and it comes down on its own.

Every write carries a wallet signature over a challenge that names the wallet,
**pins the exact image bytes**, and is stamped with the time. Pinning the image
matters as much as naming the wallet: without it one captured signature would
authorise any artwork for that wallet forever.

With no advert server configured, an upload stays in the uploader's browser and
the dialog says so.

## Deploying

The site is a static bundle, so GitHub Pages serves it directly.
`.github/workflows/deploy.yml` builds on every push to `main` and on manual
dispatch.

**Turn Pages on first.** Repository → Settings → Pages → Source: **GitHub
Actions**. Without that the workflow builds and then fails at the deploy step
with a permissions error that does not explain itself.

### Configuration

Build-time values come from repository **variables** (Settings → Secrets and
variables → Actions → Variables), not secrets — and that is deliberate.

Vite inlines every `VITE_`-prefixed value into the bundle it ships. All of
them are readable by anyone who opens the site and looks at the network tab.
Storing one as a secret hides it from the repository and from nobody else.

If your RPC endpoint carries a key, the only real protection is on the
provider's side: restrict that key to this domain. Helius, QuickNode and
Alchemy all support it.

### The domain

`public/CNAME` holds `seat-airlines.space`, and Vite copies it into `dist/`
verbatim. That file has to exist in the built output: the Actions deploy
publishes exactly what the artifact contains, so a custom domain set only in
the Pages settings UI gets forgotten on the next deploy.

DNS, at the registrar:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `dogecoin87.github.io.` |

All four A records, not one: they are GitHub's anycast front ends and dropping
three of them removes the redundancy rather than simplifying anything. The
AAAA records are optional but cost nothing and make the site reachable on
IPv6-only networks.

Then Settings → Pages → Custom domain → `seat-airlines.space`, wait for the
DNS check to pass, and tick **Enforce HTTPS**. The certificate is issued after
the domain resolves, so that tickbox stays greyed out until propagation
finishes — usually minutes, occasionally an hour.

### CORS, once the domain is live

The advert Worker's `ALLOWED_ORIGINS` must name the site, or uploads fail in
the browser with a CORS error and nothing useful in the response:

```toml
ALLOWED_ORIGINS = "https://seat-airlines.space,https://www.seat-airlines.space"
```

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # typecheck, then bundle to dist/
npm run preview
```

No API keys, no backend, no database. The production bundle is a single page.

## How it is put together

```
src/
├── main.tsx                  entry
├── App.tsx                   the page: hero, the wall, check-in
├── index.css                 Tailwind, the design system, the animations
├── content/cabin.ts          seat layout, zone copy, chatter, sight lines
├── lib/
│   ├── flightFeed.ts         the data seam, and the simulator behind it
│   ├── flightModel.ts        pure derivations: pitch, bank, bands, occupancy
│   ├── banners.ts            the advertising surface, and the house creative
│   ├── holdings.ts           balances and the holder list, over plain JSON-RPC
│   ├── manifest.ts           who is seated where, by rank
│   ├── useAttitude.ts        one rAF loop, shared by every view
│   ├── sky.ts                solar position, weather, palettes
│   └── passenger.ts          the name on the boarding pass
├── three/
│   ├── WorldScene.ts         the scene: sky, sun, stars, ground, limb, bands
│   ├── airframe.ts           the aeroplane, and its livery
│   ├── cabin.ts              the cabin interior, seat by seat
│   └── terrain.ts            farmland, the lunar surface, clouds, Earth
└── components/
    ├── ViewFrame.tsx         zoom, pan, and the camera chrome
    ├── ExteriorView.tsx      the whole aircraft
    ├── CabinView3D.tsx       a seat, looking around
    ├── FlightDeck.tsx        the cockpit
    ├── CargoHold.tsx         below the floor
    ├── SeatMap.tsx           the wall
    ├── AdvertDialog.tsx      putting an image on a seat you hold
    ├── BoardingPass.tsx      the screenshot
    ├── Annunciators.tsx      the overhead panel, as text
    └── RadioLog.tsx          the PA
```

### Performance

Every view animates off refs through **one** `requestAnimationFrame` loop: the
feed ticks a few times a second, the horizon moves at sixty, and after mount no
React render is involved in the instruments at all. The stateful parts — lamps,
the radio log — re-render at a human cadence instead.

Everything is vector SVG, so it stays sharp at 4× zoom and adds nothing to the
bundle. `prefers-reduced-motion` drops the rAF loop entirely: values snap rather than
ease, nothing drifts on its own, and the scene is repainted on a slow,
deliberate cadence instead of at sixty. The preference asks for no *animation*,
not for no *information* — an instrument frozen on the reading it happened to
open with is not accessible, it is wrong.

### Accessibility

The drawn views are `aria-hidden` — they are pictures of a cockpit, and reading
one out switch by switch would be worse than useless. Every value they show is
published as text in the annunciator strip and the readout row beneath them.
Seats are real buttons with pressed state, the radio log is a polite live
region, and the zoom and pan controls are fully keyboard-driven.

## Licence

MIT — see [LICENSE](LICENSE).
