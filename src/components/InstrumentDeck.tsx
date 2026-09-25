import type { ReactNode } from 'react';
import type { FlightTick } from '../lib/flightFeed';
import type { SkyState } from '../lib/sky';
import {
  formatCap,
  formatChange,
  formatFeet,
  phaseFor,
  pitchFor,
  verticalSpeedFor,
  type BandState,
  type FlightBand,
} from '../lib/flightModel';

/**
 * The instrument deck's readings, drawn as instruments.
 *
 * The panel under the window is the aircraft's face, so its readings are
 * displays let into it the way the window is: dark glass, lit figures, and a
 * small instrument beside each one that shows the same number the way a
 * cockpit would — a tape for the altitude, a ball for the attitude, and a
 * cabin window for the sky. Every figure is still printed as text; the
 * drawings are the flourish, not the message.
 */

/* ── Icons ───────────────────────────────────────────────────────────────
   One stroke weight, one grid, drawn for this page. */

export type DeckIconName =
  | 'plane' | 'deck' | 'first' | 'business' | 'exit' | 'economy' | 'hold'
  | 'belt' | 'cup' | 'mask' | 'brace';

const ICON_PATHS: Record<DeckIconName, string[]> = {
  plane: ['M12 2.6c.9 0 1.5.9 1.5 2.2V10l7.3 4.1v2.1l-7.3-2.2v4.5l2.1 1.6v1.6L12 21l-3.6.7v-1.6l2.1-1.6V14l-7.3 2.2v-2.1L10.5 10V4.8c0-1.3.6-2.2 1.5-2.2z'],
  deck: ['M4.5 16.5a7.5 7.5 0 0 1 15 0', 'M12 16.5l3.4-4.4', 'M7.2 12.4l1 .8M12 9v1.3M16.8 12.4l-1 .8', 'M8.5 20h7'],
  first: ['M12 3.6l2.5 5.2 5.7.8-4.1 4 1 5.6L12 16.5l-5.1 2.7 1-5.6-4.1-4 5.7-.8z'],
  business: ['M5 7.5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V9A1.5 1.5 0 0 1 5 7.5z', 'M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5', 'M3.5 12.5h17'],
  exit: ['M13 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7', 'M10 12h10', 'M16.5 8.5 20 12l-3.5 3.5'],
  economy: ['M7.5 3.5 9 14h8', 'M17 14a1.5 1.5 0 0 1 1.5 1.5V17', 'M8.8 10h4.7', 'M13.5 14v6.5', 'M10 20.5h7'],
  hold: ['M8.5 6.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2z', 'M10 6.5V4.8a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.7', 'M10.5 10v5.5M13.5 10v5.5', 'M9 21.3v.01M15 21.3v.01'],
  belt: ['M3 12h5', 'M16 12h5', 'M9.5 8.5h5A1.5 1.5 0 0 1 16 10v4a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 8 14v-4a1.5 1.5 0 0 1 1.5-1.5z', 'M11 12h3.5'],
  cup: ['M5.5 9h11v5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5.5 14z', 'M16.5 10.5h.8a2.3 2.3 0 0 1 0 4.6h-1', 'M9.2 3.8c-.7.8-.7 1.6 0 2.4M12.8 3.8c-.7.8-.7 1.6 0 2.4', 'M4.5 21h13'],
  mask: ['M8 10c0-2 1.8-3.6 4-3.6s4 1.6 4 3.6v2.6c0 2.4-1.8 4.4-4 4.4s-4-2-4-4.4z', 'M8 10.8 3.6 8.8M16 10.8l4.4-2', 'M12 17v2.4c0 .9.7 1.6 1.6 1.6H16'],
  brace: ['M12 4.2 21 19.6H3z', 'M12 10v4.4', 'M12 17.1v.01'],
};

export const DeckIcon = ({ name, className }: { name: DeckIconName; className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden
    focusable="false"
  >
    {ICON_PATHS[name].map((d) => <path key={d} d={d} />)}
  </svg>
);

/* ── Instruments ─────────────────────────────────────────────────────── */

/** A strip of altimeter tape. It scrolls down as the aircraft climbs, the way the real one does. */
function AltitudeTape({ feet }: { feet: number }) {
  const STEP = 50;
  const GAP = 7;
  const offset = ((((feet % STEP) + STEP) % STEP) / STEP) * GAP;
  const firstMark = Math.floor(feet / STEP) - 6;
  const ticks = Array.from({ length: 13 }, (_, i) => {
    const mark = firstMark + i;
    const y = 36 + (Math.floor(feet / STEP) - mark) * GAP + offset;
    return { y, major: mark % 5 === 0, key: mark };
  });
  return (
    <svg viewBox="0 0 34 72" className="sa-tape" aria-hidden focusable="false">
      <defs>
        <linearGradient id="sa-tape-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.7" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="sa-tape-mask">
          <rect width="34" height="72" fill="url(#sa-tape-fade)" />
        </mask>
      </defs>
      <g mask="url(#sa-tape-mask)">
        <line x1="31" y1="0" x2="31" y2="72" className="sa-tape__spine" />
        {ticks.map((t) => (
          <line key={t.key} x1={t.major ? 17 : 23} y1={t.y} x2="31" y2={t.y} className={t.major ? 'sa-tape__major' : 'sa-tape__minor'} />
        ))}
      </g>
      <path d="M2 36 9 31.5v9z" className="sa-tape__pointer" />
      <line x1="9" y1="36" x2="31" y2="36" className="sa-tape__index" />
    </svg>
  );
}

/** A small attitude indicator: the horizon rides the five-minute move. */
function AttitudeBall({ change }: { change: number }) {
  const shift = pitchFor(change) * 0.62;
  return (
    <svg viewBox="0 0 52 52" className="sa-ball" aria-hidden focusable="false">
      <defs>
        <clipPath id="sa-ball-clip">
          <circle cx="26" cy="26" r="21" />
        </clipPath>
        <linearGradient id="sa-ball-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0E5FB8" />
          <stop offset="1" stopColor="#58B8F0" />
        </linearGradient>
        <linearGradient id="sa-ball-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6A4A30" />
          <stop offset="1" stopColor="#3B2717" />
        </linearGradient>
      </defs>
      <g clipPath="url(#sa-ball-clip)">
        <g className="sa-ball__world" style={{ transform: `translateY(${shift.toFixed(2)}px)` }}>
          <rect x="-10" y="-40" width="72" height="66" fill="url(#sa-ball-sky)" />
          <rect x="-10" y="26" width="72" height="66" fill="url(#sa-ball-ground)" />
          <line x1="-10" y1="26" x2="62" y2="26" className="sa-ball__horizon" />
          {[-10, 10].map((deg) => (
            <line key={deg} x1="19" x2="33" y1={26 - deg * 0.62} y2={26 - deg * 0.62} className="sa-ball__rung" />
          ))}
        </g>
      </g>
      <circle cx="26" cy="26" r="21" className="sa-ball__rim" />
      <path d="M13 26h8l2.5 3 2.5-3 2.5 3 2.5-3h8" className="sa-ball__plane" />
    </svg>
  );
}

/** The sky outside, seen through a cabin window: its own colours, sun or moon, and cloud. */
function Porthole({ sky }: { sky: SkyState }) {
  const { palette, elevation, sunX, cloudCover, weather } = sky;
  const up = elevation > -4;
  const discX = 22 + Math.max(-1, Math.min(1, sunX)) * 9;
  const discY = up ? 44 - Math.max(0, Math.min(1, (elevation + 4) / 50)) * 30 : 17;
  const clouds = weather === 'clear' ? 0 : Math.max(0.25, Math.min(1, cloudCover));
  const grey = weather === 'overcast' || weather === 'rain' || weather === 'storm' || weather === 'fog';
  const wet = weather === 'rain' || weather === 'storm';
  return (
    <svg viewBox="0 0 44 58" className="sa-window" aria-hidden focusable="false">
      <defs>
        <linearGradient id="sa-window-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={palette.top} />
          <stop offset="0.55" stopColor={palette.mid} />
          <stop offset="1" stopColor={palette.horizon} />
        </linearGradient>
        <clipPath id="sa-window-clip">
          <rect x="7" y="6" width="30" height="46" rx="14" />
        </clipPath>
      </defs>
      <rect x="3" y="2" width="38" height="54" rx="18" className="sa-window__bezel" />
      <g clipPath="url(#sa-window-clip)">
        <rect x="7" y="6" width="30" height="46" fill="url(#sa-window-sky)" />
        {palette.stars > 0.3 &&
          [[13, 13], [28, 11], [20, 20], [31, 24], [12, 27]].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="0.7" fill="#fff" opacity={0.35 + palette.stars * 0.5} />
          ))}
        <circle cx={discX} cy={discY} r={up ? 4.2 : 3.4} fill={palette.disc} opacity={up ? 1 : 0.9} />
        {up && <circle cx={discX} cy={discY} r="8" fill={palette.glow} opacity="0.35" />}
        {clouds > 0 && (
          <g fill={grey ? '#B9C2CF' : '#FFFFFF'} opacity={0.35 + clouds * 0.5}>
            <ellipse cx="15" cy="39" rx="9" ry="3.6" />
            <ellipse cx="29" cy="33" rx="8" ry="3" />
            {clouds > 0.6 && <ellipse cx="22" cy="45" rx="12" ry="4" />}
          </g>
        )}
        {wet && (
          <g className="sa-window__rain">
            {[12, 18, 24, 30].map((x) => <line key={x} x1={x} y1="20" x2={x - 3} y2="30" />)}
          </g>
        )}
        <path d="M7 25 25 6h7L7 32z" className="sa-window__glare" />
      </g>
    </svg>
  );
}

/* ── The three readings ─────────────────────────────────────────────── */

interface ReadoutProps {
  label: string;
  tag: ReactNode;
  tagLive?: boolean;
  value: string;
  unit?: string;
  sub: string;
  viz: ReactNode;
  wide?: boolean;
}

/* A term and its descriptions, laid out on a grid: a `<dl>` allows a
   wrapper round each group, but nothing between the wrapper and its terms. */
const Readout = ({ label, tag, tagLive, value, unit, sub, viz, wide }: ReadoutProps) => (
  <div className={`sa-readout ${wide ? 'sa-readout--wide' : ''}`}>
    <dt className="sa-readout__label">{label}</dt>
    <dd className={`sa-readout__tag ${tagLive ? 'sa-readout__tag--live' : ''}`}>{tag}</dd>
    {/* Mars is a nine-digit altitude, and on a phone the display is narrower than that at full size. */}
    <dd className={`sa-readout__value ${value.length > 9 ? 'sa-readout__value--long' : ''}`}>
      {value}
      {unit && <span className="sa-readout__unit">{unit}</span>}
    </dd>
    <dd className="sa-readout__sub">{sub}</dd>
    <dd className="sa-readout__viz" aria-hidden>{viz}</dd>
  </div>
);

export function FlightReadouts({ tick, sky }: { tick: FlightTick; sky: SkyState }) {
  const change = tick.change5m;
  const level = Math.abs(change) < 0.05;
  const vs = verticalSpeedFor(change, tick.marketCap);
  const rate = Math.abs(vs);
  const vsFigure =
    rate >= 1_000_000 ? `${(rate / 1_000_000).toFixed(2)}M` : rate >= 10_000 ? `${Math.round(rate / 1000)}K` : Math.round(rate).toLocaleString('en-US');
  // In feet a minute; "fpm" on a phone, where the tag shares its line with the tape.
  const vsText = (
    <>
      {vs >= 0 ? '+' : '−'}
      {vsFigure}
      <span className="sa-readout__unit-long"> ft/min</span>
      <span className="sa-readout__unit-short"> fpm</span>
    </>
  );
  return (
    <dl className="sa-readouts">
      <Readout
        label="Altitude"
        tag={vsText}
        value={formatFeet(tick.marketCap)}
        unit="ft"
        sub={`${formatCap(tick.marketCap)} market cap`}
        viz={<AltitudeTape feet={tick.marketCap} />}
      />
      <Readout
        label="5m"
        tag={phaseFor(change)}
        value={formatChange(change)}
        sub={level ? 'Level flight' : change > 0 ? 'Climbing' : 'Descending'}
        viz={<AttitudeBall change={change} />}
      />
      <Readout
        label="Outside"
        tag={sky.live ? 'Live' : 'Modelled'}
        tagLive={sky.live}
        value={sky.label}
        sub={sky.live ? 'Live weather where you are' : 'Modelled weather'}
        viz={<Porthole sky={sky} />}
        wide
      />
    </dl>
  );
}

/* ── The route ──────────────────────────────────────────────────────────
   The climb meter, drawn as the moving map on a seatback screen: every
   level on one line, the ground covered lit, the aircraft where it is.

   Mars is the furthest the aircraft flies so far, not the end of the line.
   The route carries on past it, dashed, to a stop nobody has named yet,
   and trails off the edge of the screen beyond that. */

const STOPS: { band: FlightBand; name: string; price: string; short?: string }[] = [
  { band: 'atmosphere', name: 'Weather', price: 'Under $1M', short: '<$1M' },
  { band: 'above-clouds', name: 'Clouds', price: '$1M' },
  { band: 'space', name: 'Space', price: '$10M' },
  { band: 'moon', name: 'Moon', price: '$50M' },
  { band: 'mars', name: 'Mars', price: '$100M' },
];
/** Stops along the line: every known level, and the one after Mars. */
const SPAN = STOPS.length;
const stopAt = (i: number) => `${(i / SPAN) * 100}%`;

export function ClimbRoute({ band }: { band: BandState }) {
  const at = STOPS.findIndex((s) => s.band === band.band);
  const beyond = at === STOPS.length - 1;
  const along = beyond ? (STOPS.length - 1) / SPAN : (at + Math.max(0, Math.min(1, band.toNext))) / SPAN;
  const pct = `${(along * 100).toFixed(2)}%`;
  const toGo = Math.round(Math.max(0, Math.min(1, band.toNext)) * 100);
  const state = (i: number) => (i < at ? 'is-passed' : i === at ? 'is-here' : i === at + 1 ? 'is-next' : '');
  return (
    <div className="sa-route">
      <div className="sa-route__head">
        <span className="sa-route__title">Flight progress</span>
        <span className="sa-route__next">
          {band.next ? (
            <>
              Next stop <b>{band.next}</b>
              <span className="sa-route__pct">{toGo}%</span>
            </>
          ) : (
            <>
              Next stop <b>Beyond Mars</b>
              <span className="sa-route__pct" aria-hidden>???</span>
            </>
          )}
        </span>
      </div>
      <div className="sa-route__track" aria-hidden>
        <span className="sa-route__line" style={{ right: `${100 / SPAN}%` }} />
        <span className="sa-route__beyond" style={{ left: stopAt(STOPS.length - 1) }} />
        <span className="sa-route__done" style={{ width: pct }} />
        {STOPS.map((s, i) => (
          <span key={s.band} className={`sa-route__stop ${state(i)}`} style={{ left: stopAt(i) }} />
        ))}
        <span className={`sa-route__stop is-unknown ${state(STOPS.length)}`} style={{ left: stopAt(STOPS.length) }} />
        <span className="sa-route__plane" style={{ left: pct }}>
          <DeckIcon name="plane" />
        </span>
      </div>
      <ol className="sa-route__stops" aria-label="Levels">
        {STOPS.map((s, i) => (
          <li key={s.band} className={state(i)} aria-current={i === at ? 'step' : undefined}>
            <span className="sa-route__name">{s.name}</span>
            <span className="sa-route__price">
              {s.short ? (
                <>
                  <span className="sa-route__price-full">{s.price}</span>
                  <span className="sa-route__price-short">{s.short}</span>
                </>
              ) : (
                s.price
              )}
            </span>
          </li>
        ))}
        <li className={`is-unknown ${state(STOPS.length)}`}>
          <span className="sa-route__name">Beyond</span>
          <span className="sa-route__price">
            <span aria-hidden>???</span>
            <span className="sr-only">Still to come</span>
          </span>
        </li>
      </ol>
    </div>
  );
}
