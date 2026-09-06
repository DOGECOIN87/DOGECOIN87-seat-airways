/**
 * The sky outside FL350 — real time of day, real weather.
 *
 * Two inputs, both live and both independent of the market:
 *
 *   Time of day  comes from the visitor's own clock. The sun's elevation is
 *                computed properly (declination and hour angle for the date
 *                and latitude), so the cabin is dark at midnight in Sydney and
 *                golden at 7pm in Lisbon, and the horizon burns in the right
 *                place either way. No network needed — this always works.
 *
 *   Weather      comes from Open-Meteo, which needs no key and sends CORS
 *                headers. Coordinates are derived from the browser's own IANA
 *                timezone rather than asking for location permission: close
 *                enough for a sky, and it costs the visitor nothing. If the
 *                request fails, is blocked, or the timezone is unknown, the
 *                sky falls back to a deterministic model keyed to the date, so
 *                the page never waits on a network call to look right.
 *
 * Nothing here knows about the token. The market flies the aircraft; the sky
 * is simply the sky.
 */

export type SkyPhase = 'night' | 'astronomical' | 'dawn' | 'golden' | 'day' | 'dusk';

export type WeatherKind = 'clear' | 'cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'storm';

export interface SkyPalette {
  /** Zenith, straight up out of the window. */
  top: string;
  /** The body of the sky. */
  mid: string;
  /** Where the sky meets the horizon. */
  horizon: string;
  /** Ground nearest the horizon, and furthest below. */
  groundNear: string;
  groundFar: string;
  /** The sun or moon disc, and the bloom around it. */
  disc: string;
  glow: string;
  /** 0–1. How much of the starfield shows through. */
  stars: number;
  /** 0–1. How lit the ground grid reads. */
  grid: number;
}

export interface SkyState {
  phase: SkyPhase;
  /** Solar elevation in degrees. Negative is below the horizon. */
  elevation: number;
  /** Where the sun sits across the window, −1 (left) to 1 (right). */
  sunX: number;
  palette: SkyPalette;
  weather: WeatherKind;
  /** 0–1 cloud cover. */
  cloudCover: number;
  /** Human-readable, for the cabin's own information strip. */
  label: string;
  /** True once real weather has been fetched; false while modelled. */
  live: boolean;
}

/* ── Palettes ─────────────────────────────────────────────────────────────
   Sampled from what the sky actually does at altitude: a hard blue overhead
   that washes pale at the horizon by day, the orange band low down at dawn
   and dusk, and near-black with the ground reading only as city light at
   night. `grid` doubles as how lit the terrain below is. */
const PALETTES: Record<SkyPhase, SkyPalette> = {
  night: {
    top: '#01030A', mid: '#050B1C', horizon: '#102741',
    groundNear: '#0A1018', groundFar: '#02040A',
    disc: '#E8EEFF', glow: '#2E4066', stars: 1, grid: 0.3,
  },
  astronomical: {
    top: '#030814', mid: '#0A1730', horizon: '#1E3B62',
    groundNear: '#0E1622', groundFar: '#04070E',
    disc: '#E8EEFF', glow: '#3A5684', stars: 0.85, grid: 0.4,
  },
  dawn: {
    top: '#0C1D3E', mid: '#2E5183', horizon: '#EE8A5C',
    groundNear: '#2A2C3A', groundFar: '#0A0E18',
    disc: '#FFD9A8', glow: '#FF9E5E', stars: 0.35, grid: 0.6,
  },
  golden: {
    top: '#1B58A6', mid: '#4A93DC', horizon: '#F7AC63',
    groundNear: '#4E4736', groundFar: '#1A1C22',
    disc: '#FFF3D8', glow: '#FFBC7A', stars: 0.06, grid: 0.85,
  },
  day: {
    top: '#1352B8', mid: '#4A9BE0', horizon: '#C2DEF4',
    groundNear: '#5A7A55', groundFar: '#2C3C31',
    disc: '#FFFFFF', glow: '#E2F0FF', stars: 0, grid: 1,
  },
  dusk: {
    top: '#111F3E', mid: '#31527F', horizon: '#E3714C',
    groundNear: '#242531', groundFar: '#080B14',
    disc: '#FFC9A0', glow: '#FF8C5A', stars: 0.3, grid: 0.55,
  },
};

/** WMO weather codes, as Open-Meteo reports them. */
function weatherFromCode(code: number): WeatherKind {
  if (code === 0) return 'clear';
  if (code <= 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code >= 45 && code <= 48) return 'fog';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloudy';
}

const WEATHER_LABEL: Record<WeatherKind, string> = {
  clear: 'Clear',
  cloudy: 'Scattered cloud',
  overcast: 'Overcast',
  fog: 'Fog',
  rain: 'Rain',
  snow: 'Snow',
  storm: 'Thunderstorms',
};

const PHASE_LABEL: Record<SkyPhase, string> = {
  night: 'Night',
  astronomical: 'Before dawn',
  dawn: 'Dawn',
  golden: 'Golden hour',
  day: 'Daylight',
  dusk: 'Dusk',
};

/**
 * Solar elevation for a moment and a place.
 *
 * The standard low-precision solar position: declination from the day of the
 * year, hour angle from local solar time. Good to about half a degree, which
 * is a great deal more than a sky gradient needs.
 */
export function solarElevation(date: Date, latitude: number, longitude: number): number {
  const rad = Math.PI / 180;
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000);

  const declination = 23.44 * Math.sin(rad * (360 / 365) * (dayOfYear - 81));
  // Local solar time from UTC plus the longitude's share of the day.
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const solarHours = utcHours + longitude / 15;
  const hourAngle = 15 * (solarHours - 12);

  const sin =
    Math.sin(rad * latitude) * Math.sin(rad * declination) +
    Math.cos(rad * latitude) * Math.cos(rad * declination) * Math.cos(rad * hourAngle);

  return Math.asin(Math.max(-1, Math.min(1, sin))) / rad;
}

function phaseFor(elevation: number): SkyPhase {
  if (elevation > 22) return 'day';
  if (elevation > 8) return 'golden';
  if (elevation > -0.8) return 'dawn';
  if (elevation > -6) return 'dusk';
  if (elevation > -18) return 'astronomical';
  return 'night';
}

/**
 * Where the sun sits across the window.
 *
 * Derived from the hour angle so it tracks east to west through the day
 * rather than sitting dead ahead — the light moves across the cabin.
 */
function sunAcross(date: Date, longitude: number): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const hourAngle = 15 * (utcHours + longitude / 15 - 12);
  return Math.max(-1, Math.min(1, hourAngle / 90));
}

/* ── Coordinates without asking ──────────────────────────────────────────
   A rough centre for the common IANA zones. This only has to be good enough
   to place the sun and pick up the right weather system; being a hundred
   kilometres out changes nothing anyone can see. */
const ZONE_COORDS: Record<string, [number, number]> = {
  'America/Los_Angeles': [34.05, -118.24], 'America/Vancouver': [49.28, -123.12],
  'America/Denver': [39.74, -104.99], 'America/Phoenix': [33.45, -112.07],
  'America/Chicago': [41.88, -87.63], 'America/Mexico_City': [19.43, -99.13],
  'America/New_York': [40.71, -74.01], 'America/Toronto': [43.65, -79.38],
  'America/Sao_Paulo': [-23.55, -46.63], 'America/Bogota': [4.71, -74.07],
  'America/Argentina/Buenos_Aires': [-34.6, -58.38],
  'Europe/London': [51.51, -0.13], 'Europe/Dublin': [53.35, -6.26],
  'Europe/Lisbon': [38.72, -9.14], 'Europe/Madrid': [40.42, -3.7],
  'Europe/Paris': [48.86, 2.35], 'Europe/Amsterdam': [52.37, 4.9],
  'Europe/Brussels': [50.85, 4.35], 'Europe/Berlin': [52.52, 13.4],
  'Europe/Zurich': [47.38, 8.54], 'Europe/Rome': [41.9, 12.5],
  'Europe/Vienna': [48.21, 16.37], 'Europe/Prague': [50.08, 14.44],
  'Europe/Warsaw': [52.23, 21.01], 'Europe/Stockholm': [59.33, 18.07],
  'Europe/Oslo': [59.91, 10.75], 'Europe/Helsinki': [60.17, 24.94],
  'Europe/Athens': [37.98, 23.73], 'Europe/Istanbul': [41.01, 28.98],
  'Europe/Kyiv': [50.45, 30.52], 'Europe/Moscow': [55.76, 37.62],
  'Africa/Lagos': [6.52, 3.38], 'Africa/Cairo': [30.04, 31.24],
  'Africa/Nairobi': [-1.29, 36.82], 'Africa/Johannesburg': [-26.2, 28.05],
  'Asia/Dubai': [25.2, 55.27], 'Asia/Karachi': [24.86, 67.0],
  'Asia/Kolkata': [19.08, 72.88], 'Asia/Calcutta': [19.08, 72.88],
  'Asia/Dhaka': [23.81, 90.41], 'Asia/Bangkok': [13.76, 100.5],
  'Asia/Jakarta': [-6.21, 106.85], 'Asia/Singapore': [1.35, 103.82],
  'Asia/Manila': [14.6, 120.98], 'Asia/Hong_Kong': [22.32, 114.17],
  'Asia/Shanghai': [31.23, 121.47], 'Asia/Seoul': [37.57, 126.98],
  'Asia/Tokyo': [35.68, 139.69], 'Australia/Perth': [-31.95, 115.86],
  'Australia/Brisbane': [-27.47, 153.03], 'Australia/Sydney': [-33.87, 151.21],
  'Australia/Melbourne': [-37.81, 144.96], 'Pacific/Auckland': [-36.85, 174.76],
};

/** Somewhere with a decent skyline, for when the timezone is unknown. */
const FALLBACK: [number, number] = [40.71, -74.01];

export function coordsFromTimezone(): [number, number] {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && ZONE_COORDS[zone]) return ZONE_COORDS[zone];
    // Unknown zone: at least get the hemisphere and longitude roughly right
    // from the offset, so the sun is on the correct side of the aircraft.
    const offsetHours = -new Date().getTimezoneOffset() / 60;
    return [FALLBACK[0], Math.max(-180, Math.min(180, offsetHours * 15))];
  } catch {
    return FALLBACK;
  }
}

/**
 * Modelled weather, for before the fetch lands or when it never does.
 *
 * Deterministic on the date so it does not flicker between renders, and
 * weighted toward clear — most days are.
 */
export function modelledWeather(date: Date): { weather: WeatherKind; cloudCover: number } {
  const day = Math.floor(date.getTime() / 86_400_000);
  let h = Math.imul(day ^ 0x9e3779b9, 2246822507) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  const roll = (h % 1000) / 1000;
  if (roll < 0.42) return { weather: 'clear', cloudCover: 0.08 };
  if (roll < 0.68) return { weather: 'cloudy', cloudCover: 0.42 };
  if (roll < 0.83) return { weather: 'overcast', cloudCover: 0.88 };
  if (roll < 0.94) return { weather: 'rain', cloudCover: 0.8 };
  return { weather: 'storm', cloudCover: 0.95 };
}

/** Assemble the sky for a moment, a place and a weather reading. */
export function skyState(
  date: Date,
  latitude: number,
  longitude: number,
  weather: WeatherKind,
  cloudCover: number,
  live: boolean,
): SkyState {
  const elevation = solarElevation(date, latitude, longitude);
  const phase = phaseFor(elevation);
  return {
    phase,
    elevation,
    sunX: sunAcross(date, longitude),
    palette: PALETTES[phase],
    weather,
    cloudCover,
    label: `${PHASE_LABEL[phase]} · ${WEATHER_LABEL[weather]}`,
    live,
  };
}

/**
 * Ask Open-Meteo what it is doing outside.
 *
 * Keyless and CORS-enabled, so this is a plain fetch. Anything that goes
 * wrong — offline, blocked, rate-limited, a shape we did not expect — resolves
 * to null and the caller keeps the modelled sky.
 */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<{ weather: WeatherKind; cloudCover: number } | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude.toFixed(2)}` +
      `&longitude=${longitude.toFixed(2)}&current=weather_code,cloud_cover`;
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { current?: { weather_code?: number; cloud_cover?: number } };
    const code = body.current?.weather_code;
    if (typeof code !== 'number') return null;
    const cover = typeof body.current?.cloud_cover === 'number' ? body.current.cloud_cover / 100 : 0.3;
    return { weather: weatherFromCode(code), cloudCover: Math.max(0, Math.min(1, cover)) };
  } catch {
    return null;
  }
}
