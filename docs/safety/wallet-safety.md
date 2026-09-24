---
description: Exactly what Seat Airlines asks your wallet for — and what it never will.
---

# Wallet safety

## Seat Airlines never asks for a transaction

Nothing on the site sends, swaps, approves or spends anything. Connecting a wallet shares your **public address** and nothing else, and every signature the site asks for is a **plain-text message** you can read in full in your wallet before you approve it.

{% hint style="danger" %}
If a page claiming to be Seat Airlines asks you to **approve a transaction**, to sign something you cannot read, or for your **seed phrase** or **private key** — stop and reject it. That is not Seat Airlines, which never asks for any of them.
{% endhint %}

## The only three messages you will be asked to sign

**1. Putting an advert on your seat** — every time you publish one:

```
SEAT AIRLINES
Publish this advert on my seat.

wallet: <your address>
image:  sha256:<fingerprint of the exact image>
issued: <the time you pressed the button>
```

**2. Taking your advert down** — when you press **Take it down**:

```
SEAT AIRLINES
Take the advert off my seat.

wallet: <your address>
advert: <the stored name of that advert's image>
issued: <the time you pressed the button>
```

**3. Signing in to the cabin directory** — once a day at most:

```
SEAT AIRLINES
Sign in to the cabin directory.

This lets you publish your card, read your section, and send and
receive introductions for one day. It authorises no transaction.

wallet: <your address>
issued: <the time you pressed the button>
```

All three are checked by the server, and all three expire: a signature more than five minutes old is refused. A directory sign-in can be used **once** — a copy of it cannot open a second session. An advert signature covers **one exact image**, so it cannot be reused to put up a different picture, and a takedown names **one exact advert**, so it cannot take down one you put up later.

## Check you are in the right place

* The site is **seat-airlines.space**.
* The token's contract address is on the **CA** strip at the top of the site. Compare the **whole** address before you buy — see [The token](../getting-started/the-token.md).

## What is public

* **Your seat, rank, address and balance.** Balances are public on Solana, and the wall shows them for every seated holder.
* **Your advert**, with its description and link, for everyone.
* **Your card's name and role**, for every holder signed in to the directory, and **its contact details** for your own section and the sections ahead of you — see [Your seat is how far you can see](../section-network/how-far-you-can-see.md).

## What is stored, and where

**On the Seat Airlines server** (a Cloudflare Worker): your published adverts, your card, the messages you send, and your directory sessions. A session is stored only as a one-way fingerprint (SHA-256), so a copy of the session table cannot be used to get into anybody's account.

**In your browser:**

| Stored | For | How long |
| --- | --- | --- |
| Your directory session | Staying signed in to the directory | 24 hours, or until you press **Sign out of the directory** |
| Adverts saved locally | Kept on this device when the advert server could not be reached | Until you take them down |
| The token's address | Clearing the two above when the token changes | Until the next change |

{% hint style="warning" %}
Links in adverts and on cards are published by other holders. Only `http://` and `https://` links are accepted, but treat them like any link from a stranger.
{% endhint %}
