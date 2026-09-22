import { useEffect, useRef } from 'react';
import { createWorld, type ViewPose, type WorldHandles } from '../three/WorldScene';
import type { FlightFeed } from '../lib/flightFeed';
import type { BandState } from '../lib/flightModel';
import type { SkyState } from '../lib/sky';
import { useAttitude } from '../lib/useAttitude';
import { HANDS_OFF, type ManualControls } from '../lib/manualControls';
import type { CabinSeat, CabinZone, Facing } from '../content/cabin';

/**
 * The view from a seat, rendered.
 *
 * The camera sits where the seat is, inside cabin geometry, looking at a world
 * that exists — so the window shows what is actually outside it, the seat in
 * front occludes what it really would, and turning your head is a rotation
 * rather than a second drawing. Dragging looks around freely; the head-turn
 * buttons snap to the three positions the page names.
 */

const YAW_FOR: Record<Facing, number> = { left: -64, forward: 0, right: 64 };

/** Seat letter to its place across the cabin: A B C, aisle, D E F. */
const SEAT_INDEX: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

interface CabinView3DProps {
  feed: FlightFeed;
  sky: SkyState;
  band: BandState;
  seat: CabinSeat;
  zone: CabinZone;
  facing: Facing;
  taken: ReadonlySet<string>;
  /** Seat id to the image its holder is running, for the seat-back screens. */
  adverts: Readonly<Record<string, string>>;
  /**
   * What the aeroplane is being told to do, if anybody is telling it.
   *
   * Inverted, this is the window: the cabin comes over with the viewer —
   * the seat in front is still in front — and the ground ends up above the
   * sky outside. `WorldScene` decides that from where the camera is; all
   * this has to do is hand the switches over.
   */
  controls?: ManualControls;
}

const CabinView3D = ({ feed, sky, band, seat, zone, facing, taken, adverts, controls = HANDS_OFF }: CabinView3DProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useRef<WorldHandles | null>(null);
  const pose = useRef<ViewPose>({ seatIndex: 0, row: 1, yaw: 0, id: '1A' });
  /** Free look, added on top of whichever way the buttons are pointing. */
  const drag = useRef({ active: false, x: 0, y: 0, yaw: 0 });
  const latest = useRef({ sky, band });
  latest.current = { sky, band };

  /* Build the scene once; it lives as long as the view does. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let handles: WorldHandles;
    try {
      handles = createWorld(canvas);
    } catch {
      // No WebGL. The page still works; this view simply stays dark.
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

  useEffect(() => {
    world.current?.setAdverts(adverts);
  }, [adverts]);

  /* Where the seat is, and which way the head is turned. */
  useEffect(() => {
    const letter = seat.id.replace(/\d/g, '');
    pose.current.seatIndex = SEAT_INDEX[letter] ?? 0;
    pose.current.row = seat.row ?? 1;
    pose.current.id = seat.id;
    drag.current.yaw = 0;
  }, [seat.id, seat.row]);

  useEffect(() => {
    drag.current.yaw = 0;
  }, [facing]);

  useAttitude(feed, (a) => {
    pose.current.yaw = YAW_FOR[facing] + drag.current.yaw;
    world.current?.render(a, latest.current.sky, latest.current.band, pose.current);
  }, controls);

  /* Only the flaps are read from this; the roll arrives eased on the
     attitude above. Pushed in on change rather than per frame. */
  useEffect(() => {
    world.current?.setControls(controls);
  }, [controls]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current.active = true;
    drag.current.x = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    // A quarter of a degree per pixel: enough to look around a cabin without
    // spinning on the spot.
    drag.current.yaw = Math.max(-70, Math.min(70, drag.current.yaw + (e.clientX - drag.current.x) * -0.25));
    drag.current.x = e.clientX;
  };
  const endDrag = () => {
    drag.current.active = false;
  };

  return (
    <div
      className="sd-view sd-frame relative w-full cursor-grab overflow-hidden active:cursor-grabbing"
      role="img"
      aria-label={`The view from seat ${seat.id} in ${zone.name}, looking ${facing}. Drag to look around.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{ touchAction: 'none' }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {/* Where you are, and how to look around */}
      <p className="pointer-events-none absolute bottom-3 left-3 border border-white/12 bg-[#05070F]/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-seat-amber backdrop-blur-sm">
        {seat.id} · {zone.name}
      </p>
      <p className="pointer-events-none absolute bottom-3 right-3 text-[10px] uppercase tracking-[0.18em] text-white/45">
        Drag to look
      </p>
    </div>
  );
};

export default CabinView3D;
