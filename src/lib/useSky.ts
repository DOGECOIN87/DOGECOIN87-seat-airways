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

const CLOCK_INTERVAL = 60_000;
const WEATHER_INTERVAL = 15 * 60_000;

export function useSky(): SkyState {
  const [coords] = useState(coordsFromTimezone);
  const [weather, setWeather] = useState<{ weather: WeatherKind; cloudCover: number; live: boolean }>(
    () => ({ ...modelledWeather(new Date()), live: false }),
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_INTERVAL);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      const reading = await fetchWeather(coords[0], coords[1], controller.signal);
      if (!cancelled && reading) setWeather({ ...reading, live: true });
    };

    load();
    const id = setInterval(load, WEATHER_INTERVAL);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [coords]);

  return skyState(now, coords[0], coords[1], weather.weather, weather.cloudCover, weather.live);
}
