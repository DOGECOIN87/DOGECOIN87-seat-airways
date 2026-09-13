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

## The market feed is simulated

`src/lib/flightFeed.ts` is the **only** file that has to change to go live:

```ts
const live: FlightFeed = {
  subscribe(listener) {
    const id = setInterval(async () => listener(await fetchMarketTick()), 15_000);
    return () => clearInterval(id);
  },
  setMode() {},                   // a real aircraft does not take flight-sim input
  get mode() { return 'live' as const },
};
```

Hand that to `App` in place of `createSimulatedFeed()`. The horizon, the tapes,
the annunciators, the seat ladder and the radio log all keep working untouched.

The **Market cap** buttons under the view (Ground / Above the clouds / Space /
The moon) call the simulator's optional `jumpTo`, and hide themselves against a
feed that does not implement it.

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
