---
description: Your own time of day and your local weather, with no location permission.
---

# The sky outside

The market flies the aircraft; the sky is simply the sky. It is the one thing on the page that has nothing to do with the token.

## Time of day — your clock

The sun's height is worked out properly for today's date and your approximate position, from your device's own clock. The cabin is dark at midnight in Sydney and golden at 7pm in Lisbon, and the horizon glows in the right place either way. This needs no network and always works.

The **Outside** reading under the view names the light: _Night_, _Before dawn_, _Dawn_, _Golden hour_, _Daylight_ or _Dusk_.

## Weather — where you are

Current weather comes from [Open-Meteo](https://open-meteo.com/), a free public weather service. Your position is estimated from your browser's **time zone** rather than by asking for your location, so you are never shown a location permission prompt — close enough for a sky, and it costs you nothing.

The weather reads as _Clear_, _Scattered cloud_, _Overcast_, _Fog_, _Rain_, _Snow_ or _Thunderstorms_.

## Live or modelled

If the weather cannot be fetched — you are offline, the request is blocked, or your time zone is not one the page recognises — a modelled sky for the date stands in, and the page never waits for it. The **Outside** reading says which you are seeing: **Live weather** or **Modelled weather**.

{% hint style="info" %}
The lit windows you see from outside are real: each window is a row of the cabin, lit when at least one holder is seated in it. See [The seat ladder](../the-cabin/seat-ladder.md).
{% endhint %}
