---
description: The contract address, where to get it, and what the aircraft reads from its market.
---

# The token

## Contract address

The token is on **Solana**. Its contract address (CA) is:

```
AWJCyg9PrMtYju9yaQmdQLcwrGobHMTv9JU3mo4upump
```

It trades on pump.fun: [pump.fun/coin/AWJCyg9PrMtYju9yaQmdQLcwrGobHMTv9JU3mo4upump](https://pump.fun/coin/AWJCyg9PrMtYju9yaQmdQLcwrGobHMTv9JU3mo4upump).

{% hint style="warning" %}
Always check the **whole** address, not just the first and last few characters. The strip marked **CA** across the top of [seat-airlines.space](https://seat-airlines.space) shows the address the site is actually flying, and its **Copy** button copies it exactly. If this page and the site ever disagree, trust the site.
{% endhint %}

## What the aircraft reads

Three numbers from the market, and one from the chain:

| From | The number | What it becomes |
| --- | --- | --- |
| Market | Market cap | **Altitude**, in feet, one for one: $163K is 163,000 ft |
| Market | Price change over the last **five minutes** | **Pitch** — nose up when it rises, nose down when it falls — and, from how fast it is changing, **bank** |
| Market | Holder count | How many holders ride **below the cutoff**, in the cargo hold |
| Chain | Every holder's balance | The **seat ladder**: who sits where |

See [One number flies the plane](../how-it-flies/flight-model.md) for exactly how each one moves the aircraft.

## Where the numbers come from

* **The market** is read from Jupiter's public token API, in your browser, every 20 seconds. If Jupiter rate-limits the request, the page waits 90 seconds before asking again.
* **Balances** are read from Solana by the Seat Airlines server, which caches the holder list for 60 seconds and a single balance for 20 seconds. The page re-reads the holder list every 90 seconds and your own balance every 2 minutes, and polling pauses while the tab is in the background.
* **Program accounts are not passengers.** A pump.fun bonding curve or a liquidity pool holds tokens, but it is a program, not a person, so it is never seated. Only ordinary wallets are.

{% hint style="info" %}
If the market cannot be reached, the instruments **hold their last reading** rather than dropping to zero — the way a real instrument behaves when its source goes quiet. When the page first opens, it shows 163,000 ft and a level attitude for the moment before the first reading arrives.
{% endhint %}
