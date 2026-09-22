/**
 * The live sky, as React state.
 *
 * Time of day re-derives every minute from the visitor's own clock, so the
 * light outside actually creeps forward while the page is open. Weather is
 * fetched once on mount and refreshed every fifteen minutes; until it lands
 * (or if it never does) the modelled sky stands in, so nothing waits on the
 * network to look right.
 */
import { useEffect, useState } from 'react';
import {
  coordsFromTimezone,
  fetchWeather,
  modelledWeather,
  skyState,
  type SkyState,
  type WeatherKind,
} from './sky';
import { visibilityAwareInterval } from './visibility';

const CLOCK_INTERVAL = 60_000;
const WEATHER_INTERVAL = 15 * 60_000;

/**
 * Somebody flying by hand, overruling the sky.
 *
 * Applied by moving the *inputs* rather than by patching the result: an hour
 * becomes a date, a weather becomes a weather, and `skyState` derives the
 * elevation, the phase, the palette, where the sun sits and the label from
 * those exactly as it does for the real ones. Overwriting `phase` on the way
 * out would give you a midnight palette with the sun still overhead.
 */
export interface SkyOverride {
  /** Force the hour of day, 0–23. Null or absent follows the clock. */
  hour?: number | null;
  weather?: WeatherKind | null;
  /** Cloud cover to go with a forced weather, 0–1. */
  cloudCover?: number | null;
}

export function useSky(override?: SkyOverride): SkyState {
  const [coords] = useState(coordsFromTimezone);
  const [weather, setWeather] = useState<{ weather: WeatherKind; cloudCover: number; live: boolean }>(
    () => ({ ...modelledWeather(new Date()), live: false }),
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    return visibilityAwareInterval(() => setNow(new Date()), CLOCK_INTERVAL);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller: AbortController | undefined;

    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      const reading = await fetchWeather(coords[0], coords[1], controller.signal);
      if (!cancelled && reading) setWeather({ ...reading, live: true });
    };

    const stop = visibilityAwareInterval(load, WEATHER_INTERVAL);
    return () => {
      cancelled = true;
      controller?.abort();
      stop();
    };
  }, [coords]);

  const hour = override?.hour;
  const at = typeof hour === 'number' ? new Date(now) : now;
  if (typeof hour === 'number') at.setHours(hour, 0, 0, 0);

  return skyState(
    at,
    coords[0],
    coords[1],
    override?.weather ?? weather.weather,
    override?.weather ? override.cloudCover ?? weather.cloudCover : weather.cloudCover,
    /* A forced sky is not a live reading, whatever the network said, and the
       cabin's information strip says "live weather" off this flag. */
    weather.live && !override?.weather && typeof hour !== 'number',
  );
}
