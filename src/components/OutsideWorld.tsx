import { forwardRef, useMemo, type CSSProperties } from 'react';
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
  /**
   * How much of the ground below is open water, 0–1, from the shared biome
   * clock — so this window crosses the coast at the same moment as the 3D
   * scene beside it.
   */
  ocean?: number;
  /** Half-width the scene must still cover when banked hard over. */
  spread?: number;
  /**
   * Seconds for the ground to travel one field pattern.
   *
   * The landscape is not scenery, it is the only thing on the page that says
   * the aircraft is moving — a static ground under a moving horizon reads as a
   * photograph, however good the drawing is. Lower is faster. Views looking
   * out of the side get the full rate; views looking forward get a much slower
   * one, because from the front the ground should be coming *at* you and a
   * brisk sideways slide would read as a permanent crab.
   */
  driftSeconds?: number;
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

/* Less motion, not a parked aeroplane: the sweep is the scene's one honest
   movement, so the preference slows it well down rather than stopping it. */
const CALM =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const OutsideWorld = forwardRef<SVGGElement, OutsideWorldProps>(
  ({ idPrefix, sky, band, horizonY, ocean = 0, spread = 1400, driftSeconds = 19 }, ref) => {
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
     * The ground, in perspective — and moving.
     *
     * ── Why it is built this way ─────────────────────────────────────────
     * The ground has to do two things that pull against each other: converge
     * on the horizon like a real landscape, and slide past forever without a
     * seam. Tiling a strip and scrolling it gives you the second and loses the
     * first; drawing honest perspective and translating it gives you the first
     * and tears at the edges.
     *
     * Both fall out of one observation. If the fields are drawn as a true
     * perspective grid — every field boundary aimed at the vanishing point,
     * horizontal spacing growing in proportion to depth — then flying sideways
     * is not a translation at all. It is a *shear about the horizon*: every
     * point slides by an amount proportional to how far below the horizon it
     * sits, which is zero at the vanishing point and largest underfoot. And
     * that shear maps the grid exactly onto itself once it has swept one field
     * width. Nothing tears, because the picture after one field is the picture
     * before it.
     *
     * So the whole landscape animates on a single transform, the parallax is a
     * consequence of the geometry rather than something tuned per layer, and
     * the loop is exact. The fields only have to repeat their *colours* every
     * `COLS`, which is why the sweep runs that many fields before restarting.
     */
    const GROUND_H = 400;
    /** Field width at the bottom edge of the drawn ground. */
    const CELL_W = 420;
    /** Fields per colour repeat, and so how far the sweep runs. */
    const COLS = 8;

    const terrain = useMemo(() => {
      const rand = seeded(0x7e44a1);
      const ROWS = 16;
      /** Fields either side of centre, including the sweep's overscan. */
      const REACH = 15;

      /* Depth of each row boundary, 0 at the horizon and 1 at the bottom.
         Crowded toward the horizon, where the eye reads the convergence. */
      const depth = (j: number) => 0.012 + (1 - 0.012) * (j / ROWS) ** 1.8;

      interface Cell { d: string; fill: string; sea: string; o: number }
      const cells: Cell[] = [];

      for (let j = 0; j < ROWS; j++) {
        const u0 = depth(j);
        const u1 = depth(j + 1);
        const y0 = horizonY + GROUND_H * u0;
        const y1 = horizonY + GROUND_H * u1;

        /* One colour period, reused across the row. A working landscape is
           pasture next to plough next to stubble, with the odd reservoir —
           the variety is what makes the ground legible enough to read as
           moving at all. */
        const pattern = Array.from({ length: COLS }, () => {
          const roll = rand();
          return {
            fill:
              roll > 0.94 ? '#3D6E96' // water
                : roll > 0.72 ? '#6E7A46'
                  : roll > 0.46 ? '#4F6B41'
                    : roll > 0.24 ? '#8A7C4E'
                      : '#3F5A3A',
            /* The same cell over open water: swell and current instead of
               pasture and plough. One bright band in eight is a current
               line, which is what gives the sea a direction to move in. */
            sea:
              roll > 0.94 ? '#4E93B8'
                : roll > 0.72 ? '#2E6285'
                  : roll > 0.46 ? '#27567A'
                    : roll > 0.24 ? '#305F82'
                      : '#234E70',
            o: 0.55 + rand() * 0.4,
          };
        });

        for (let k = -REACH; k < REACH; k++) {
          const q = pattern[((k % COLS) + COLS) % COLS];
          // A perspective quad: its sides aim at the vanishing point, so the
          // shear slides it along the grid instead of distorting it.
          const xa = k * CELL_W * u0;
          const xb = (k + 1) * CELL_W * u0;
          const xc = (k + 1) * CELL_W * u1;
          const xd = k * CELL_W * u1;
          cells.push({
            d: `M${xa.toFixed(1)} ${y0.toFixed(1)} L${xb.toFixed(1)} ${y0.toFixed(1)} L${xc.toFixed(1)} ${y1.toFixed(1)} L${xd.toFixed(1)} ${y1.toFixed(1)} Z`,
            fill: q.fill,
            sea: q.sea,
            o: q.o,
          });
        }
      }

      /* Hedgerows: the boundaries themselves, run right down to the bottom.
         They are what actually announce the vanishing point. */
      const hedges: string[] = [];
      for (let k = -REACH; k <= REACH; k++) {
        const u1 = 1;
        hedges.push(`M0 ${horizonY} L${(k * CELL_W * u1).toFixed(1)} ${(horizonY + GROUND_H).toFixed(1)}`);
      }

      return { cells, hedges };
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

    /**
     * Cumulus.
     *
     * Drawn as lobes, but the lobes are not the cloud — a ring of equal
     * circles reads as a cartoon every time, because real cumulus is not
     * symmetric and its edge is not a curve of constant radius. Three things
     * fix it: the lobes get bigger toward the middle so the cloud has a
     * crown and thins to wisps at the ends, the crown rises while the base
     * stays flat (cumulus sits on the condensation level, which is a
     * straight line across the sky), and each lobe is jittered off the grid
     * it was placed on.
     *
     * The softness is in the fills rather than the geometry: every lobe is a
     * radial gradient that reaches zero alpha at its rim, so overlapping
     * lobes build density instead of stacking outlines.
     */
    const clouds = useMemo(() => {
      const rand = seeded(0xc10d5);
      return Array.from({ length: 30 }, () => {
        const n = 7 + Math.floor(rand() * 5);
        const halfWidth = 96 + rand() * 96;
        const puffs = Array.from({ length: n }, (_, i) => {
          const t = n === 1 ? 0.5 : i / (n - 1);
          // 0 at the middle of the cloud, 1 at either end.
          const edge = Math.abs(t - 0.5) * 2;
          const bulk = 1 - edge * edge;
          return {
            dx: (t - 0.5) * 2 * halfWidth + (rand() - 0.5) * 30,
            // The crown piles up in the middle; the base is level.
            dy: -bulk * (16 + rand() * 32) + (rand() - 0.5) * 9,
            r: (26 + bulk * 58) * (0.78 + rand() * 0.44),
          };
        });
        return {
          x: -spread + rand() * w,
          y: (rand() - 0.5) * 150,
          scale: 0.5 + rand() * 1.35,
          puffs,
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

    /**
     * One row's share of the drift.
     *
     * Every layer crosses its own pattern in the same time, so how fast a
     * thing appears to move is decided entirely by how wide its pattern is —
     * which is to say by how far away it is. Distance does the work; there is
     * no per-layer speed to keep in sync.
     */
    /* The sweep is the same shape for every view; only where the horizon sits
       and how fast the ground goes by change. */
    const sweepStyle = useMemo(
      () =>
        ({
          transformOrigin: `0px ${horizonY}px`,
          animationDuration: `${driftSeconds * (CALM ? 2.6 : 1)}s`,
        }) as CSSProperties,
      [horizonY, driftSeconds],
    );

    const atSea = ocean >= 0.5;

    const sunX = sky.sunX * spread * 0.55;
    const inAtmosphere = band.band === 'atmosphere';
    const aboveClouds = band.band === 'above-clouds';
    const inSpace = band.band === 'space';
    const onMoon = band.band === 'moon';
    const night = p.stars > 0.5;

    const deckDrop = 70 + band.progress * 380;
    const earthR = 2800 + band.progress * 6000;


    /** One cumulus: shaded base, body, then the crown catching the sun. */
    const Cloud = ({ c, opacity }: { c: (typeof clouds)[number]; opacity: number }) => (
      <g transform={`translate(${c.x} 0) scale(${c.scale} ${c.scale * 0.82})`} opacity={opacity}>
        <g fill={`url(#${id('cloudbase')})`}>
          {c.puffs.map((q, i) => (
            <ellipse key={i} cx={q.dx} cy={q.dy + q.r * 0.44} rx={q.r * 1.12} ry={q.r * 0.8} />
          ))}
        </g>
        <g fill={`url(#${id('cloudbody')})`}>
          {c.puffs.map((q, i) => (
            <ellipse key={i} cx={q.dx} cy={q.dy} rx={q.r * 1.08} ry={q.r * 0.92} />
          ))}
        </g>
        <g fill={`url(#${id('cloudtop')})`}>
          {c.puffs.map((q, i) => (
            <ellipse key={i} cx={q.dx} cy={q.dy - q.r * 0.34} rx={q.r * 0.74} ry={q.r * 0.5} />
          ))}
        </g>
      </g>
    );

    return (
      <>
        <defs>
          {/* The ground keeps its perspective shape while its contents slide
              through it. */}
          <clipPath id={id('wedge')}>
            <rect x={-spread} y={horizonY} width={w} height={GROUND_H + 900} />
          </clipPath>
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
          {/* Cloud fills reach zero alpha at the rim, so overlapping lobes
              accumulate density rather than drawing their own outlines. */}
          <radialGradient id={id('cloudbody')} cx="0.5" cy="0.42" r="0.56">
            <stop offset="0%" stopColor={night ? '#7B86A4' : '#FFFFFF'} stopOpacity="0.97" />
            <stop offset="54%" stopColor={night ? '#6A748E' : '#F5F9FF'} stopOpacity="0.85" />
            <stop offset="82%" stopColor={night ? '#535C76' : '#DEE9F8'} stopOpacity="0.40" />
            <stop offset="100%" stopColor={night ? '#474F66' : '#CCDAEC'} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('cloudbase')} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor={night ? '#1B2236' : '#8FA5C3'} stopOpacity="0.70" />
            <stop offset="60%" stopColor={night ? '#1B2236' : '#9BAEC7'} stopOpacity="0.36" />
            <stop offset="100%" stopColor={night ? '#1B2236' : '#A7B8CE'} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={id('cloudtop')} cx="0.5" cy="0.45" r="0.5">
            <stop offset="0%" stopColor={night ? '#A6B0CC' : '#FFFFFF'} stopOpacity="0.82" />
            <stop offset="60%" stopColor={night ? '#A6B0CC' : '#FFFFFF'} stopOpacity="0.30" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          {/* Distance washes the ground toward the colour of the air in
              front of it. Without this the fields at the horizon are as
              saturated as the ones underfoot, which is the single loudest
              tell that a landscape was drawn rather than seen. */}
          <linearGradient id={id('groundhaze')} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={p.horizon} stopOpacity="0.88" />
            <stop offset="6%" stopColor={p.horizon} stopOpacity="0.46" />
            <stop offset="15%" stopColor={p.horizon} stopOpacity="0.19" />
            <stop offset="30%" stopColor={p.horizon} stopOpacity="0.05" />
            <stop offset="52%" stopColor={p.horizon} stopOpacity="0" />
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
                /* At night the ground is only towns — and they go past as
                   surely as the fields do. Two copies, one pattern width
                   apart, so the loop has somewhere to come from. */
                <g clipPath={`url(#${id('wedge')})`}>
                 {[0, COLS * CELL_W].map((offset) => (
                  <g key={offset} className="sa-sweep" style={sweepStyle}>
                   <g transform={`translate(${offset} 0)`}>
                  {cities.map((c, i) => {
                    /* Over the sea a town becomes a ship: one light, maybe
                       two, and no glow over it — most of them gone entirely,
                       because the dark is the point of a night crossing. */
                    if (atSea && i % 3 !== 0) return null;
                    const rand = seeded(c.seed);
                    return (
                      <g key={i}>
                        {!atSea && (
                          <ellipse cx={c.cx} cy={c.cy} rx={c.r * 1.6} ry={c.r * 0.44} fill="#FFCE7A" opacity="0.12" />
                        )}
                        {Array.from({ length: atSea ? 1 + (c.n % 2) : c.n }, (_, k) => (
                          <circle
                            key={k}
                            cx={c.cx + (rand() - 0.5) * c.r * (atSea ? 0.4 : 2.4)}
                            cy={c.cy + (rand() - 0.5) * c.r * (atSea ? 0.1 : 0.6)}
                            r={atSea ? 1 + rand() : 0.9 + rand() * 1.8}
                            fill={atSea ? '#DCEBFF' : rand() > 0.75 ? '#BFE0FF' : '#FFD79A'}
                            opacity={0.5 + rand() * 0.5}
                          />
                        ))}
                      </g>
                    );
                  })}
                   </g>
                  </g>
                 ))}
                </g>
              ) : (
                /* By day it is fields — or, over the sea legs, swell — going
                   past. The cells are the same perspective grid either way;
                   only their colours cross the coast, on a slow dissolve. */
                <g clipPath={`url(#${id('wedge')})`}>
                  <g className="sa-sweep" style={sweepStyle}>
                    {terrain.cells.map((c, i) => (
                      <path key={i} className="sa-outside-cell" d={c.d} fill={atSea ? c.sea : c.fill} opacity={c.o} />
                    ))}
                    <g className="sa-outside-cell" stroke={atSea ? '#BFE2EE' : '#2A3D22'} strokeWidth="1.6" opacity={atSea ? 0.15 : 0.32} fill="none">
                      {terrain.hedges.map((d, i) => (
                        <path key={i} d={d} />
                      ))}
                    </g>
                  </g>
                </g>
              )}

              {/* The sea colours the air's floor as well as the cells. */}
              <rect
                className="sa-outside-cell"
                x={-spread}
                y={horizonY}
                width={w}
                height="1300"
                fill={night ? '#0A1A2C' : '#1E4A69'}
                opacity={ocean * (night ? 0.6 : 0.45)}
              />

              {/* Distance, laid over the ground: far fields sink into the
                  colour of the air, near ones keep their contrast. */}
              <rect
                x={-spread}
                y={horizonY}
                width={w}
                height={GROUND_H * 1.6}
                fill={`url(#${id('groundhaze')})`}
              />

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
                  {Array.from({ length: 60 }, (_, i) => (
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
