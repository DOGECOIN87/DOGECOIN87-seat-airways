---
description: Every setting the page and the Worker read, and which ones are public.
---

# Configuration

## The page: `VITE_` variables

Everything is optional — a build with none of them set flies the committed token against the production Worker. `.env.example` lists them all.

{% hint style="danger" %}
**Every `VITE_` value is public.** Vite writes it into the JavaScript bundle, where anyone can read it. Set them as repository **variables**, not secrets — a secret would hide the value from the repository and from nobody else. Never put an API key in one.
{% endhint %}

| Variable | Default | What it does |
| --- | --- | --- |
| `VITE_TOKEN_MINT` | the address in `src/lib/token.ts` | The token the aircraft flies. Wins over the committed address when set. |
| `VITE_BANNERS_API` | `https://seat-airlines-banners.trashmarket.workers.dev` | The Worker: the advert wall, and — unless `VITE_DIRECTORY_API` is set — everything else below. |
| `VITE_DIRECTORY_API` | `VITE_BANNERS_API` | The Worker for the cabin directory, the holder list, balances and the flight controls. |
| `VITE_HOLDERS_URL` | the Worker's `/holders` | An indexer returning `[{ "address": "…", "balance": 123 }, …]`, if you have one. |
| `VITE_BANNERS_URL` | none | A curated, read-only wall: JSON of `{ "<seat>": { "image", "alt", "href" } }`. It overrides every other advert. |
| `VITE_MARKET_URL` | Jupiter's `tokens/v2/search` for the mint | Any JSON endpoint carrying market cap, the five-minute change and the holder count. Fields are found by name, at any depth. |
| `VITE_MANIFEST_SIZE` | 178 — the whole cabin | How many holders are seated. Must match the Worker's `MANIFEST_SIZE`. |
| `VITE_DOCS_URL` | these docs, published on GitBook | Where the footer's **Docs on GitBook** link goes. Set it only if the site's address changes — the committed default in `src/lib/docs.ts` is the published site. |
| `VITE_RPC_URL` | none | A Solana RPC the **browser** calls. **Leave it unset in production**: its URL, key and all, ships to every visitor. When set, the page also uses it for the seat inspector's recent wallet activity and as a fallback for reading holders. |

A blank variable counts as unset, so passing an empty repository variable through the deploy workflow is harmless.

## The Worker: `worker/wrangler.toml`

**Bindings**

| Binding | Type | Holds |
| --- | --- | --- |
| `BANNERS` | KV | Advert records, the flight controls, and the artwork when R2 is not used |
| `IMAGES` | R2 | The artwork, when `PUBLIC_IMAGE_BASE` is also set |
| `DIRECTORY` | D1 | Cards, messages, sessions — schema in `worker/migrations/` |

**Variables and secrets**

| Name | Kind | What it does |
| --- | --- | --- |
| `TOKEN_MINT` | variable | The mint. Turns on the holder check for adverts and sign-in, and lets the directory tell the cabins apart. |
| `RPC_URL` | **secret** | The Solana RPC endpoint. Unset, the Worker falls back to Solana's public endpoint, which rate-limits real traffic — set it. |
| `ALLOWED_ORIGINS` | variable | Comma-separated origins allowed to call the Worker. Production: `https://seat-airlines.space,https://www.seat-airlines.space`. Empty echoes any origin — fine locally, careless in production. |
| `HOLDERS_URL` | variable | An indexer, optional. If set, use the same feed as the page's `VITE_HOLDERS_URL`. |
| `MANIFEST_SIZE` | variable | Defaults to 178. Must match `VITE_MANIFEST_SIZE`. |
| `PUBLIC_IMAGE_BASE` | variable | The R2 bucket's public URL. Without it, artwork is kept in KV and served from `/images/…`. |
| `ADMIN_WALLET` | variable or secret | The operator wallet allowed to set the flight controls. |
| `LADDER_CACHE_MS`, `OWNER_CACHE_MS` | variable | Cache tuning: how long the holder list is kept (60 s by default), and how long a wallet is believed to hold the token (45 s). |

{% hint style="info" %}
`MANIFEST_SIZE` and `VITE_MANIFEST_SIZE` both default to the same constant from the shared seating module, so leaving both unset is the one way they cannot disagree about who is seated at the back.
{% endhint %}
