---
description: Every public route on the Worker, what it takes and what it answers.
---

# Worker API

Base URL in production: `https://seat-airlines-banners.trashmarket.workers.dev`. Every route answers JSON, and errors come back as `{ "error": "<a sentence you can show a person>" }`.

## Public routes

| Route | Answers |
| --- | --- |
| `GET /health` | `{ ok, service, storage, directory, sections, configured, seated, cabin }` — never cached |
| `GET /holders` | `{ holders: [{ address, balance }], supply }` — who is aboard, as the page seats them |
| `GET /holding?address=<wallet>` | `{ balance, supply, share }` for one wallet |
| `GET /banners` | The published wall: `{ "<wallet>": { image, alt, href? } }` |
| `POST /banner` | Publish an advert — see below |
| `DELETE /banner` | Take your own advert down — see below |
| `GET /images/<key>` | Advert artwork, when it is stored in KV rather than R2 |
| `GET /flight` | The crew's current flight controls |

`GET /holding` answers **503** when the chain cannot be asked, never a zero balance: a holder told they hold nothing would be moved to the hold and shut out of the directory.

### Reading `/health`

| Field | Answers |
| --- | --- |
| `storage` | `"r2"` or `"kv"` — where artwork is kept |
| `directory` | Whether the D1 database is bound |
| `sections` | Whether the cabins can be told apart **right now**. False means no card shows contact details and no introduction sends. |
| `configured` | Whether a `TOKEN_MINT` or `HOLDERS_URL` was ever set — separates "nobody configured it" from "the endpoint refused" |
| `seated` / `cabin` | How many of the seats actually filled. A cabin stuck at 20 of 178 means the RPC refused the full holder scan. |

## Publishing an advert

`POST /banner` with:

```json
{
  "owner": "<wallet address>",
  "image": "data:image/webp;base64,…",
  "alt": "What the advert says",
  "href": "https://example.com",
  "issued": "2026-09-23T12:00:00.000Z",
  "signature": "<base58 ed25519 signature>"
}
```

The signature is over this exact text, where the fingerprint is the SHA-256 of the image bytes, in hex:

```
SEAT AIRLINES
Publish this advert on my seat.

wallet: <owner>
image:  sha256:<fingerprint>
issued: <issued>
```

It answers `{ "image": "<url of the stored artwork>" }`, or:

| Status | Why |
| --- | --- |
| 400 | Not JSON, a missing field, an undecodable image, or a signature older than five minutes |
| 401 | The signature does not match the wallet |
| 403 | The wallet does not hold the token |
| 413 | The image is over 512 KB |
| 415 | The image is not a real JPEG, PNG or WebP |
| 429 | Another publish from this wallet inside the last minute |

## Taking an advert down

`DELETE /banner` with `{ owner, key, issued, signature }`, where `key` is the stored name of the advert's artwork — the `banners/…` path its image URL ends in. The signature is over:

```
SEAT AIRLINES
Take the advert off my seat.

wallet: <owner>
advert: <key>
issued: <issued>
```

It answers `{ "ok": true }` and removes the advert from the wall, or:

| Status | Why |
| --- | --- |
| 400 | Not JSON, a missing field, or a signature older than five minutes |
| 401 | The signature does not match the wallet |
| 404 | There is no advert up for this wallet. The body carries `"gone": true`, and the page treats this as done |
| 409 | The advert up now is not the one the signature names |

There is no holder check and no cooldown, and the artwork itself is left in place, since another wallet may be showing the same picture.

## The directory

Every directory route needs a session: send `Authorization: Bearer <token>`.

| Route | Does |
| --- | --- |
| `POST /session` | Sign in with `{ address, issued, signature }`, signed over the sign-in message in [Wallet safety](../safety/wallet-safety.md). Answers `{ token, address, expires }`, good for 24 hours. |
| `DELETE /session` | Sign out, revoking the token |
| `GET /directory` | The cards of every seated holder, plus your own. Contact fields are included only where your seat can read them. |
| `PUT /profile` | Publish or amend your card: `{ displayName, role, email, website, linkedin }` |
| `GET /messages` | `{ inbox, sent, overheard, channels, announcements }` — your own cabin's room only |
| `GET /messages?rooms=all` | The same, plus the room of every cabin behind yours |
| `POST /messages` | `{ to, body }`, where `to` is a wallet, `section:<cabin>`, or `announcement` |

The cabins are `deck`, `first`, `business`, `exit` and `economy`. The rules in [Your seat is how far you can see](../section-network/how-far-you-can-see.md) are enforced here, before any row is written or read.

## CORS

The API routes answer only the origins in `ALLOWED_ORIGINS`. The `/images/` route answers any origin, because the cabin's seat-back screens load artwork as WebGL textures.
