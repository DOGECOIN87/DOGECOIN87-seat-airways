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

export function useSky(): SkyState {
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

  return skyState(now, coords[0], coords[1], weather.weather, weather.cloudCover, weather.live);
}
