# The advert server

Holders put images on their own seats. This is what stores them.

Two routes:

| | |
| --- | --- |
| `GET /banners` | the published wall, keyed by wallet |
| `POST /banner` | put an advert up, if you can prove the wallet is yours |

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

## Deploying

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

Nine cases over `verify.ts`: a genuine signature accepted, and a wrong
wallet, a captured signature reused for other artwork, a moved timestamp,
malformed base58 and SVG wearing a JPEG label each refused.

```bash
npm run dev:local   # Miniflare, with simulated KV and R2
npm run test:e2e    # in another shell
```

Eleven cases over the routes themselves, on real HTTP against real bindings:
a signed advert is accepted, stored, and comes back out of `GET /banners`;
a second publish inside the cooldown gets 429; forged, stale, unsigned and
SVG-disguised uploads are refused with the right status each time; CORS
echoes the allowed origin and the preflight is answered.

`wrangler.local.toml` exists only for that — its KV id is a placeholder that
never reaches Cloudflare.
