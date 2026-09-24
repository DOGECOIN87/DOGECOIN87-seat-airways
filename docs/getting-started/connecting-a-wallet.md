---
description: Which wallets work, what connecting shares, and how to check in on a phone.
---

# Connecting a wallet

## Supported wallets

Seat Airlines talks directly to the wallet your browser puts into the page. These work:

* **Phantom**
* **Solflare**
* **Backpack**

On a computer, use the wallet's browser extension. **On a phone, open seat-airlines.space inside your wallet app's own browser** — for example, the browser tab in Phantom or Solflare. An ordinary mobile browser has no wallet in the page to connect to.

## Checking in

1. Scroll to **Check in** at the bottom of the page.
2. Press **Check in with a wallet** and approve the connection in your wallet.
3. The card turns into your receipt: **Passenger** (your address, shortened), **Cabin**, **Holding** and **Share of supply**.

Your balance is merged into the seating the moment it is read, so you do not wait for the next refresh to see where you sit.

## What connecting shares

Connecting gives the site your **public address**, which is already public on the chain. It does not sign anything, move anything, or grant the site any permission over your funds.

{% hint style="info" %}
Two features ask for a signature later, and both are plain-text messages, never transactions: putting an advert on your seat, and signing in to the cabin directory. [Wallet safety](../safety/wallet-safety.md) shows both messages in full.
{% endhint %}

## Coming back

If you have connected before and your wallet trusts the site, you are checked in again automatically when the page opens. **Sign out** on the check-in card disconnects the wallet from the page.

## Troubleshooting

| You see | What it means |
| --- | --- |
| _No wallet extension detected_ | The page cannot find a wallet. Install one, or on a phone open the site in your wallet app's browser. |
| _No Solana wallet found…_ | Same cause, after pressing the button. |
| You closed the wallet prompt | Nothing happens and nothing is reported — declining is a choice, not an error. Press the button again when you are ready. |
| Holding reads **unread** | Your balance could not be read yet. It is retried every two minutes; reloading the page tries at once. |
