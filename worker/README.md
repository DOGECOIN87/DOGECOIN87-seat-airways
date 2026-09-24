# The advert server, and the cabin directory

Holders put images on their own seats, publish a card, and introduce
themselves to the section in front of them. This is what stores all of it.

The wall:

| | |
| --- | --- |
| `GET /banners` | the published wall, keyed by wallet |
| `POST /banner` | put an advert up, if you can prove the wallet is yours |
| `DELETE /banner` | take your own advert down, signed the same way |
| `GET /health` | a no-store liveness response for monitoring and smoke tests |
| `GET /holders` | who is aboard, and the supply — what the page seats from |
| `GET /holding` | one wallet's balance, so the page needs no RPC key of its own |
| `GET /images/…` | the artwork, when it is kept in KV rather than R2 |

The directory, every route of which needs a session:

| | |
| --- | --- |
| `POST /session` | prove the wallet, get a bearer token good for a day |
| `DELETE /session` | hand it back |
| `GET /directory` | every published card |
| `PUT /profile` | publish or amend your own |
| `GET /messages` | your introductions, your own cabin's room, and the PA |
| `GET /messages?rooms=all` | the same, plus every cabin behind you |
| `POST /messages` | to a wallet, to `section:<cabin>`, or to `announcement` |

## What the wall deliberately does not know

The wall has no idea which seat anybody is in, and it does not need to.

Working that out means the whole seat ladder — ranking, cutoffs, tie-breaks,
the cargo-hold rule — and a second copy of that logic would drift from the
page's copy the first time either of them changed. The page already computes
the ladder, because computing the ladder is what the page *is*.

So adverts are stored against the **wallet** that published them, and the page
decides where they hang. That leaves the wall one question to answer: is this
request really from the wallet it names?

The directory is the other half of this service and it could not stop there:
who may read whose contact details is a boundary, not a layout. See
*Knowing that without a second ladder* below for how it learned the seating
without keeping a second copy of it — and why the answer was never to
reimplement the ladder but to import the page's.

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
5. **The wallet holds the token**, if `TOKEN_MINT` is set. Storage is not
   free. (`RPC_URL` no longer has to be set for this to happen — see
   *Reading the chain* — which means this check is now on by default rather
   than quietly skipped on a deployment where nobody set the secret.)

Pinning the image hash inside the signed text matters as much as naming the
wallet. Without it, one captured signature would authorise *any* artwork for
that wallet, forever — the holder signs "it's me" and whoever caught the
signature picks the picture. With it, a signature authorises exactly one
image.

### Taking one down

`DELETE /banner` is signed the same way, over text that names the advert by
the key its artwork is stored under:

```
SEAT AIRLINES
Take the advert off my seat.

wallet: 7xKX…9fQr
advert: banners/3f9a….webp
issued: 2026-09-24T00:31:00.000Z
```

The same five-minute bound applies, and the record must still be that
advert: a takedown signed for one advert answers **409** once the holder has
put up another, so a replayed signature takes down nothing it was not made
for. There is no holder check and no cooldown — taking your own advert down
costs nobody storage, and a holder should be able to take one down and put
the next up at once. The artwork itself is left in place: it is addressed by
its bytes, and another wallet may be showing the same picture. An advert that
is already gone answers **404** with `"gone": true`, which the page reads as
done. The flag matters: a Worker deployed before this route answers the same
request with the fallthrough 404, and the page must not tell the holder their
advert is down while it is still on the wall — without the flag it says the
server cannot take adverts down yet.

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

### The cabin reads backwards

Getting in takes a session, and a session is opened only by a wallet that has
proved its key **and** holds the token — the same check the wall makes before
storing an advert. So the directory is a room for holders before any other
rule applies. That check stands aside when it cannot reach the RPC, and with
no `RPC_URL`/`TOKEN_MINT` there is nothing to check against at all; see
`holdsToken` on why an unanswered question is "do not know".

Inside the room, the aircraft decides the rest, and it is transparent looking
aft and opaque looking forward:

| | |
| --- | --- |
| A name and role | the roster, and the roster belongs to the whole cabin |
| Contact details | your own section and every seated cabin behind it, never one in front |
| A conversation | the two wallets on it, plus any section seated ahead of **both** |
| An introduction | wherever a card can be read: your own section and every seated one behind it |
| A cabin's room | heard the same way; **spoken in only by the people seated in it** |
| The PA | one line a day from the flight deck, heard by the whole aircraft |

Three consequences worth stating plainly, because they are the point rather
than side effects. The flight deck reads everything, and economy — with no
cabin behind it — reads nothing. A section cannot read its *peers*: First
Class sees every conversation in business and economy, and none of the other
First Class ones, because a chat with one end level with you is not behind
you.

And **the hold is not a cabin.** Every rule above is scoped to the manifest.
A wallet that did not get a seat is on no roster and has no name the page
could put to it, so its card is not served and its conversations are not
read out of the database in order to be withheld. Both queries name the
seats — `WHERE address IN (…)` and `WHERE sender IN (…) AND recipient IN
(…)`, a cabinful of bound parameters — rather than asking for everything and
filtering after. A row nobody can be shown is a row not worth fetching.

**Writing goes exactly as far as reading.** A card you can read is a card you
can answer, and nothing carries forward. So the flight deck can reach anybody
on the aircraft and nobody can reach the flight deck; the further forward a
holder sits, the fewer people can write to them at all.

That rule was narrower once — First Class to First Class and nothing else, on
the reasoning that an inbox is a claim on somebody's attention rather than a
view. The reasoning was sound; the rule drawn from it was not. It left the two
largest holders unable to write to a single person or be written to, and every
cabin behind First with a directory it could read and never use. "Never
forward" protects what that reasoning was actually protecting, and it is
already the line everything else here runs on.

Until recently the rule was the page's alone: the composer was hidden and this
route took the message anyway, so one fetch wrote into an inbox the sender
could not otherwise reach. Reads were enforced here; writes were on trust.
`canMessage` sits in the shared seating module with the other two rules now —
it *is* `canViewContact`, plus the check that a wallet is not an introduction
to itself — and `POST /messages` asks it before it writes a row.

### Rooms, and the one place posting is narrower than reading

A cabin is somewhere to talk as well as somewhere to sit. Each has a channel,
and a holder **hears their own and every one behind it** — the same line as a
contact card — but **speaks only in their own**. You can read what Economy is
saying, and write to anybody in Economy personally, and still not walk into
their conversation and talk. A section's room belongs to the people sitting in
it; a room the rows in front can post into is not that.

It is also what keeps moving up worth something in the other direction. Every
seat forward is one more room you can hear and one fewer voice in your own.

A channel is addressed the way a wallet is, as the `recipient` of a message,
because to a table of messages that is exactly what it is: somewhere a message
was sent. `section:first` needs no schema change, which matters here because
migrations are applied by hand rather than by the deploy — but that is a
convenience, not the argument. The argument is that the one place a room and a
person must never be confused is the one place they cannot be: base58 has no
colon in it, so no key anybody holds can ever spell a cabin.

Only cabins with somebody in them have rooms. An empty cabin's is necessarily
empty, so asking after it is a query whose answer is known in advance, and
drawing it would promise a conversation nobody could ever be in.

**A sign-in fetches one room: the one you are sitting in.** Which cabins a
seat *may* hear has not changed — that is still its own and every one behind
it — but the hub opens on your own cabin and puts the rest behind a button, so
reading all five on every sign-in meant up to 250 rows fetched to paint about
twenty. `?rooms=all` is what that button asks for, and it asks at the moment
somebody wants them. It is a request for what the seat may hear, not a way
around it: Business asking for everything still gets Business.

Worst case for a sign-in is now 5 queries and about 85 rows rather than 8 and
405. Every read is still bounded by a `LIMIT`; none of them has ever been "all
the messages".

### The PA

`announcement` is the last recipient, and the flight deck writes it: one line
a day that the whole aircraft hears, the hold included. Being aboard is the
only qualification for hearing it.

Rationed by the day rather than the hour on purpose — a thing said once a day
is listened to and a thing said twenty times is weather — and it was a promise
printed on the boarding pass long before there was anywhere to keep it:
*"You have the PA. One announcement a day. Use it well."*

So the seat is not just a placement any more. It is how far forward you can
see, how far back you can reach, and how many rooms you can hear — which is
the seat ladder's own argument applied to people instead of legroom.

### Knowing that without a second ladder

This service spent its life refusing to learn who sits where, and that refusal
was right for the wall: a second copy of the seating would drift from the
page's, and adverts never needed it.

The argument was always against a second *copy*, though, not against knowing.
A rule about who may read somebody's email address is a boundary, and a
boundary enforced only in the browser is not one — it is a suggestion the
network tab ignores. So the seating moved to `src/lib/seating.ts`, plain
TypeScript with no browser and no Cloudflare in it, and **the page and this
Worker import the same file**. One definition of rank, one zone order, one
place to change them.

What is on this side is only this side's business: `ladder.ts` reads the
holder list, seats it with that shared module, and caches the result for a
minute so that reading your own inbox never waits on somebody else's indexer.

### Reading the chain

Where that holder list comes from is the part that surprises people. Solana
has no "list the holders of this token" call. `getTokenLargestAccounts`
returns **at most twenty** accounts, and twenty is the flight deck, all of
first and ten business seats — so an aircraft of 178 used to end in the
middle of row 4 unless somebody wired up an indexer.

There is a way to get the rest out of a plain RPC, and it is the one every
explorer uses: ask the token program for every account it owns whose mint
field is this mint. Not capped, and pinned by indexed filters so it is not a
scan of every token on Solana. `holderList.ts` tries three sources in order:

1. `HOLDERS_URL`, an indexer. Still the best answer, still uncapped.
2. Every token account for the mint, summed by owner — the whole aircraft,
   from the mint alone, no indexer required.
3. The twenty largest accounts, for endpoints that refuse the scan. Several
   public ones do.

**There are two token programs**, classic SPL Token and Token-2022, and a
mint belongs to exactly one. `getProgramAccounts` is asked *of a program*, so
asking the wrong one is not an error: it is an empty list, and an empty list
reads as "this token has no holders". The aeroplane comes back with nobody on
it and nothing says why. So the mint's owning program is looked up first — one
cheap call that returns no account data — and the scan is pointed at that.

The exact-size filter goes only to the classic program. A Token-2022 account
is the same 165 bytes and then, when it carries any extension, a type byte and
the extension records; an associated token account always carries
ImmutableOwner, so demanding exactly 165 there would exclude very nearly every
real holder. The memcmp on the mint does the work instead, and the first 165
bytes are laid out identically either way, so one slice reads both.

**The page reads the chain through here, not around it.** `GET /holding` and
`GET /holders` are the two reads the page used to open its own RPC for, which
is what `VITE_RPC_URL` was. Vite inlines every `VITE_` value into the bundle,
so that variable published the endpoint's API key to every visitor; the
defence on offer was domain restriction at the provider, which is the `Origin`
header, which is a string anybody with curl can type. The key is a Worker
secret now and never leaves. What the browser gets back are public on-chain
facts about wallets the seat map already draws.

The saving is larger than the security. One visitor reloading the page was one
call to a metered endpoint; a hundred visitors were a hundred callers. Now the
Worker reads once and caches for all of them — sixty seconds for the seating,
twenty for a single wallet's balance.

A read that fails answers `503`, never a zero balance. A holder told they hold
nothing is reseated into the hold, announced over the PA, and shut out of
every card in the cabin — so "could not ask" must never arrive looking like an
answer.

**`RPC_URL` has a default.** It is a secret rather than a var, because a paid
endpoint carries its key in the URL, and a secret is set by hand — which
means a deploy that is right in every other way can land with no way to read
the chain at all. That failure is silent: the directory opens, lists
everybody, and withholds every contact detail from everybody. So unset, the
Worker falls back to Solana's own public endpoint: rate-limited, wrong for
real traffic, and far better than not knowing who is aboard. **Set
`RPC_URL`.** This is what happens when you have not.

### Keeping one seating chart

- **`HOLDERS_URL` is optional now**, and if you set one it should be the feed
  the page reads (`VITE_HOLDERS_URL`). One feed is what keeps one seating
  chart. The page additionally drops accounts owned by a program — a bonding
  curve is not a passenger — so a feed that lists contracts will seat
  somebody here who is not seated there.
- **The page reads `GET /holders` by default**, which is this Worker handing
  back the list it has already read and cached. That makes the two agreeing
  the default rather than something two environment variables have to be kept
  in step about, and it means the chain is scanned once a minute for the whole
  site instead of once every ninety seconds per visitor.
- **`MANIFEST_SIZE` must match `VITE_MANIFEST_SIZE`**, or the two disagree
  about who is on the aircraft at all at the very back.

With neither `HOLDERS_URL` nor an `RPC_URL`/`TOKEN_MINT` pair to fall back
on, the directory cannot tell one cabin from another, so it fails closed:
contact details go to nobody but their owner, nobody overhears anything, and
`POST /messages` answers 503 rather than taking an introduction it has no way
to place. A service that cannot name the cabins cannot keep a rule written in
their names. `GET /health` is where you see which state a deployment is in,
and it is worth reading before trusting a directory, because the difference
between a working one and a quiet one is not visible from the page:

| field | what it answers |
| --- | --- |
| `sections` | Can the cabins be told apart **right now**? False and every card keeps its contact details, nobody overhears, and no introduction sends. |
| `configured` | Was a `HOLDERS_URL` or a `TOKEN_MINT` ever set? This separates "nobody configured it" from "the endpoint refused". |
| `seated` / `cabin` | How much of the aircraft actually filled. |

`sections` was `configured` until the chain scan arrived and pulled the two
apart: with a mint set and an endpoint that refuses the scan, a deployment is
configured and seating nobody, and reporting the first when you asked the
second is how a silent failure stays silent. They are separate fields for
that reason, and the pair reads as a diagnosis — `sections: false` with
`configured: false` is a missing setting, and with `configured: true` it is
an endpoint that would not answer.

`seated` is the third failure, and the one that looks healthiest. A cabin
filling to 20 of 178 reports `sections: true` and is telling the truth: the
cabins genuinely can be told apart. It is simply a directory that works for
twenty people and does not exist for anybody else, which is what falling back
to `getTokenLargestAccounts` looks like from outside.

Abuse is bounded separately: 20 introductions per wallet per hour, 1,000
characters each, and contact links that must be `http(s)`.

## The logbook

One route here is not about cabins at all. `/logbook` is the operator's own
notebook — the things heard in a cabin full of conversations that might be
worth something later, which otherwise get remembered for a day and are gone
by the time they mattered. `GET` reads it, `POST` writes one down, `PATCH`
amends one, `DELETE` strikes one out.

It belongs to exactly one wallet, named in `ADMIN_WALLET`. Not a role, not a
row in a table, and not a balance: everything else in this service is a rule
about where somebody is sitting, which is true of whoever happens to be in
that seat this minute, and a notebook that changed hands when somebody bought
more of the token would not be a notebook. There is no `admins` table, so
there is no grant here for a bug to get wrong.

**It answers 404, not 403.** A 403 is an answer — it says there is something
here, it is worth guarding, and you have found the right path. So every
request that is not the operator's gets what a misspelt path gets, byte for
byte, headers and all: no database, no configured operator, no token, an
expired token, somebody else's token, a read or a write, all one refusal. The
route suite asserts that against a deliberate typo rather than against a
literal, because the two answers being *identical* is the whole feature.

Unset, `ADMIN_WALLET` means nobody rather than everybody, and a malformed one
matches nothing — not even itself. A deployment that never named an operator
has no logbook, which is the safe direction to fail in for a route whose
answer is somebody's private notes.

The address itself is not a secret and is not kept as one. It is a public key:
it is on the chain, and it is drawn on this aircraft's own seat map if the
operator holds the token. What guards those notes is the signature that opens
a session, which needs the private key. Set it as a `[vars]` entry, or with
`wrangler secret put ADMIN_WALLET` if you would rather it were not in the
repository; the code reads it the same either way.

One exemption comes with it. A session is for holders, because the directory
is a room for holders — but the operator's opens at any balance, and survives
the re-check on every request after it. The logbook belongs to a wallet, not
to a bag, and an operator locked out of their own notes because a holding
dipped would be a failure with no error in it and nothing on the page to read
it off. What they hold still decides everything else: the ladder seats them
where their bag puts them, which for a wallet holding nothing is the hold.

On the page it is at `/#logbook`, linked from nowhere and lazily loaded, so a
visitor who never types the fragment does not even fetch the chunk. That is
obscurity rather than security — the gate is the 404 above — and the page is
careful not to give it away: until the server confirms, it draws a small card
saying nothing about what it guards, and if the answer is no it draws nothing
at all.

## Flying it by hand

The aeroplane flies the market. Pitch, bank, speed and altitude are all read
off the chart, on every visitor's page, from the same number — and `/flight`
is the one place that overrules it: an extra roll, a camera turntable, flaps,
the hour of the day and the weather.

`GET` is public and unauthenticated, like the wall and the holder list.
`PUT` belongs to the wallet in `ADMIN_WALLET`, and refuses everybody else with
a plain **403** rather than the logbook's 404. The difference is the point:
the logbook is hidden and this is not. Every visitor watching the aeroplane
roll already knows somebody rolled it.

That is also why it is stored here rather than in a browser. An aeroplane only
its operator can see upside down is a screensaver; this one is a flight
everybody is on. Throw the invert switch and somebody sitting in 24C watches
the ground come up over their window, the artificial horizon on the flight
deck goes over, and the cargo hold leans all the way with it.

Nothing reachable from here can hurt anybody, and nothing here is asked to be
trusted. It is an attitude, a camera rate and a sky: no balances, no
addresses, nothing written anywhere else. The altitude is still the market cap
however far over the thing is rolled, and the manifest is still the manifest.
The worst a compromised set of switches could do is make the aeroplane look
silly.

Every field is clamped by `src/lib/manualControls.ts` — the same function the
page clamps with, imported by both sides exactly as the seating is — on the
way in *and* on the way back out, because the way in is this deployment's own
code and the way out is whatever is in the namespace today. The limits are not
decoration: an unbounded roll is every open page watching an aeroplane spin
for a minute and a half with no switch that stops it, and a non-numeric one is
a rotation of `NaN`, which is an aeroplane that vanishes from every screen at
once.

It lives in KV rather than SQL because it is one key with no history and no
relations, behind a five-second warm-isolate snapshot — this is the hottest
read on the service, since every open tab asks it every twenty seconds, and it
changes when somebody presses a button, which is rarely. Hands off is stored
as an *absence*: giving the aeroplane back to the market deletes the record
rather than writing a row of zeroes, so the common case is a missing key and
there is nothing left behind to go stale.

**It is not free.** A visitor with the tab open is one request every twenty
seconds — call it 4,300 a day — against the free plan's 100,000. That is the
cost of "everybody sees it", and it is worth knowing before launch traffic
rather than after: the Workers Paid plan is $5/month for 10 million.

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

**`TOKEN_MINT` is what turns the cabins on.** With it the Worker can read
holders — from `HOLDERS_URL` if you set one, from the chain if you do not —
and `GET /health` reports `sections: true` once a read has actually
succeeded, with `seated` saying how many of `cabin` it placed. Setting the
mint is what makes the read possible, not what makes it work: an endpoint
that refuses the scan is `configured: true` with a `seated` well short of the
aircraft, or `sections: false` if it would not answer at all. Without any way
to read holders
the directory cannot tell one cabin from another: every card keeps its
contact details to itself, nobody overhears anything, and no introduction
will send. `HOLDERS_URL` is a plain var in `wrangler.toml`, alongside
`MANIFEST_SIZE` if the page sets `VITE_MANIFEST_SIZE`.

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
# Optional, and you want it anyway: unset, the Worker uses Solana's public
# endpoint, which will rate-limit anything resembling traffic.
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

Fifteen cases over `verify.ts`: a genuine signature accepted, and a wrong
wallet, a captured signature reused for other artwork, a moved timestamp,
malformed base58 and SVG wearing a JPEG label each refused; a genuine
takedown accepted, and one replayed against a later advert — or a publish
signature offered as one — refused; plus the record
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

The section cases need an aircraft with people in it, so **the suite serves
its own holder list** on `127.0.0.1:8788` — the URL `wrangler.local.toml`
points `HOLDERS_URL` at — and seats the wallets it has just generated: one on
the flight deck, two in First, one in business. Then: a First Class card is
name and role only to business; the same card is readable in full from the
flight deck; a First Class conversation carries forward to the deck and not
back to business; and the two wallets on a message always read it themselves.
The local config also sets `LADDER_CACHE_MS = "1000"`, so a run is not judged
against the seating of the run before it.

Over the wall itself, on real HTTP against real bindings: a signed advert is accepted, stored, and comes back out of
`GET /banners`; the artwork is fetched back from the URL it was given and
checked byte for byte; that URL is readable as a WebGL texture and carries a
version; a second publish inside the cooldown gets 429; forged, stale,
unsigned and SVG-disguised uploads are refused with the right status each
time; a takedown signed for another advert, a forged one and a stale one are
refused, a genuine one takes the advert off the wall, and taking it down again
answers 404; CORS echoes the allowed origin and the preflight is answered.

Run it again in the other storage mode:

```bash
npm run dev:local:r2
npm run test:e2e
```

The Worker picks its backend from whether an R2 binding and
`PUBLIC_IMAGE_BASE` are *both* present, which means the branch that runs in
production is decided by config rather than by code — and a test suite that
only ever sees one config only ever tests half of `storeImage`. So there are
two local configs and the same nineteen cases run against each. The image case
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
