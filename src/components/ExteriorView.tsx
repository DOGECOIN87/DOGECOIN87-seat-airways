import { useEffect, useRef, useState } from 'react';
import { createWorld, type ViewPose, type WorldHandles } from '../three/WorldScene';
import type { FlightFeed } from '../lib/flightFeed';
import type { BandState } from '../lib/flightModel';
import { formatCap, formatChange } from '../lib/flightModel';
import type { SkyState } from '../lib/sky';
import { useAttitude } from '../lib/useAttitude';
import type { CabinSeat } from '../content/cabin';
import Mark from './Mark';

/**
 * The whole aircraft, from outside.
 *
 * Zoom far enough out of the cabin and you end up here: one plane, everyone in
 * it. This was a hand-drawn SVG of an aeroplane in front of a hand-drawn sky,
 * neither of which was the sky or the aeroplane the cabin windows looked out
 * on. It is now the same scene, seen from a camera parked off the wingtip — so
 * the light, the weather, the hour, the cloud deck and the altitude are not
 * merely consistent with the cabin's, they are the cabin's.
 *
 * The windows are still the point: each one is a row, lit if anybody in that
 * row has taken a seat.
 */

interface ExteriorViewProps {
  feed: FlightFeed;
  sky: SkyState;
  band: BandState;
  taken: ReadonlySet<string>;
  /** The seat on the boarding pass, if one has been claimed. */
  claimed: CabinSeat | null;
  /** Where the walk-through camera is standing. */
  viewing: CabinSeat | null;
}

const ExteriorView = ({ feed, sky, band, taken, claimed, viewing }: ExteriorViewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useRef<WorldHandles | null>(null);
  const capRead = useRef<HTMLSpanElement>(null);
  const chgRead = useRef<HTMLSpanElement>(null);
  const latest = useRef({ sky, band });
  latest.current = { sky, band };

  /** Dragging swings the camera around the aeroplane. */
  const orbit = useRef({ angle: 0, active: false, x: 0 });
  const [webgl, setWebgl] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handles: WorldHandles;
    try {
      handles = createWorld(canvas);
    } catch {
      setWebgl(false);
      return;
    }
    world.current = handles;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      handles.resize(Math.max(1, r.width), Math.max(1, r.height));
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
      handles.dispose();
      world.current = null;
    };
  }, []);

  useEffect(() => {
    world.current?.setOccupancy(taken);
  }, [taken]);

  const pose = useRef<ViewPose>({ seatIndex: 0, row: 1, yaw: 0, id: '1A', exterior: true, orbit: 0 });

  useAttitude(feed, (a, tick) => {
    pose.current.orbit = orbit.current.angle;
    world.current?.render(a, latest.current.sky, latest.current.band, pose.current);
    if (tick) {
      if (capRead.current) capRead.current.textContent = formatCap(tick.marketCap);
      if (chgRead.current) {
        chgRead.current.textContent = formatChange(tick.change24h);
        chgRead.current.style.color = tick.change24h >= 0 ? '#5BE86B' : '#FF5B4E';
      }
    }
  });

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    orbit.current.active = true;
    orbit.current.x = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!orbit.current.active) return;
    orbit.current.angle += (e.clientX - orbit.current.x) * 0.3;
    orbit.current.x = e.clientX;
  };
  const endDrag = () => {
    orbit.current.active = false;
  };

  return (
    <div
      className="sd-view sd-frame sd-frame--wide relative w-full cursor-grab overflow-hidden active:cursor-grabbing"
      role="img"
      aria-label={`SEAT AIRWAYS flight FL350 from outside, ${band.label.toLowerCase()}. Each lit window is a row with passengers in it${
        claimed ? `, and seat ${claimed.id} is yours` : ''
      }. Drag to walk around the aircraft.`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ touchAction: 'none' }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {/* Scrims: the overlay has to stay readable whether it is over a bright
          cloud top or a night ground, and dimming the whole frame to manage
          that would be worse than the problem. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{ background: 'linear-gradient(180deg, rgba(4,7,14,0.62) 0%, rgba(4,7,14,0) 100%)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{ background: 'linear-gradient(0deg, rgba(4,7,14,0.66) 0%, rgba(4,7,14,0) 100%)' }}
      />

      {!webgl && (
        <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-blue-100/60">
          This view needs WebGL, which this browser has turned off. Every reading it shows is in the strip below.
        </p>
      )}

      {/* ── Aircraft plate ──────────────────────────────────────────────
          Identity, not a headline. The page's own headline is directly above
          this frame, and repeating it inside the frame said the same thing
          twice in two type sizes. What belongs here is what an aviation
          photograph is captioned with: which aeroplane, and who is on it. */}
      <div className="pointer-events-none absolute left-5 top-4 flex items-center gap-2.5">
        <Mark size={22} background="none" />
        <span className="font-heading text-[15px] leading-none tracking-normal text-white/90">SA350</span>
        <span aria-hidden className="h-3.5 w-px bg-white/25" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/50">
          Souls on board <span className="tabular-nums text-white/80">{taken.size}</span>
        </span>
      </div>

      {/* ── Readout ── */}
      <div className="pointer-events-none absolute bottom-4 left-5 flex items-end gap-6 border border-white/12 bg-[#05070F]/75 px-4 py-2.5 backdrop-blur-sm">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-blue-100/45">Altitude</p>
          <p className="mt-0.5 font-mono text-xl leading-none text-white">
            <span ref={capRead} />
          </p>
        </div>
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-blue-100/45">24h</p>
          <p className="mt-0.5 font-mono text-base leading-none">
            <span ref={chgRead} />
          </p>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-seat-cyan">{band.label}</p>
      </div>

      {/* Where your seat is, in words — the drawn view is aria-hidden. */}
      <div className="pointer-events-none absolute bottom-4 right-5 text-right">
        {claimed && (
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-seat-amber">Your seat · {claimed.id}</p>
        )}
        {viewing && viewing.id !== claimed?.id && (
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-blue-100/45">
            Camera · {viewing.id}
          </p>
        )}
        <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">Drag to walk around</p>
      </div>
    </div>
  );
};

export default ExteriorView;
