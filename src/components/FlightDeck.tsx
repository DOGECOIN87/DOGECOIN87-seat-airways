import { useMemo, useRef } from 'react';
import OutsideWorld from './OutsideWorld';
import { useBiome } from '../lib/useBiome';
import type { FlightFeed } from '../lib/flightFeed';
import type { Annunciators } from '../lib/flightModel';
import { formatChange, formatFeet, formatFeetShort, formatVerticalSpeed, phaseFor } from '../lib/flightModel';
import type { BandState } from '../lib/flightModel';
import type { SkyState } from '../lib/sky';
import { paintTape, useAttitude } from '../lib/useAttitude';
import { HANDS_OFF, type ManualControls } from '../lib/manualControls';

/**
 * The flight deck — the view from the jump seat, and what the top two holders
 * get to look at.
 *
 * Overhead panel above, windshield ahead, glare shield and mode control panel
 * beneath it, the captain's PFD and navigation display on the main panel, and
 * the throttle quadrant on the pedestal. Every instrument is reading the same
 * number: the 5m change sets the pitch, its derivative sets the bank, market
 * cap is the altitude, and the annunciators light off the attitude that
 * results.
 *
 * The whole SVG is `aria-hidden` — it is a picture of a cockpit, and reading
 * it out switch by switch would be worse than useless. Every value it shows is
 * published as text by the annunciator strip and readout row beneath it.
 */

const W = 1200;
const H = 800;

const GLASS = { top: 150, bottom: 392 };
const GLASS_CY = (GLASS.top + GLASS.bottom) / 2;
const PFD = { x: 290, y: 452, w: 300, h: 216 };
const ND = { x: 610, y: 452, w: 300, h: 216 };

/** PFD attitude scale, display units per degree. */
const PFD_DEG = 5.4;
/** The world outside moves further for the same degree — it is much closer to life size. */
const WORLD_DEG = 7;

const SPD_STEP = 10;
const SPD_GAP = 26;
const ALT_GAP = 26;

/** Tape step for an altitude, so the labels stay distinct at every scale. */
function altStepFor(alt: number): number {
  const decade = 10 ** Math.floor(Math.log10(Math.max(1000, alt)));
  return Math.max(100, decade / 20);
}
const TICKS = 11;

/* Real flight-deck colours: graphite structure, amber integral lighting, and
   the instrument conventions pilots actually read — cyan/white for guidance,
   magenta for selected values and bugs, amber and red for caution. */
const CYAN = '#3FD8E8';       // primary data on the glass
const AMBER = '#FFB300';      // panel backlighting and advisory legends
const MAGENTA = '#FF57C8';    // selected values, bugs, the roll pointer
const RED = '#FF4438';        // caution legends
const PANEL_DIM = '#7C8497';  // silk-screened labels
const EDGE = '#3E444F';       // panel seams and bezels
const BEZEL = '#05070A';

const MONO = "'JetBrains Mono', monospace";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An overhead annunciator legend block. */
const Legend = ({ x, y, label, on, caution }: { x: number; y: number; label: string; on: boolean; caution?: boolean }) => {
  // Caution legends are red, advisories amber — the convention every
  // overhead panel in service already uses.
  const c = caution ? RED : AMBER;
  return (
    <g>
      <rect x={x} y={y} width="88" height="26" fill={on ? c : '#0D1224'} opacity={on ? 0.22 : 1} />
      <rect x={x} y={y} width="88" height="26" fill="none" stroke={on ? c : '#333842'} strokeWidth="1.2" />
      <text x={x + 44} y={y + 17} fontSize="9" textAnchor="middle" fill={on ? c : '#4A505C'} letterSpacing="0.6" fontWeight="700">
        {label}
      </text>
    </g>
  );
};

interface FlightDeckProps {
  feed: FlightFeed;
  lamps: Annunciators;
  sky: SkyState;
  band: BandState;  /** Hand-flying, if anybody is. This room is inside the aeroplane. */
  controls?: ManualControls;
}

const FlightDeck = ({ feed, lamps, sky, band, controls = HANDS_OFF }: FlightDeckProps) => {
  const biome = useBiome();
  const world = useRef<SVGGElement>(null);
  const adi = useRef<SVGGElement>(null);
  const roll = useRef<SVGGElement>(null);
  const spdTape = useRef<SVGGElement>(null);
  const altTape = useRef<SVGGElement>(null);
  const vsi = useRef<SVGGElement>(null);
  const rose = useRef<SVGGElement>(null);
  const throttle = useRef<SVGGElement>(null);

  const spdLabels = useRef<(SVGTextElement | null)[]>([]);
  const altLabels = useRef<(SVGTextElement | null)[]>([]);

  const spdRead = useRef<SVGTextElement>(null);
  const altRead = useRef<SVGTextElement>(null);
  const vsiRead = useRef<SVGTextElement>(null);
  const hdgRead = useRef<SVGTextElement>(null);
  const mcpSpd = useRef<SVGTextElement>(null);
  const mcpHdg = useRef<SVGTextElement>(null);
  const mcpAlt = useRef<SVGTextElement>(null);
  const chgRead = useRef<SVGTextElement>(null);
  const phaseRead = useRef<SVGTextElement>(null);
  const paxRead = useRef<SVGTextElement>(null);

  const switches = useMemo(() => {
    const rand = seeded(0x71fe);
    return Array.from({ length: 46 }, (_, i) => ({
      x: 118 + (i % 23) * 42,
      y: 34 + Math.floor(i / 23) * 30,
      on: rand() > 0.55,
    }));
  }, []);

  const adiCx = PFD.x + PFD.w / 2;
  const adiCy = PFD.y + 104;
  const ndCx = ND.x + ND.w / 2;
  const ndCy = ND.y + 168;

  const bases = useRef({ spd: NaN, alt: NaN, altStep: 0 });

  useAttitude(feed, (a, tick) => {
    /* Hand-flying rolls the aeroplane, and this is a cockpit *in* it: the
       horizon outside the glass and the one on the instrument both go over,
       because that is what the crew would be looking at. The roll pointer
       does not — it is painted on the aircraft and turns against the
       horizon, which is the whole point of it. */
    const over = a.bank + a.roll;
    world.current?.setAttribute(
      'transform',
      `rotate(${over.toFixed(2)} 0 ${GLASS_CY}) translate(0 ${(a.pitch * WORLD_DEG).toFixed(2)})`,
    );
    adi.current?.setAttribute(
      'transform',
      `rotate(${over.toFixed(2)} ${adiCx} ${adiCy}) translate(0 ${(a.pitch * PFD_DEG).toFixed(2)})`,
    );
    roll.current?.setAttribute('transform', `rotate(${(-over).toFixed(2)} ${adiCx} ${adiCy})`);
    rose.current?.setAttribute('transform', `rotate(${(-a.heading).toFixed(2)} ${ndCx} ${ndCy})`);
    vsi.current?.setAttribute(
      'transform',
      `translate(0 ${(-Math.max(-70, Math.min(70, (a.vs / 4200) * 70))).toFixed(2)})`,
    );
    // Throttles ride forward with speed; full travel is 46 units.
    throttle.current?.setAttribute(
      'transform',
      `translate(0 ${(26 - Math.min(1, Math.max(0, (a.speed - 212) / 260)) * 46).toFixed(2)})`,
    );

    bases.current.spd = paintTape(a.speed, SPD_STEP, SPD_GAP, TICKS, spdTape.current, spdLabels.current, bases.current.spd, (n) => (n < 0 ? '' : String(n)));
    // A changed step invalidates every printed label, so force a relabel.
    const altStep = altStepFor(a.alt);
    if (altStep !== bases.current.altStep) {
      bases.current.altStep = altStep;
      bases.current.alt = NaN;
    }
    bases.current.alt = paintTape(a.alt, altStep, ALT_GAP, TICKS, altTape.current, altLabels.current, bases.current.alt, (n) => (n < 0 ? '' : formatFeetShort(n)));

    const hdg = String(Math.round(a.heading)).padStart(3, '0');
    if (spdRead.current) spdRead.current.textContent = String(Math.round(a.speed));
    if (altRead.current) altRead.current.textContent = formatFeetShort(a.alt);
    if (vsiRead.current) vsiRead.current.textContent = formatVerticalSpeed(a.vs);
    if (hdgRead.current) hdgRead.current.textContent = hdg;
    if (mcpSpd.current) mcpSpd.current.textContent = String(Math.round(a.speed));
    if (mcpHdg.current) mcpHdg.current.textContent = hdg;
    if (mcpAlt.current) mcpAlt.current.textContent = formatFeet(a.alt);  // the MCP window is wide enough for all of it
    if (tick) {
      if (chgRead.current) {
        chgRead.current.textContent = formatChange(tick.change5m);
        chgRead.current.setAttribute('fill', tick.change5m >= 0 ? '#5BE86B' : RED);
      }
      if (phaseRead.current) phaseRead.current.textContent = phaseFor(tick.change5m);
      if (paxRead.current) paxRead.current.textContent = tick.holders.toLocaleString('en-US');
    }
  }, controls);

  const ticks = Array.from({ length: TICKS }, (_, i) => i);
  const half = (TICKS - 1) / 2;

  return (
    <div
      className="sd-view sd-frame sa-hud relative w-full overflow-hidden border border-white/12 bg-[#05070F]"
      
      role="img"
      aria-label="The flight deck of SA350: overhead panel, windshield, and the captain's primary flight and navigation displays. Every reading is driven by the token's 5-minute change, and the values are published as text below."
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="fd-panel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#343A45" />
            <stop offset="42%" stopColor="#23272F" />
            <stop offset="100%" stopColor="#121519" />
          </linearGradient>
          <linearGradient id="fd-overhead" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3A404B" />
            <stop offset="62%" stopColor="#262B33" />
            <stop offset="100%" stopColor="#14171C" />
          </linearGradient>
          <linearGradient id="fd-shield" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0C0E12" />
            <stop offset="52%" stopColor="#20242C" />
            <stop offset="100%" stopColor="#0A0C10" />
          </linearGradient>
          <linearGradient id="fd-seat" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#05070A" />
            <stop offset="60%" stopColor="#14171D" />
            <stop offset="92%" stopColor="#242932" />
            <stop offset="100%" stopColor="#3A404B" />
          </linearGradient>
          <linearGradient id="fd-seat-r" x1="1" y1="0" x2="0" y2="0">
            <stop offset="0%" stopColor="#05070A" />
            <stop offset="60%" stopColor="#14171D" />
            <stop offset="92%" stopColor="#242932" />
            <stop offset="100%" stopColor="#3A404B" />
          </linearGradient>
          <linearGradient id="fd-screen" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#0A0D14" />
            <stop offset="100%" stopColor="#04060A" />
          </linearGradient>
          <radialGradient id="fd-screenglow" cx="0.5" cy="0.4" r="0.75">
            <stop offset="0%" stopColor="#2E6FC4" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2E6FC4" stopOpacity="0" />
          </radialGradient>
          {/* Integral panel lighting: warm, from above, the way a cockpit is lit */}
          <radialGradient id="fd-lightpool" cx="0.5" cy="0" r="0.95">
            <stop offset="0%" stopColor={AMBER} stopOpacity="0.22" />
            <stop offset="55%" stopColor={AMBER} stopOpacity="0.05" />
            <stop offset="100%" stopColor={AMBER} stopOpacity="0" />
          </radialGradient>
          <radialGradient id="fd-screenspill" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#5AA9FF" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#5AA9FF" stopOpacity="0" />
          </radialGradient>

          {/* Two forward panes and two side quarters */}
          <clipPath id="fd-glass">
            <path d={`M206 ${GLASS.top} L588 ${GLASS.top} L588 ${GLASS.bottom} L232 ${GLASS.bottom} Z`} />
            <path d={`M612 ${GLASS.top} L994 ${GLASS.top} L968 ${GLASS.bottom} L612 ${GLASS.bottom} Z`} />
            <path d={`M126 ${GLASS.top + 14} L196 ${GLASS.top} L222 ${GLASS.bottom} L150 ${GLASS.bottom} Z`} />
            <path d={`M1004 ${GLASS.top} L1074 ${GLASS.top + 14} L1050 ${GLASS.bottom} L978 ${GLASS.bottom} Z`} />
          </clipPath>
          <clipPath id="fd-adi"><rect x={PFD.x + 62} y={PFD.y + 22} width={PFD.w - 128} height="164" /></clipPath>
          <clipPath id="fd-spd"><rect x={PFD.x + 6} y={PFD.y + 22} width="54" height="164" /></clipPath>
          <clipPath id="fd-alt"><rect x={PFD.x + PFD.w - 64} y={PFD.y + 22} width="58" height="164" /></clipPath>
          <clipPath id="fd-nd"><rect x={ND.x + 6} y={ND.y + 6} width={ND.w - 12} height={ND.h - 12} /></clipPath>
        </defs>

        {/* ══ OUTSIDE ═══════════════════════════════════════════════════ */}
        <g clipPath="url(#fd-glass)">
          <g transform="translate(600 0)">
            <OutsideWorld ref={world} idPrefix="fd" sky={sky} band={band} ocean={biome.ocean} horizonY={GLASS_CY} spread={1400} driftSeconds={78} />
          </g>
          <rect x="100" y={GLASS.top} width="1000" height={GLASS.bottom - GLASS.top} fill="#0A1424" opacity="0.10" />
          <path d={`M240 ${GLASS.bottom} L420 ${GLASS.top} L470 ${GLASS.top} L290 ${GLASS.bottom} Z`} fill="#ffffff" opacity="0.045" />
          <path d={`M700 ${GLASS.bottom} L840 ${GLASS.top} L868 ${GLASS.top} L728 ${GLASS.bottom} Z`} fill="#ffffff" opacity="0.03" />
        </g>

        <g fill="none" stroke={EDGE} strokeWidth="7">
          <path d={`M206 ${GLASS.top} L588 ${GLASS.top} L588 ${GLASS.bottom} L232 ${GLASS.bottom} Z`} />
          <path d={`M612 ${GLASS.top} L994 ${GLASS.top} L968 ${GLASS.bottom} L612 ${GLASS.bottom} Z`} />
          <path d={`M126 ${GLASS.top + 14} L196 ${GLASS.top} L222 ${GLASS.bottom} L150 ${GLASS.bottom} Z`} />
          <path d={`M1004 ${GLASS.top} L1074 ${GLASS.top + 14} L1050 ${GLASS.bottom} L978 ${GLASS.bottom} Z`} />
        </g>
        <rect x="588" y={GLASS.top - 4} width="24" height={GLASS.bottom - GLASS.top + 8} fill="#31363F" />
        <rect x="596" y={GLASS.top - 4} width="8" height={GLASS.bottom - GLASS.top + 8} fill="#1B1F26" />
        <g stroke="#59606D" strokeWidth="3" fill="none" opacity="0.85">
          <path d={`M300 ${GLASS.bottom} L360 ${GLASS.top + 66}`} />
          <path d={`M900 ${GLASS.bottom} L840 ${GLASS.top + 66}`} />
        </g>

        {/* ══ OVERHEAD PANEL ════════════════════════════════════════════ */}
        <path d={`M0 0 H${W} V132 L1060 ${GLASS.top - 2} H140 L0 132 Z`} fill="url(#fd-overhead)" />
        <rect x="0" y="0" width={W} height="132" fill="url(#fd-lightpool)" />
        <g fill="none" stroke={EDGE} strokeWidth="1.4" opacity="0.75">
          <rect x="96" y="14" width="1008" height="110" />
          <rect x="112" y="24" width="300" height="90" />
          <rect x="788" y="24" width="300" height="90" />
        </g>
        <g>
          {switches.map((s, i) => (
            <g key={i}>
              <rect x={s.x} y={s.y} width="12" height="18" fill="#0B0D11" stroke={EDGE} strokeWidth="0.8" />
              <rect x={s.x + 3} y={s.y + (s.on ? 2 : 9)} width="6" height="7" fill={s.on ? '#8B97B8' : '#4A5470'} />
            </g>
          ))}
        </g>
        <g fill="#0B0D11" stroke={EDGE} strokeWidth="1">
          <circle cx="52" cy="62" r="26" />
          <circle cx="1148" cy="62" r="26" />
        </g>

        {/* Live annunciators — the text equivalents live in the strip below. */}
        <Legend x={452} y={26} label="FASTEN BELT" on={lamps.seatbelt} />
        <Legend x={548} y={26} label="SERVICE" on={lamps.service} />
        <Legend x={452} y={62} label="OXYGEN" on={lamps.oxygen} caution />
        <Legend x={548} y={62} label="BRACE" on={lamps.brace} caution />
        <text x={600} y={112} fontSize="9" textAnchor="middle" fill={PANEL_DIM} letterSpacing="2.5">OVERHEAD</text>

        {/* ══ GLARE SHIELD + MODE CONTROL PANEL ═════════════════════════ */}
        <path d={`M120 ${GLASS.bottom} H1080 L1104 448 H96 Z`} fill="url(#fd-shield)" />
        <rect x="96" y="444" width="1008" height="10" fill="#070B16" />
        {[
          { x: 300, label: 'IAS', node: mcpSpd },
          { x: 520, label: 'HDG', node: mcpHdg },
          { x: 740, label: 'ALT', node: mcpAlt },
        ].map((win) => (
          <g key={win.label}>
            <rect x={win.x} y={GLASS.bottom + 8} width="124" height="34" fill="#05070A" stroke={EDGE} strokeWidth="1.4" />
            <text x={win.x + 8} y={GLASS.bottom + 20} fontSize="8" fill={PANEL_DIM} letterSpacing="1.4">{win.label}</text>
            <text ref={win.node} x={win.x + 116} y={GLASS.bottom + 34} fontSize="19" textAnchor="end" fill={MAGENTA} fontWeight="700" fontFamily={MONO} />
          </g>
        ))}
        <g fill="#1A2135" stroke="#59606D" strokeWidth="1.6">
          {[250, 470, 690, 900].map((x) => <circle key={x} cx={x} cy={GLASS.bottom + 25} r="15" />)}
        </g>
        <g stroke="#B6BCC7" strokeWidth="2.4">
          {[250, 470, 690, 900].map((x) => <line key={x} x1={x} y1={GLASS.bottom + 25} x2={x} y2={GLASS.bottom + 13} />)}
        </g>

        {/* ══ MAIN PANEL ════════════════════════════════════════════════ */}
        <rect x="0" y="450" width={W} height="230" fill="url(#fd-panel)" />
        <g fill={EDGE}>
          {[40, 300, 600, 900, 1160].map((x) => <circle key={x} cx={x} cy="460" r="2.6" />)}
        </g>

        {/* ── Primary flight display ── */}
        <rect x={PFD.x - 8} y={PFD.y - 8} width={PFD.w + 16} height={PFD.h + 16} fill={BEZEL} stroke={EDGE} strokeWidth="1.6" />
        <rect x={PFD.x} y={PFD.y} width={PFD.w} height={PFD.h} fill="url(#fd-screen)" />
        <rect x={PFD.x} y={PFD.y} width={PFD.w} height={PFD.h} fill="url(#fd-screenglow)" />

        <g clipPath="url(#fd-adi)">
          <g ref={adi}>
            <rect x={PFD.x - 200} y={adiCy - 700} width={PFD.w + 400} height="700" fill="#2E7BC4" />
            <rect x={PFD.x - 200} y={adiCy} width={PFD.w + 400} height="700" fill="#8A6636" />
            <rect x={PFD.x - 200} y={adiCy - 1.6} width={PFD.w + 400} height="3.2" fill="#FFFFFF" />
            <g stroke="#FFFFFF" strokeWidth="1.6" fill="#FFFFFF" fontSize="9" fontFamily={MONO}>
              {[-20, -15, -10, -5, 5, 10, 15, 20].map((d) => {
                const y = adiCy - d * PFD_DEG;
                const w = d % 10 === 0 ? 34 : 18;
                return (
                  <g key={d}>
                    <line x1={adiCx - w} y1={y} x2={adiCx - 7} y2={y} />
                    <line x1={adiCx + 7} y1={y} x2={adiCx + w} y2={y} />
                    {d % 10 === 0 && (
                      <>
                        <text x={adiCx - w - 5} y={y + 3.4} textAnchor="end" stroke="none">{Math.abs(d)}</text>
                        <text x={adiCx + w + 5} y={y + 3.4} stroke="none">{Math.abs(d)}</text>
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          </g>
        </g>
        <g stroke="#FFFFFF" strokeWidth="1.4" fill="none" opacity="0.9">
          {[-30, -20, -10, 0, 10, 20, 30].map((d) => {
            const rad = ((d - 90) * Math.PI) / 180;
            return (
              <line
                key={d}
                x1={adiCx + Math.cos(rad) * 78}
                y1={adiCy + Math.sin(rad) * 78}
                x2={adiCx + Math.cos(rad) * (d === 0 ? 68 : 72)}
                y2={adiCy + Math.sin(rad) * (d === 0 ? 68 : 72)}
              />
            );
          })}
        </g>
        <g ref={roll}>
          <path d={`M${adiCx} ${adiCy - 74} l-6 -10 l12 0 Z`} fill={MAGENTA} />
        </g>
        <g stroke={MAGENTA} strokeWidth="2.6" fill="none">
          <path d={`M${adiCx - 42} ${adiCy} h20 l8 9 l8 -9 h20`} />
        </g>
        <circle cx={adiCx} cy={adiCy} r="2.6" fill={MAGENTA} />

        {/* Speed tape */}
        <rect x={PFD.x + 6} y={PFD.y + 22} width="54" height="164" fill="#05070A" opacity="0.75" />
        <g clipPath="url(#fd-spd)" fontFamily={MONO}>
          <g ref={spdTape}>
            {ticks.map((i) => {
              const y = PFD.y + 104 + (i - half) * SPD_GAP;
              return (
                <g key={i}>
                  <line x1={PFD.x + 50} y1={y} x2={PFD.x + 60} y2={y} stroke={CYAN} strokeWidth="1.4" opacity="0.7" />
                  <text ref={(el) => { spdLabels.current[i] = el; }} x={PFD.x + 45} y={y + 4} fontSize="12" textAnchor="end" fill="#E8EDF5" />
                </g>
              );
            })}
          </g>
        </g>
        <path d={`M${PFD.x + 2} ${PFD.y + 92} h56 l10 12 l-10 12 h-56 Z`} fill="#05070A" stroke={CYAN} strokeWidth="1.4" />
        <text ref={spdRead} x={PFD.x + 54} y={PFD.y + 109} fontSize="17" textAnchor="end" fill="#FFFFFF" fontWeight="700" fontFamily={MONO} />
        <text x={PFD.x + 33} y={PFD.y + 16} fontSize="8" textAnchor="middle" fill={PANEL_DIM} letterSpacing="1.2">KNOTS</text>

        {/* Altitude tape */}
        <rect x={PFD.x + PFD.w - 64} y={PFD.y + 22} width="58" height="164" fill="#05070A" opacity="0.75" />
        <g clipPath="url(#fd-alt)" fontFamily={MONO}>
          <g ref={altTape}>
            {ticks.map((i) => {
              const y = PFD.y + 104 + (i - half) * ALT_GAP;
              return (
                <g key={i}>
                  <line x1={PFD.x + PFD.w - 64} y1={y} x2={PFD.x + PFD.w - 54} y2={y} stroke={CYAN} strokeWidth="1.4" opacity="0.7" />
                  <text ref={(el) => { altLabels.current[i] = el; }} x={PFD.x + PFD.w - 50} y={y + 4} fontSize="11" fill="#E8EDF5" />
                </g>
              );
            })}
          </g>
        </g>
        <path d={`M${PFD.x + PFD.w - 72} ${PFD.y + 104} l10 -12 h64 v24 h-64 Z`} fill="#05070A" stroke={CYAN} strokeWidth="1.4" />
        <text ref={altRead} x={PFD.x + PFD.w - 6} y={PFD.y + 109} fontSize="15" textAnchor="end" fill="#FFFFFF" fontWeight="700" fontFamily={MONO} />
        <text x={PFD.x + PFD.w - 35} y={PFD.y + 16} fontSize="8" textAnchor="middle" fill={PANEL_DIM} letterSpacing="1.2">FEET</text>

        {/* Vertical speed */}
        <g stroke={CYAN} opacity="0.4" strokeWidth="1.2">
          {[-2, -1, 0, 1, 2].map((k) => (
            <line key={k} x1={PFD.x + PFD.w - 78} y1={PFD.y + 104 - k * 35} x2={PFD.x + PFD.w - (k === 0 ? 66 : 72)} y2={PFD.y + 104 - k * 35} />
          ))}
        </g>
        <g ref={vsi}>
          <path d={`M${PFD.x + PFD.w - 78} ${PFD.y + 104} l-9 -5 l0 10 Z`} fill={MAGENTA} />
        </g>
        <text ref={vsiRead} x={PFD.x + PFD.w - 84} y={PFD.y + 200} fontSize="10" textAnchor="middle" fill={MAGENTA} fontFamily={MONO} />

        <rect x={adiCx - 26} y={PFD.y + 190} width="52" height="20" fill="#05070A" stroke={CYAN} strokeWidth="1.2" />
        <text ref={hdgRead} x={adiCx} y={PFD.y + 205} fontSize="13" textAnchor="middle" fill="#FFFFFF" fontWeight="700" fontFamily={MONO} />
        <text ref={phaseRead} x={adiCx} y={PFD.y + 16} fontSize="9" textAnchor="middle" fill={CYAN} letterSpacing="1.6" fontWeight="700" />

        {/* ── Navigation display ── */}
        <rect x={ND.x - 8} y={ND.y - 8} width={ND.w + 16} height={ND.h + 16} fill={BEZEL} stroke={EDGE} strokeWidth="1.6" />
        <rect x={ND.x} y={ND.y} width={ND.w} height={ND.h} fill="url(#fd-screen)" />
        <rect x={ND.x} y={ND.y} width={ND.w} height={ND.h} fill="url(#fd-screenglow)" />
        <g clipPath="url(#fd-nd)">
          <g fill="none" stroke={CYAN} strokeWidth="1" opacity="0.28" strokeDasharray="4 6">
            <circle cx={ndCx} cy={ndCy} r="60" />
            <circle cx={ndCx} cy={ndCy} r="112" />
          </g>
          <g ref={rose}>
            <circle cx={ndCx} cy={ndCy} r="150" fill="none" stroke={CYAN} strokeWidth="1.4" opacity="0.55" />
            {Array.from({ length: 36 }, (_, i) => i * 10).map((deg) => {
              const rad = ((deg - 90) * Math.PI) / 180;
              const major = deg % 30 === 0;
              const lx = ndCx + Math.cos(rad) * 126;
              const ly = ndCy + Math.sin(rad) * 126;
              return (
                <g key={deg}>
                  <line
                    x1={ndCx + Math.cos(rad) * 150}
                    y1={ndCy + Math.sin(rad) * 150}
                    x2={ndCx + Math.cos(rad) * (major ? 138 : 144)}
                    y2={ndCy + Math.sin(rad) * (major ? 138 : 144)}
                    stroke={CYAN}
                    strokeWidth={major ? 1.6 : 1}
                    opacity="0.7"
                  />
                  {major && (
                    <text x={lx} y={ly + 3.5} fontSize="10" textAnchor="middle" fill="#E8EDF5" fontFamily={MONO}>
                      {deg === 0 ? 'N' : deg === 90 ? 'E' : deg === 180 ? 'S' : deg === 270 ? 'W' : deg / 10}
                    </text>
                  )}
                </g>
              );
            })}
            <path d={`M${ndCx} ${ndCy} L${ndCx + 18} ${ndCy - 90} L${ndCx - 26} ${ndCy - 168}`} stroke={MAGENTA} strokeWidth="2" fill="none" />
            <g fill={MAGENTA}>
              <path d={`M${ndCx + 18} ${ndCy - 90} l6 6 l-6 6 l-6 -6 Z`} />
              <path d={`M${ndCx - 26} ${ndCy - 168} l6 6 l-6 6 l-6 -6 Z`} />
            </g>
          </g>
          <g stroke="#FFFFFF" strokeWidth="2" fill="none">
            <path d={`M${ndCx} ${ndCy - 12} L${ndCx} ${ndCy + 12} M${ndCx - 11} ${ndCy + 3} L${ndCx + 11} ${ndCy + 3} M${ndCx - 5} ${ndCy + 12} L${ndCx + 5} ${ndCy + 12}`} />
          </g>
        </g>
        <g fontFamily={MONO}>
          <text x={ND.x + 10} y={ND.y + 20} fontSize="9" fill={PANEL_DIM} letterSpacing="1.2">5M</text>
          <text ref={chgRead} x={ND.x + 10} y={ND.y + 42} fontSize="20" fill={CYAN} fontWeight="700" />
          <text x={ND.x + ND.w - 10} y={ND.y + 20} fontSize="9" textAnchor="end" fill={PANEL_DIM} letterSpacing="1.2">SOULS</text>
          <text ref={paxRead} x={ND.x + ND.w - 10} y={ND.y + 40} fontSize="16" textAnchor="end" fill="#E8EDF5" fontWeight="700" />
          <text x={ND.x + 10} y={ND.y + ND.h - 10} fontSize="9" fill={PANEL_DIM} letterSpacing="1.2">SA350 · NONSTOP</text>
        </g>

        {/* Outboard standby instruments */}
        {[{ x: 150, label: 'ENG' }, { x: 1050, label: 'HYD' }].map((col) => (
          <g key={col.label}>
            <rect x={col.x - 62} y="470" width="124" height="180" fill={BEZEL} stroke={EDGE} strokeWidth="1.4" />
            {[0, 1, 2].map((r) => (
              <g key={r}>
                <circle cx={col.x} cy={508 + r * 56} r="22" fill="#0B0D11" stroke={EDGE} strokeWidth="1.2" />
                <line
                  x1={col.x}
                  y1={508 + r * 56}
                  x2={col.x + Math.cos(((r * 47 - 130) * Math.PI) / 180) * 15}
                  y2={508 + r * 56 + Math.sin(((r * 47 - 130) * Math.PI) / 180) * 15}
                  stroke={MAGENTA}
                  strokeWidth="1.8"
                />
              </g>
            ))}
            <text x={col.x} y="486" fontSize="8" textAnchor="middle" fill={PANEL_DIM} letterSpacing="1.4">{col.label}</text>
          </g>
        ))}

        {/* ══ PEDESTAL ══════════════════════════════════════════════════ */}
        <path d="M470 680 H730 L760 800 H440 Z" fill="url(#fd-panel)" stroke={EDGE} strokeWidth="1.6" />
        <rect x="536" y="694" width="128" height="70" fill="#05080F" stroke={EDGE} strokeWidth="1.2" />
        <g ref={throttle}>
          {[566, 634].map((x) => (
            <g key={x}>
              <rect x={x - 7} y="700" width="14" height="58" fill="#59606D" />
              <rect x={x - 15} y="694" width="30" height="20" fill="#B6BCC7" />
              <rect x={x - 15} y="694" width="30" height="6" fill={MAGENTA} />
            </g>
          ))}
        </g>
        <rect x="492" y="700" width="10" height="52" fill={EDGE} />
        <rect x="486" y="716" width="22" height="12" fill="#B6BCC7" />
        <rect x="698" y="700" width="10" height="52" fill={EDGE} />
        <rect x="692" y="736" width="22" height="12" fill="#B6BCC7" />
        <g fontFamily={MONO}>
          <rect x="500" y="772" width="200" height="24" fill="#05070A" stroke={EDGE} strokeWidth="1.2" />
          <text x="512" y="789" fontSize="11" fill={CYAN}>124.850</text>
          <text x="688" y="789" fontSize="11" textAnchor="end" fill={PANEL_DIM}>SEAT TWR</text>
        </g>

        {/* ══ CONTROL COLUMNS ═══════════════════════════════════════════ */}
        {[310, 890].map((cx) => (
          <g key={cx}>
            {/* Column */}
            <path d={`M${cx - 13} 800 L${cx - 9} 716 h18 L${cx + 13} 800 Z`} fill="#232B42" stroke="#59606D" strokeWidth="1.6" />
            {/* Yoke: two horns either side of the hub */}
            <path
              d={`M${cx - 62} 700 h30 a8 8 0 0 1 8 8 v6 h48 v-6 a8 8 0 0 1 8 -8 h30 v26 h-24 v-8 h-76 v8 h-24 Z`}
              fill="#1A2135"
            />
            <path
              d={`M${cx - 62} 700 h30 a8 8 0 0 1 8 8 v6 h48 v-6 a8 8 0 0 1 8 -8 h30 v26 h-24 v-8 h-76 v8 h-24 Z`}
              fill="none"
              stroke="#6B7280"
              strokeWidth="1.8"
            />
            {/* Grip highlights and the trim switches on the horns */}
            <rect x={cx - 58} y="704" width="20" height="6" fill="#B6BCC7" opacity="0.7" />
            <rect x={cx + 38} y="704" width="20" height="6" fill="#B6BCC7" opacity="0.7" />
            <rect x={cx - 8} y="716" width="16" height="8" fill={MAGENTA} opacity="0.7" />
          </g>
        ))}

        {/* ══ SEATS — cropped seat backs, in shadow, framing the panel ══ */}
        {/* Captain's seat, left of frame */}
        <g>
          <path d="M0 470 C 34 442 118 438 158 470 L 176 800 L 0 800 Z" fill="url(#fd-seat)" />
          {/* Headrest, floating clear of the shoulder line */}
          <path d="M18 404 C 50 380 128 380 152 406 L 158 462 C 124 440 50 442 14 462 Z" fill="#0D1220" />
          <path d="M18 404 C 50 380 128 380 152 406 L 158 462 C 124 440 50 442 14 462 Z" fill="none" stroke="#3A404B" strokeWidth="1.4" />
          {/* Inboard bolster, the only edge the panel light reaches */}
          <path d="M142 470 C 156 476 166 496 168 520 L 176 800 L 150 800 Z" fill="#3E444F" opacity="0.5" />
          <path d="M158 470 L 176 800" stroke="#6B7280" strokeWidth="2" opacity="0.5" fill="none" />
          {/* Belt across the back */}
          <path d="M8 566 C 56 548 116 548 166 570" stroke="#39445F" strokeWidth="6" fill="none" opacity="0.55" />
        </g>
        {/* First officer's seat, right of frame */}
        <g>
          <path d={`M${W} 470 C 1166 442 1082 438 1042 470 L 1024 800 L ${W} 800 Z`} fill="url(#fd-seat-r)" />
          <path d="M1182 404 C 1150 380 1072 380 1048 406 L 1042 462 C 1076 440 1150 442 1186 462 Z" fill="#0D1220" />
          <path d="M1182 404 C 1150 380 1072 380 1048 406 L 1042 462 C 1076 440 1150 442 1186 462 Z" fill="none" stroke="#3A404B" strokeWidth="1.4" />
          <path d="M1058 470 C 1044 476 1034 496 1032 520 L 1024 800 L 1050 800 Z" fill="#3E444F" opacity="0.5" />
          <path d="M1042 470 L 1024 800" stroke="#6B7280" strokeWidth="2" opacity="0.5" fill="none" />
          <path d="M1192 566 C 1144 548 1084 548 1034 570" stroke="#39445F" strokeWidth="6" fill="none" opacity="0.55" />
        </g>
        {/* Placards, as they are on every seat on the aircraft */}
        <g>
          <rect x="22" y="636" width="122" height="36" fill="#E8EDF8" transform="rotate(-2 83 654)" />
          <text x="83" y="653" fontSize="8.5" textAnchor="middle" fill="#B3123C" fontWeight="700" transform="rotate(-2 83 654)">BIGGER BAG</text>
          <text x="83" y="665" fontSize="8.5" textAnchor="middle" fill="#B3123C" fontWeight="700" transform="rotate(-2 83 654)">BETTER SEAT</text>
          <rect x="1056" y="636" width="122" height="36" fill="#E8EDF8" transform="rotate(2 1117 654)" />
          <text x="1117" y="653" fontSize="8.5" textAnchor="middle" fill="#B3123C" fontWeight="700" transform="rotate(2 1117 654)">SEATS ARE</text>
          <text x="1117" y="665" fontSize="8.5" textAnchor="middle" fill="#B3123C" fontWeight="700" transform="rotate(2 1117 654)">FINITE</text>
        </g>

        <rect x="0" y="0" width={W} height={H} fill="url(#fd-lightpool)" opacity="0.5" />
      </svg>

      <div aria-hidden className="sa-scanlines pointer-events-none absolute inset-0 opacity-[0.1]" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(125% 105% at 50% 42%, transparent 46%, rgba(3,5,14,0.82) 100%)' }}
      />
    </div>
  );
};

export default FlightDeck;
