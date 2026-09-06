import { forwardRef, useMemo } from 'react';
import type { SkyState } from '../lib/sky';
import type { BandState } from '../lib/flightModel';

/**
 * What is outside the aircraft.
 *
 * Shared by the flight deck's windshield and the cabin's passenger windows, so
 * the two are unmistakably the same flight — same sun in the same place, same
 * weather, same distance off the ground. Each view clips this to its own
 * opening and transforms the returned group to pitch and bank it.
 *
 * Two inputs decide the scene:
 *
 *   `sky`   real time of day and real weather. Only the atmosphere cares.
 *   `band`  how high the token's market cap has taken you. Terrain and cloud
 *           at the bottom, on top of the deck at $1M, a black sky and a curved
 *           Earth at $10M, and the lunar surface at $50M.
 *
 * Everything is drawn from a seed, so the coastline, the fields, the city
 * lights and the cloud tops are the same on every render and do not crawl
 * between frames.
 */

interface OutsideWorldProps {
  idPrefix: string;
  sky: SkyState;
  band: BandState;
  /** Where the horizon sits, in the parent's coordinates, at zero pitch. */
  horizonY: number;
  /** Half-width the scene must still cover when banked hard over. */
  spread?: number;
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Perspective for the ground.
 *
 * `t` runs 0 at the horizon to 1 directly below. Squared, so detail crowds up
 * near the horizon the way it does from a window seat.
 */
const groundY = (horizonY: number, t: number) => horizonY + 1250 * t ** 2.3;

const OutsideWorld = forwardRef<SVGGElement, OutsideWorldProps>(
  ({ idPrefix, sky, band, horizonY, spread = 1400 }, ref) => {
    const p = sky.palette;
    const w = spread * 2;
    const id = (name: string) => `${idPrefix}-${name}`;

    const stars = useMemo(() => {
      const rand = seeded(0x5eaa17);
      return Array.from({ length: 240 }, () => ({
        x: -spread + rand() * w,
        y: horizonY - 1300 + rand() * 1400,
        r: 0.5 + rand() * 1.9,
        o: 0.2 + rand() * 0.8,
      }));
    }, [horizonY, spread, w]);

    /**
     * The ground, in perspective.
     *
     * Laid out as a grid in world space and projected, rather than scattered:
     * horizontal scale falls off with distance exactly as vertical does, so
     * the fields converge on the horizon instead of floating over it. Fourteen
     * rows is enough to read as farmland from altitude without becoming a
     * thousand paths to paint.
     */
    const terrain = useMemo(() => {
      const rand = seeded(0x7e44a1);
      const ROWS = 14;
      const COLS = 13;
      const cells: { d: string; fill: string; o: number }[] = [];

      const px = (k: number, t: number) => k * 300 * t;
      const rowY = (j: number) => groundY(horizonY, (j / ROWS) ** 1.15);

      for (let j = 0; j < ROWS; j++) {
        const t0 = (j / ROWS) ** 1.15 || 0.012;
        const t1 = ((j + 1) / ROWS) ** 1.15;
        const y0 = rowY(j);
        const y1 = rowY(j + 1);
        for (let k = -COLS; k < COLS; k++) {
          const jitter = (rand() - 0.5) * 0.34;
          const x0a = px(k + jitter * 0.3, t0);
          const x1a = px(k + 1 + jitter * 0.3, t0);
          const x0b = px(k + jitter, t1);
          const x1b = px(k + 1 + jitter, t1);
          const roll = rand();
          // A believable mix: mostly crop, some pasture, the odd bare field.
          const fill = roll > 0.72 ? '#6E7A46' : roll > 0.46 ? '#4F6B41' : roll > 0.24 ? '#8A7C4E' : '#3F5A3A';
          cells.push({
            d: `M${x0a} ${y0} L${x1a} ${y0} L${x1b} ${y1} L${x0b} ${y1} Z`,
            fill,
            o: 0.5 + rand() * 0.45,
          });
        }
      }

      // A river, meandering down through the same projection.
      let river = `M${px(-1.2, 0.012)} ${rowY(0)}`;
      for (let j = 1; j <= ROWS; j++) {
        const t = (j / ROWS) ** 1.15;
        river += ` L${px(-1.2 + Math.sin(j * 0.8) * 1.5, t)} ${rowY(j)}`;
      }

      return { cells, river };
    }, [horizonY]);

    /** Towns, for when the ground is only visible as light. */
    const cities = useMemo(() => {
      const rand = seeded(0xc17135);
      return Array.from({ length: 22 }, () => {
        const t = 0.08 + rand() * 0.92;
        return {
          cx: -spread + rand() * w,
          cy: groundY(horizonY, t),
          r: 14 + t * 90,
          n: 6 + Math.floor(rand() * 14),
          seed: Math.floor(rand() * 1e6),
        };
      });
    }, [horizonY, spread, w]);

    /** Cloud puffs: overlapping circles, which is what makes them read as cumulus. */
    const clouds = useMemo(() => {
      const rand = seeded(0xc10d5);
      return Array.from({ length: 30 }, () => {
        const scale = 0.45 + rand() * 1.5;
        return {
          x: -spread + rand() * w,
          y: (rand() - 0.5) * 150,
          scale,
          puffs: Array.from({ length: 5 + Math.floor(rand() * 4) }, () => ({
            dx: (rand() - 0.5) * 260,
            dy: (rand() - 0.5) * 42,
            r: 34 + rand() * 76,
          })),
        };
      });
    }, [spread, w]);

    const craters = useMemo(() => {
      const rand = seeded(0x3300);
      return Array.from({ length: 40 }, () => {
        const t = 0.05 + rand() * 0.95;
        return { x: -spread + rand() * w, y: groundY(horizonY, t), r: 10 + t * 96 };
      });
    }, [horizonY, spread, w]);

    const rain = useMemo(() => {
      const rand = seeded(0x7a17);
      return Array.from({ length: 110 }, () => ({
        x: -spread + rand() * w,
        y: horizonY - 700 + rand() * 1300,
        len: 26 + rand() * 44,
      }));
    }, [horizonY, spread, w]);

    const sunX = sky.sunX * spread * 0.55;
    const inAtmosphere = band.band === 'atmosphere';
    const aboveClouds = band.band === 'above-clouds';
    const inSpace = band.band === 'space';
    const onMoon = band.band === 'moon';
    const night = p.stars > 0.5;

    const deckDrop = 70 + band.progress * 380;
    const earthR = 2800 + band.progress * 6000;


    /** One cumulus, drawn as a cluster with a lit top and a shaded base. */
    const Cloud = ({ c, opacity }: { c: (typeof clouds)[number]; opacity: number }) => (
      <g transform={`translate(${c.x} 0) scale(${c.scale} ${c.scale * 0.8})`} opacity={opacity}>
        <g fill={`url(#${id('cloudshade')})`}>
          {c.puffs.map((q, i) => (
            <circle key={i} cx={q.dx} cy={q.dy + 16} r={q.r} />
          ))}
        </g>
        <g fill={`url(#${id('cloudlit')})`}>
          {c.puffs.map((q, i) => (
            <circle key={i} cx={q.dx} cy={q.dy} r={q.r} />
          ))}
        </g>
      </g>
    );

    return (
      <>
        <defs>
          <linearGradient id={id('sky')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.top} />
            <stop offset="52%" stopColor={p.mid} />
            <stop offset="88%" stopColor={p.horizon} />
            <stop offset="100%" stopColor={p.horizon} />
          </linearGradient>
          <linearGradient id={id('deepsky')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#000000" />
            <stop offset="100%" stopColor="#000105" />
          </linearGradient>
          {/* Clouds and city light belong on the planet, not in front of it */}
          <clipPath id={id('earthclip')}>
            <circle cx="0" cy={horizonY + earthR} r={earthR} />
          </clipPath>
          <clipPath id={id('earthdisc')}>
            <circle cx={spread * 0.09} cy={horizonY - 300} r="86" />
          </clipPath>
          <linearGradient id={id('ground')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.horizon} stopOpacity="0.45" />
            <stop offset="2.5%" stopColor={p.groundNear} />
            <stop offset="100%" stopColor={p.groundFar} />
          </linearGradient>
          <radialGradient id={id('glow')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={p.glow} stopOpacity="0.85" />
            <stop offset="42%" stopColor={p.glow} stopOpacity="0.3" />
            <stop offset="100%" stopColor={p.glow} stopOpacity="0" />
          </radialGradient>
          {/* Haze: the band of thickened air that hides the true horizon */}
          <linearGradient id={id('haze')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.horizon} stopOpacity="0" />
            <stop offset="70%" stopColor={p.horizon} stopOpacity="0.55" />
            <stop offset="100%" stopColor={p.horizon} stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id={id('cloudlit')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={night ? '#8A93B0' : '#FFFFFF'} />
            <stop offset="100%" stopColor={night ? '#4A5474' : '#DCE8F6'} />
          </linearGradient>
          <linearGradient id={id('cloudshade')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={night ? '#2C3450' : '#9DB0C8'} />
            <stop offset="100%" stopColor={night ? '#161C2E' : '#7C90AC'} />
          </linearGradient>
          <radialGradient id={id('rim')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="88%" stopColor="#5AA9FF" stopOpacity="0" />
            <stop offset="96%" stopColor="#5AA9FF" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#BFE0FF" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id('earth')} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#2E6FC4" />
            <stop offset="46%" stopColor="#17457F" />
            <stop offset="100%" stopColor="#061229" />
          </linearGradient>
          <linearGradient id={id('moon')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9A958E" />
            <stop offset="42%" stopColor="#5E5A55" />
            <stop offset="100%" stopColor="#1A1917" />
          </linearGradient>
        </defs>

        <g ref={ref}>
          {/* ── Sky ── */}
          <rect
            x={-spread}
            y={horizonY - 1500}
            width={w}
            height={1500}
            fill={inAtmosphere || aboveClouds ? `url(#${id('sky')})` : `url(#${id('deepsky')})`}
          />
          {/* Altitude darkens the zenith: there is simply less air above you. */}
          {aboveClouds && (
            <rect
              x={-spread}
              y={horizonY - 1500}
              width={w}
              height={1500}
              fill="#020615"
              opacity={0.2 + band.progress * 0.5}
            />
          )}

          <g fill="#FFFFFF">
            {stars.map((s, i) => {
              const show = inSpace || onMoon ? 1 : p.stars;
              if (show < 0.04) return null;
              if (show < 0.5 && i % 3 !== 0) return null;
              return <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={s.o * show} />;
            })}
          </g>

          {/* Sun, and the glare around it */}
          {!onMoon && (
            <g>
              <circle cx={sunX} cy={horizonY - (aboveClouds ? 260 : 20)} r={aboveClouds ? 520 : 600} fill={`url(#${id('glow')})`} />
              <circle cx={sunX} cy={horizonY - (aboveClouds ? 260 : 20)} r={aboveClouds ? 92 : 118} fill={p.disc} opacity="0.28" />
              <circle cx={sunX} cy={horizonY - (aboveClouds ? 260 : 20)} r={aboveClouds ? 44 : 58} fill={p.disc} opacity="0.95" />
              <circle cx={sunX} cy={horizonY - (aboveClouds ? 260 : 20)} r={aboveClouds ? 26 : 34} fill="#FFFFFF" opacity={inSpace ? 1 : 0.9} />
            </g>
          )}

          {/* ══ IN THE WEATHER — below $1M ══════════════════════════════ */}
          {inAtmosphere && (
            <>
              <rect x={-spread} y={horizonY} width={w} height="1300" fill={`url(#${id('ground')})`} />

              {night ? (
                /* At night the ground is only towns. */
                <g>
                  {cities.map((c, i) => {
                    const rand = seeded(c.seed);
                    return (
                      <g key={i}>
                        <ellipse cx={c.cx} cy={c.cy} rx={c.r * 1.6} ry={c.r * 0.44} fill="#FFCE7A" opacity="0.12" />
                        {Array.from({ length: c.n }, (_, k) => (
                          <circle
                            key={k}
                            cx={c.cx + (rand() - 0.5) * c.r * 2.4}
                            cy={c.cy + (rand() - 0.5) * c.r * 0.6}
                            r={0.9 + rand() * 1.8}
                            fill={rand() > 0.75 ? '#BFE0FF' : '#FFD79A'}
                            opacity={0.5 + rand() * 0.5}
                          />
                        ))}
                      </g>
                    );
                  })}
                </g>
              ) : (
                /* By day it is fields, water and roads. */
                <g>
                  {terrain.cells.map((c, i) => (
                    <path key={i} d={c.d} fill={c.fill} opacity={c.o} />
                  ))}
                  <path d={terrain.river} stroke="#3D6E96" strokeWidth="14" fill="none" opacity="0.55" strokeLinejoin="round" />
                  <path d={terrain.river} stroke="#7FB4D8" strokeWidth="4" fill="none" opacity="0.4" strokeLinejoin="round" />
                </g>
              )}

              {/* Haze thickens toward the horizon, as it really does */}
              <rect x={-spread} y={horizonY - 330} width={w} height="330" fill={`url(#${id('haze')})`} />
              <rect x={-spread} y={horizonY - 2} width={w} height="3" fill={p.horizon} opacity="0.9" />

              {/* Cloud you are flying among, thinning as you climb through it */}
              {sky.cloudCover > 0.1 && (
                <g>
                  {clouds.slice(0, Math.round(sky.cloudCover * 30)).map((c, i) => (
                    <g key={i} transform={`translate(0 ${horizonY - 150 - band.progress * 280 + c.y})`}>
                      <Cloud c={c} opacity={0.55 + sky.cloudCover * 0.45} />
                    </g>
                  ))}
                </g>
              )}

              {(sky.weather === 'rain' || sky.weather === 'storm' || sky.weather === 'snow') && (
                <g
                  stroke={sky.weather === 'snow' ? '#FFFFFF' : '#C9E4FF'}
                  strokeWidth={sky.weather === 'snow' ? 3 : 1.5}
                  strokeLinecap="round"
                  opacity={sky.weather === 'snow' ? 0.7 : 0.4}
                >
                  {rain.map((r, i) => (
                    <line
                      key={i}
                      x1={r.x}
                      y1={r.y}
                      x2={r.x - (sky.weather === 'snow' ? 3 : 15)}
                      y2={r.y + (sky.weather === 'snow' ? 4 : r.len)}
                    />
                  ))}
                </g>
              )}
              {(sky.weather === 'fog' || sky.weather === 'overcast') && (
                <rect
                  x={-spread}
                  y={horizonY - 800}
                  width={w}
                  height="1700"
                  fill={night ? '#141A2C' : '#B9C6D6'}
                  opacity={sky.weather === 'fog' ? 0.55 : 0.26}
                />
              )}
            </>
          )}

          {/* ══ ABOVE THE CLOUDS — $1M ══════════════════════════════════ */}
          {aboveClouds && (
            <>
              {/* The air between you and the deck. Without this the page
                  background showed through as a dark band under the sky. */}
              <rect x={-spread} y={horizonY - 4} width={w} height={deckDrop + 8} fill={p.horizon} />
              {/* An unbroken deck, falling further away as you climb */}
              <rect x={-spread} y={horizonY + deckDrop} width={w} height="1300" fill={night ? '#2A3450' : '#E9F1FA'} />
              <g>
                {clouds.map((c, i) => (
                  <g key={i} transform={`translate(0 ${horizonY + deckDrop + c.y * 0.45})`}>
                    <Cloud c={c} opacity={0.95} />
                  </g>
                ))}
              </g>
              <rect x={-spread} y={horizonY - 2} width={w} height="3" fill={p.horizon} opacity="0.75" />
            </>
          )}

          {/* ══ SPACE — $10M ════════════════════════════════════════════ */}
          {inSpace && (
            <>
              {/* The planet, with everything on it clipped to its disc */}
              <circle cx="0" cy={horizonY + earthR} r={earthR} fill={`url(#${id('earth')})`} />
              <g clipPath={`url(#${id('earthclip')})`}>
                {/* Weather systems, flattened by the viewing angle */}
                <g fill="#FFFFFF">
                  {clouds.map((c, i) => (
                    <g key={i} opacity={0.3 + (i % 5) * 0.1}>
                      {c.puffs.map((q, k) => (
                        <ellipse
                          key={k}
                          cx={c.x * 0.9 + q.dx * 0.7}
                          cy={horizonY + 30 + Math.abs(c.y) * 0.8 + Math.abs(q.dy) * 0.5}
                          rx={q.r * 0.95 * c.scale}
                          ry={q.r * 0.13 * c.scale}
                        />
                      ))}
                    </g>
                  ))}
                </g>
                {/* Land, as ochre under the weather */}
                <g fill="#6B7A4E" opacity="0.4">
                  {terrain.cells.slice(0, 60).map((_cell, i) => (
                    <ellipse key={i} cx={(i - 30) * 46} cy={horizonY + 66 + (i % 7) * 26} rx="72" ry="9" />
                  ))}
                </g>
                {night && (
                  <g fill="#FFD79A" opacity="0.85">
                    {cities.map((c, i) => (
                      <circle key={i} cx={c.cx * 0.72} cy={horizonY + 38 + (i % 6) * 30} r="1.7" />
                    ))}
                  </g>
                )}
              </g>
              {/* The atmosphere, lit on the limb: thin, bright, outside the disc */}
              <circle cx="0" cy={horizonY + earthR} r={earthR + 5} fill="none" stroke="#BFE4FF" strokeWidth="4" opacity="0.9" />
              <circle cx="0" cy={horizonY + earthR} r={earthR + 20} fill="none" stroke="#4E9BEA" strokeWidth="22" opacity="0.28" />
              <circle cx="0" cy={horizonY + earthR} r={earthR + 54} fill="none" stroke="#2C6BC0" strokeWidth="46" opacity="0.1" />
            </>
          )}

          {/* ══ THE MOON — $50M ═════════════════════════════════════════ */}
          {onMoon && (
            <>
              <rect x={-spread} y={horizonY} width={w} height="1300" fill={`url(#${id('moon')})`} />
              {/* Mare — the dark basalt plains that make the moon legible */}
              <g fill="#3B3934" opacity="0.5">
                {craters.slice(0, 7).map((c, i) => (
                  <ellipse key={`m${i}`} cx={c.x * 1.4} cy={c.y} rx={c.r * 4.2} ry={c.r * 0.7} />
                ))}
              </g>
              {craters.map((c, i) => (
                <g key={i}>
                  <ellipse cx={c.x} cy={c.y} rx={c.r} ry={c.r * 0.3} fill="#332F2B" opacity="0.85" />
                  <ellipse cx={c.x} cy={c.y - c.r * 0.07} rx={c.r * 0.9} ry={c.r * 0.25} fill="#B0A99E" opacity="0.4" />
                  <ellipse cx={c.x} cy={c.y + c.r * 0.06} rx={c.r * 0.66} ry={c.r * 0.16} fill="#241F1C" opacity="0.7" />
                </g>
              ))}
              <rect x={-spread} y={horizonY - 3} width={w} height="4" fill="#E4DED2" opacity="0.9" />
              {/* Earthrise, kept inside the narrowest window on the aircraft */}
              <g>
                <circle cx={spread * 0.09} cy={horizonY - 300} r="170" fill="#3E86D8" opacity="0.13" />
                <circle cx={spread * 0.09} cy={horizonY - 300} r="86" fill={`url(#${id('earth')})`} />
                <g clipPath={`url(#${id('earthdisc')})`}>
                  <ellipse cx={spread * 0.09 - 20} cy={horizonY - 326} rx="46" ry="16" fill="#FFFFFF" opacity="0.6" />
                  <ellipse cx={spread * 0.09 + 26} cy={horizonY - 278} rx="34" ry="13" fill="#FFFFFF" opacity="0.45" />
                  <ellipse cx={spread * 0.09 - 6} cy={horizonY - 252} rx="40" ry="11" fill="#6E8A4E" opacity="0.5" />
                </g>
                <circle cx={spread * 0.09} cy={horizonY - 300} r="88" fill="none" stroke="#9FD6FF" strokeWidth="3" opacity="0.55" />
              </g>
            </>
          )}
        </g>
      </>
    );
  },
);

OutsideWorld.displayName = 'OutsideWorld';

export default OutsideWorld;
