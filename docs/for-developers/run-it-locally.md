---
description: The page in one command, what works on localhost, and testing the Worker without a Cloudflare account.
---

# Run it locally

## The page

You need Node.js 18 or later (CI builds with Node 22).

```bash
npm install
npm run dev        # http://localhost:3000
```

| Command | Does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run typecheck` | TypeScript, no output |
| `npm run build` | Type-check, then bundle to `dist/` |
| `npm run preview` | Serve the built `dist/` on port 3000 |
| `npm test` | The test suites: the wall, the directory rules, the holder list, balances, and the flight controls |

## What works on localhost

With no configuration the page flies the committed token and talks to the production Worker. That Worker only answers requests from `seat-airlines.space`, so on `localhost`:

| Works | Does not |
| --- | --- |
| The market flies the aircraft — Jupiter answers any origin | The holder list and balances are refused, so **the cabin is empty** and check-in reads **unread** |
| The sky, the views and the departure board | The wall's adverts (they hang only on held seats), publishing, and the directory |

To see a full cabin locally, point the page at a Worker **you** deploy whose `ALLOWED_ORIGINS` includes `http://localhost:3000`:

```bash
VITE_BANNERS_API=https://<your-worker>.workers.dev npm run dev
```

## Testing the Worker

The Worker's own test setup needs no Cloudflare account. It runs on Miniflare with simulated KV and D1, a test mint, and a holder list that the end-to-end suite serves itself on port 8788 — so it is for exercising the routes, not for flying the real aircraft.

```bash
cd worker
npm install
npm test                 # signature and image checks, with a real ed25519 keypair

# Apply the directory schema to the local database once, with the Worker stopped:
npx wrangler d1 migrations apply seat-airlines-directory --local --config wrangler.local.toml

npm run dev:local        # http://127.0.0.1:8787
npm run test:e2e         # in another shell: the full route suite
```

`npm run dev:local:r2` runs the same Worker with the R2 storage path instead of KV. Run `rm -rf .wrangler/state` between the two modes, with the Worker stopped, because they share simulated state.

See [`worker/README.md`](https://github.com/DOGECOIN87/Seat-Airlines/blob/main/worker/README.md) for what each test case proves.
