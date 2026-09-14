# The advert server

Holders put images on their own seats. This is what stores them.

Two routes, and one that only exists in KV mode:

| | |
| --- | --- |
| `GET /banners` | the published wall, keyed by wallet |
| `POST /banner` | put an advert up, if you can prove the wallet is yours |
| `GET /images/…` | the artwork, when it is kept in KV rather than R2 |

## What it deliberately does not know

It has no idea which seat anybody is in, and it must not learn.

Working that out means the whole seat ladder — ranking, cutoffs, tie-breaks,
the cargo-hold rule — and a second copy of that logic would drift from the
page's copy the first time either of them changed. The page already computes
the ladder, because computing the ladder is what the page *is*.

So adverts are stored against the **wallet** that published them, and the page
decides where they hang. That leaves this service one question to answer: is
this request really from the wallet it names?

It falls out better as product, too. Get out-held and reseated from 3A to 7C
and your advert moves with you, because it was never attached to 3A. Drop off
the manifest entirely and it comes down on its own, with nothing to clean up.

## How a write is authorised

The client asks the holder's wallet to sign a short, readable challenge:

```
SEAT AIRLINES
Publish this advert on my seat.

wallet: 7xKX…9fQr
image:  sha256:3f9a…
issued: 2026-09-14T00:31:00.000Z
```

The server then checks, in this order — cheapest first, so a flood costs the
attacker more than it costs us:

1. **`issued` is within five minutes.** Bounds replay.
2. **The image decodes, is under 512 KB, and is really a JPEG or PNG** — read
   from the magic bytes, not from what the uploader claimed. SVG is refused
   specifically: an SVG is a document that can carry script, and serving one
   from a domain the site trusts would hand over every visitor's session.
3. **The signature verifies** against the wallet, over that exact text. A
   Solana address *is* an ed25519 public key, so this is a plain
   `crypto.subtle.verify` with no dependency.
4. **The wallet is not in cooldown** (one publish a minute).
5. **The wallet holds the token**, if `TOKEN_MINT` and `RPC_URL` are set.
   Storage is not free.

Pinning the image hash inside the signed text matters as much as naming the
wallet. Without it, one captured signature would authorise *any* artwork for
that wallet, forever — the holder signs "it's me" and whoever caught the
signature picks the picture. With it, a signature authorises exactly one
image.

## Serving the artwork

An advert is keyed by the wallet that published it, so replacing one
overwrites it in place and its URL never changes. Left there, that makes a
successful publish look like a failure: the bytes are served with
`max-age=300`, so a holder putting up their second advert is handed a URL
their browser cached five minutes ago and the seat keeps showing the old
picture. The URL therefore carries `?v=<the moment it was stored>` — same
advert, same URL; new advert, a URL no cache has seen.

The `/images/` route answers with `access-control-allow-origin: *`, which the
API routes deliberately do not. The adverts on the cabin's seat-back screens
are WebGL textures rather than `<img>` tags, and three.js asks for every
texture with `crossOrigin="anonymous"`; without the header the browser
discards the bytes and the screen silently falls back to the airline's mark.
These are public bytes served with no credentials, sniffed from the magic
bytes at upload and sent with `nosniff`, so `*` is simply what is true. The
allowlist still guards everything that writes.

## Deploying

CI does this on every push that touches `worker/`, but only once the
repository has a `CLOUDFLARE_API_TOKEN` secret — without one the workflow
runs the tests, writes what is missing to the job summary and stops, so a
green tick does **not** by itself mean the Worker was deployed. Check the
Deploy step in the run, not the run's conclusion.

By hand:

```bash
cd worker
npm install

# One KV namespace for the records, one R2 bucket for the artwork.
npx wrangler kv namespace create BANNERS
npx wrangler r2 bucket create seat-airlines-banners
```

Put the KV id from that first command into `wrangler.toml`, then give the R2
bucket public access — either an `r2.dev` URL or, better, a custom domain —
and set `PUBLIC_IMAGE_BASE` to it. Images are read constantly and written
rarely, so serving them straight from R2 keeps the Worker off that path.

Skipping `PUBLIC_IMAGE_BASE` is a supported state, not a broken one: without
it the Worker keeps the artwork in KV and serves it from `/images/<key>`, and
the site behaves identically. A bound bucket with no public URL, though, is
the one combination worth avoiding — it pays R2's write path for none of its
read benefit — so the Worker ignores the binding until the URL is set.

Then, before going live:

```bash
# Lock CORS to the site's own origin. Left empty the Worker echoes whatever
# origin asks, which is fine locally and careless in production.
#   ALLOWED_ORIGINS = "https://your-domain"   in wrangler.toml

# The RPC is a secret, not a var — paid endpoints carry the key in the URL.
npx wrangler secret put RPC_URL

npx wrangler deploy
```

Finally point the frontend at it:

```
VITE_BANNERS_API=https://seat-airlines-banners.<your-subdomain>.workers.dev
```

## Hosting it somewhere else

The whole thing is one standard `fetch(request, env)` handler. Only three
things are Cloudflare-shaped, and each has an obvious counterpart elsewhere:

| Here | Elsewhere |
| --- | --- |
| `env.IMAGES` (R2) | S3, Supabase Storage, Vercel Blob |
| `env.BANNERS` (KV) | Redis, Postgres, DynamoDB |
| `crypto.subtle` Ed25519 | Node 18+ has the same API; `@noble/ed25519` otherwise |

The verification logic — base58, the challenge text, the magic-byte sniff —
is plain TypeScript with no runtime dependencies and moves unchanged.

## Testing it before it goes anywhere

Two layers, neither of which needs a Cloudflare account.

```bash
npm test          # the checks, in isolation, with a real ed25519 keypair
```

Twelve cases over `verify.ts`: a genuine signature accepted, and a wrong
wallet, a captured signature reused for other artwork, a moved timestamp,
malformed base58 and SVG wearing a JPEG label each refused — plus the record
reader, which must skip a malformed `banner:` value rather than throw. One
that threw once took the whole wall down with Cloudflare error 1101.

```bash
npm run dev:local   # Miniflare, with simulated KV
npm run test:e2e    # in another shell
```

Fourteen cases over the routes themselves, on real HTTP against real
bindings: a signed advert is accepted, stored, and comes back out of
`GET /banners`; the artwork is fetched back from the URL it was given and
checked byte for byte; that URL is readable as a WebGL texture and carries a
version; a second publish inside the cooldown gets 429; forged, stale,
unsigned and SVG-disguised uploads are refused with the right status each
time; CORS echoes the allowed origin and the preflight is answered.

Run it again in the other storage mode:

```bash
npm run dev:local:r2
npm run test:e2e
```

The Worker picks its backend from whether an R2 binding and
`PUBLIC_IMAGE_BASE` are *both* present, which means the branch that runs in
production is decided by config rather than by code — and a test suite that
only ever sees one config only ever tests half of `storeImage`. So there are
two local configs and the same fourteen cases run against each. The image case
is the one that differs: in KV mode the Worker serves the bytes, so it is
fetched and every header is checked; in R2 mode the URL points at a bucket
domain that is not this Worker, so the check is that the URL is well formed
and on the configured base. Fetching it would be testing Cloudflare's CDN.

`wrangler.local.toml` and `wrangler.local-r2.toml` exist only for that —
their KV id is a placeholder that never reaches Cloudflare, and the R2 one's
public base is a URL that deliberately does not resolve.

One trap worth knowing about: Miniflare keeps its simulated bindings in
`.wrangler/state`, and that state is shared between the two configs. Records
written in R2 mode point at the bucket, so replaying them in KV mode looks
like a 404 from the `/images/` route. It is not — it is yesterday's data.
`rm -rf .wrangler/state` between modes, with the Worker stopped.
