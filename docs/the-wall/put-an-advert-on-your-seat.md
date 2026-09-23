---
description: Step by step, what you sign, and the rules an advert has to meet.
---

# Put an advert on your seat

## Before you start

* **You need a seat.** Only a holder seated on the aircraft can advertise, and only on their own seat.
* **Check in first.** Connect your wallet in the **Check in** section — see [Connecting a wallet](../getting-started/connecting-a-wallet.md).

## Steps

1. **Open your seat.** On the wall, select your seat — the one lit blue — and press **Advertise here** (or **Change your advert** if you already have one).
2. **Add an image.** Drop it on the square, paste it, or press **Choose image**. Any image your browser can open works, up to **8 MB**.
3. **Frame it.** Drag the image to reposition the square crop, then adjust it:
   * **Zoom** from 1× to 4×
   * **Bright**, **Contrast**, **Colour**, **Mono** and **Sepia**
   * **Rotate** and **Mirror**
   * **Show grid** / **Hide grid**, and **Reset edits** to start over

   The **On-seat preview** shows it at the size it will hang on the wall.
4. **Describe it.** **Description** is what the advert says, for anyone who cannot see it — up to 120 characters. **Link** is optional, and only `http://` and `https://` links are followed.
5. **Press Sign and put it up**, then approve the message in your wallet. The signature proves the seat is yours and covers this exact image. **It moves no funds.**

The PA confirms it: _"Advert up on seat 8A."_

## What your wallet signs

```
SEAT AIRLINES
Publish this advert on my seat.

wallet: <your address>
image:  sha256:<fingerprint of the exact image>
issued: <the time you pressed the button>
```

Because the signature names the exact image, it cannot be reused to put up a different picture, and because it is time-stamped, it goes stale after five minutes.

## What is stored

Your image is cropped to a square and re-encoded as a **384 × 384** picture of at most **512 KB**, so no upload can stretch the grid or bloat the page. The server accepts only real JPEG, PNG or WebP files, checked from the file's own bytes. SVG is refused, because an SVG can carry script.

## The rules

| Rule | Why |
| --- | --- |
| You must be seated, and your wallet must hold the token | Storage is not free, and the wall is for holders |
| The signature must be under five minutes old | A captured signature cannot be replayed later |
| One publish per wallet per minute | The wall cannot be flooded |
| Links must be `http://` or `https://` | An advert is not a place for a script link |

## Changing or taking one down

* **To change your advert**, publish a new one. It replaces the old one.
* **Take it down**, in the advert dialog, removes an advert that was saved in this browser only.
* A published advert comes down **on its own** if your wallet leaves the manifest.

## When something goes wrong

| You see | What happened |
| --- | --- |
| _You did not sign it, so nothing went up._ | You declined the wallet prompt. Nothing was published. |
| The PA says the advert is up _in this browser only_ | The advert server could not be reached, so the advert was saved on this device instead. Other people do not see it. Try again later. |
| Any other message in the dialog | The server read the request and refused it — for example, a wallet that does not hold the token, or a second publish inside a minute. Nothing was published. |
