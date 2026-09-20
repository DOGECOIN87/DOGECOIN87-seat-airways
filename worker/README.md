# The advert server, and the cabin directory

Holders put images on their own seats, publish a card, and introduce
themselves to the section in front of them. This is what stores all of it.

The wall:

| | |
| --- | --- |
| `GET /banners` | the published wall, keyed by wallet |
| `POST /banner` | put an advert up, if you can prove the wallet is yours |
| `GET /health` | a no-store liveness response for monitoring and smoke tests |
| `GET /images/…` | the artwork, when it is kept in KV rather than R2 |

The directory, every route of which needs a session:

| | |
| --- | --- |
| `POST /session` | prove the wallet, get a bearer token good for a day |
| `DELETE /session` | hand it back |
| `GET /directory` | every published card |
| `PUT /profile` | publish or amend your own |
| `GET /messages` | your introductions, both directions |
| `POST /messages` | send one |

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

## The cabin directory

Cards and introductions used to live in `localStorage`, which made both of
them fictions. A card existed only in the browser that typed it, so nobody in
your section could ever read one; and a sent introduction was written to the
**sender's** own storage and delivered to nobody. The interface said "queued
in this browser", which was true and was the whole problem.

They are rows in D1 now — `migrations/0001_networking.sql` is the schema:
one card per wallet, messages indexed both by recipient and by sender, plus
the sessions table and the spent sign-in signatures.

### Signing in, rather than signing everything

The wall signs every publish, because a publish is rare and pins one exact
image. The directory is the opposite shape: a holder saves a card, reads the
roster, sends a note, reads the replies. A wallet popup per action would be
unusable, and people asked to sign constantly stop reading what they sign.

So the wallet signs once:

```
SEAT AIRLINES
Sign in to the cabin directory.

This lets you publish your card, read your section, and send and
receive introductions for one day. It authorises no transaction.

wallet: 7xKX…9fQr
issued: 2026-09-20T00:31:00.000Z
```

What comes back is a bearer token good for 24 hours. Three things about how
it is handled are deliberate:

1. **Only a SHA-256 of the token is stored.** A dump of the sessions table is
   not a way into anybody's account.
2. **The sign-in signature is spent on use.** It stays valid for five minutes,
   so without a record of the ones already redeemed a captured signature is a
   second token inside that window. An advert can afford that risk; a
   credential cannot.
3. **Every directory response is `no-store`.** Each one is either a credential
   or somebody's private correspondence.

### What it still does not know

Which seat anybody is in — for the same reason the wall does not, and the
[section above](#what-it-deliberately-does-not-know) has the argument. The
page reads the ladder; this service answers "is this really the wallet it
claims to be".

So the lines it draws are the two it can actually hold:

| | |
| --- | --- |
| A card, contact details and all | readable by holders, because nothing here is readable without a session |
| An introduction | readable only by the two wallets named on it, whoever else is signed in |

The first is the whole reason `POST /session` checks the token: a session is
opened only by a wallet that has proved its key **and** holds the token, so
the cards inside — the emails, the links, the lot — are never handed to
somebody who has not bought their way into the cabin. It is the same check
the wall makes before storing an advert, and it is enforced in the one place
that can enforce it rather than being implied by the interface.

That check stands aside when it cannot reach the RPC to make it, and when no
`RPC_URL`/`TOKEN_MINT` is configured there is nothing to check against at all
— see `holdsToken` for why an unanswered question is treated as "do not
know". A deployment that wants the directory to be a holders' room needs
those two set, exactly as the wall does.

The finer perks — contacts surfaced to your own section, introductions
between First Class members — remain the page's reading of the manifest it
already holds: an interface affordance, not a boundary, because anything
stronger would mean a second copy of the seat ladder here, drifting from the
page's copy from the day it was written.

Abuse is bounded by what does not need the ladder: 20 introductions per wallet
per hour, 1,000 characters each, and contact links that must be `http(s)`.

## Serving the artwork

A record is keyed by the wallet that published it, but the **artwork is
keyed by its own hash**. Keyed by wallet, replacing an advert overwrote it in
place and its URL never changed, which made a successful publish look like a
failure: the holder putting up their second advert was handed the URL their
browser had already cached, and the seat kept showing the old picture.

Addressing the bytes by their content settles that where it belongs. New
artwork is a new URL because it is a new image; the same artwork is the same
URL, so re-uploading costs nothing. It is also what lets the read path answer
`immutable` with a straight face — that URL cannot ever mean different bytes,
so a browser never has to ask about it again.

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

# And the database behind the directory.
npx wrangler d1 create seat-airlines-directory
npx wrangler d1 migrations apply seat-airlines-directory --remote
```

The `[[d1_databases]]` block in `wrangler.toml` is commented out, with the id
left blank. Uncomment it with the id `d1 create` printed, and redeploy.

It ships that way rather than with a placeholder id because a binding naming a
database that does not exist fails the deploy outright, and that file is what
CI deploys on every push. Unbound, the wall works exactly as before and the
directory routes answer `503` saying there is no directory here — so the
Worker is deployable before anybody has created one, and `GET /health` reports
which of the two states it is in.

**The migration is not run by the deploy.** `wrangler deploy` ships code, not
schema, so a new migration is applied by hand (or by a step you add to the
workflow) before the code that depends on it goes out.

Put the KV id from that first command into `wrangler.toml`, then give the R2
bucket public access — either an `r2.dev` URL or, better, a custom domain —
and set `PUBLIC_IMAGE_BASE` to it. Images are read constantly and written
rare, so serving them straight from R2 keeps the Worker off that path.

The Worker also keeps a short warm-isolate snapshot of the wall index, while
uploads update that index directly instead of scanning the KV namespace.

Skipping `PUBLIC_IMAGE_BASE` is a supported state, not a broken one: without
it the Worker keeps the artwork in KV and serves it from `/images/<key>`, and
the site behaves identically. A bound bucket with no public URL, though, is
the one combination worth avoiding — it pays R2's write path for none of its
read benefit — so the Worker ignores the binding until the URL is set.

For production traffic, enabling public R2 access (or an R2 custom domain) and
setting `PUBLIC_IMAGE_BASE` is the highest-impact backend performance setting:
image bytes then bypass Worker execution and KV reads entirely.

Then, before going live:

```bash
# Lock CORS to the site's own origin. Left empty the Worker echoes whatever
# origin asks, which is fine locally and careless in production.
#   ALLOWED_ORIGINS = "https://your-domain"   in wrangler.toml

# The RPC is a secret, not a var — paid endpoints carry the key in the URL.
npx wrangler secret put RPC_URL

npx wrangler deploy

# After deployment, verify the Worker is serving requests. Replace the host
# with the workers.dev/custom-domain URL printed by Wrangler.
curl -fsS https://seat-airlines-banners.<your-subdomain>.workers.dev/health
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
| `env.DIRECTORY` (D1) | Postgres, Supabase, any SQLite — the schema is plain SQL |
| `crypto.subtle` Ed25519 | Node 18+ has the same API; `@noble/ed25519` otherwise |

The verification logic — base58, the challenge text, the magic-byte sniff —
is plain TypeScript with no runtime dependencies and moves unchanged.

## Testing it before it goes anywhere

Two layers, neither of which needs a Cloudflare account.

```bash
npm test          # the checks, in isolation, with a real ed25519 keypair
```

`networking.ts` is exercised from the site's own suite (`npm test` in the
repository root) rather than from here, because the case worth having most is
one neither side can make alone: the page and the Worker each write out the
text the wallet signs, and if those two strings differ by a character then
every sign-in fails with "that signature does not match the wallet" — a
message that points at the wallet rather than at the typo.

Twelve cases over `verify.ts`: a genuine signature accepted, and a wrong
wallet, a captured signature reused for other artwork, a moved timestamp,
malformed base58 and SVG wearing a JPEG label each refused — plus the record
reader, which must skip a malformed `banner:` value rather than throw. One
that threw once took the whole wall down with Cloudflare error 1101.

```bash
npm run dev:local   # Miniflare, with simulated KV and D1
npm run test:e2e    # in another shell
```

The local database starts empty, so apply the schema to it once — with the
Worker stopped — or every directory case fails on a missing table:

```bash
npx wrangler d1 migrations apply seat-airlines-directory --local --config wrangler.local.toml
```

The directory cases are the ones that could not exist before: a wallet signs
in, publishes a card, and sends an introduction — and a **second** wallet,
with its own session, reads both back. That is the whole point of the change,
and it is not something `localStorage` could ever have passed. The card is
then read again through a fresh session, which proves it outlives the browser
that wrote it. Alongside them: a replayed sign-in mints no second token, a
forged and a stale one are refused, the roster and an inbox are both closed
without a session, an invented token is not one, a `javascript:` contact link
is refused, a message to yourself is refused, signing out revokes the token,
and the preflight allows `PUT` and `authorization`.

Over the wall itself, on real HTTP against real bindings: a signed advert is accepted, stored, and comes back out of
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
