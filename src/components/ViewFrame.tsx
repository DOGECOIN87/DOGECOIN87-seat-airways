import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react';

/**
 * The window you look through.
 *
 * Wraps any view in zoom and pan: wheel or pinch to zoom about the pointer,
 * drag to move once you are in past 1×, and buttons and keys for everyone not
 * using a mouse. Zoom is a transform on a wrapper rather than anything the
 * views know about, so the SVG inside stays vector-sharp all the way in and no
 * view has to implement this twice.
 */

const MIN = 1;
const MAX = 4;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

interface ViewFrameProps {
  children: ReactNode;
  /** Announced to screen readers, and shown in the corner badge. */
  label: string;
  /** Right-hand chrome, e.g. the walk-through controls. */
  actions?: ReactNode;
  /**
   * Called when the viewer keeps zooming out at the minimum — the gesture for
   * leaving the cabin altogether and looking at the whole aircraft. Omitted
   * on the exterior view itself, where there is nowhere further out to go.
   */
  onZoomOutBeyond?: () => void;
  /** Hint shown on the zoom-out button when that will pop you outside. */
  zoomOutHint?: string;
}

const ViewFrame = ({ children, label, actions, onZoomOutBeyond, zoomOutHint }: ViewFrameProps) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [full, setFull] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  /* Active pointers, so a two-finger pinch can be told from a one-finger drag. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const dragFrom = useRef<{ x: number; y: number; pan: { x: number; y: number } } | null>(null);

  /** Keep the view inside its frame — panning should never reveal the void. */
  const clampPan = useCallback((next: { x: number; y: number }, s: number) => {
    const box = boxRef.current;
    if (!box) return next;
    const maxX = (box.clientWidth * (s - 1)) / 2;
    const maxY = (box.clientHeight * (s - 1)) / 2;
    return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
  }, []);

  /** Zoom about a point, so the thing under the cursor stays under it. */
  const zoomAbout = useCallback(
    (nextScale: number, clientX?: number, clientY?: number) => {
      const box = boxRef.current;
      // Already all the way out and still zooming out: that is the request to
      // leave the aircraft, not a no-op.
      if (nextScale < MIN && scale <= MIN + 0.001 && onZoomOutBeyond) {
        onZoomOutBeyond();
        return;
      }
      const s = clamp(nextScale, MIN, MAX);
      // Both updates are computed from the scale we already have rather than
      // from inside the scale updater: a state updater has to be pure, and
      // nesting one setState inside another means StrictMode runs the pan
      // correction twice in development and once in production.
      const prev = scale;
      if (!box || clientX === undefined || clientY === undefined) {
        setPan((p) => clampPan(p, s));
      } else {
        const rect = box.getBoundingClientRect();
        const ox = clientX - rect.left - rect.width / 2;
        const oy = clientY - rect.top - rect.height / 2;
        setPan((p) => clampPan({ x: ox - ((ox - p.x) * s) / prev, y: oy - ((oy - p.y) * s) / prev }, s));
      }
      setScale(s);
    },
    [clampPan, scale, onZoomOutBeyond],
  );

  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    // Preserve ordinary page scrolling. Pinch/ctrl-wheel is an intentional
    // camera gesture; every other wheel movement should get the viewer to the
    // next section instead of trapping them in the scene.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoomAbout(scale * (e.deltaY < 0 ? 1.14 : 1 / 1.14), e.clientX, e.clientY);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      dragFrom.current = null;
      return;
    }
    if (scale > 1) {
      dragFrom.current = { x: e.clientX, y: e.clientY, pan };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAbout((pinchStart.current.scale * dist) / pinchStart.current.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const from = dragFrom.current;
    if (!from) return;
    setPan(clampPan({ x: from.pan.x + (e.clientX - from.x), y: from.pan.y + (e.clientY - from.y) }, scale));
  };

  const endPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) dragFrom.current = null;
  };

  /* Full screen is a modal-ish state: hold the page still behind it, and
     let Escape out the way every other overlay does. */
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [full]);

  /* Wheel has to be a non-passive native listener to be preventable. */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const block = (e: WheelEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.deltaY) e.preventDefault();
    };
    box.addEventListener('wheel', block, { passive: false });
    return () => box.removeEventListener('wheel', block);
  }, []);

  const reset = () => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 40;
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAbout(scale * 1.25); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAbout(scale / 1.25); }
    else if (e.key === '0') { e.preventDefault(); reset(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setPan((p) => clampPan({ ...p, x: p.x + step }, scale)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setPan((p) => clampPan({ ...p, x: p.x - step }, scale)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPan((p) => clampPan({ ...p, y: p.y + step }, scale)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setPan((p) => clampPan({ ...p, y: p.y - step }, scale)); }
  };

  const zoomed = scale > 1.001;

  return (
    <div className={full ? 'sd-full fixed inset-0 z-[60] flex flex-col gap-2 bg-[#05070F] p-3' : 'sd-viewframe relative'}>
      <div
        ref={boxRef}
        tabIndex={0}
        role="group"
        aria-label={`${label}. Zoom with the plus and minus keys, pan with the arrow keys, zero to reset.`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onKeyDown={onKeyDown}
        className={`sd-glass relative overflow-hidden ${full ? 'min-h-0 flex-1' : ''} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#00C9F1] ${
          zoomed ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
        style={{ touchAction: 'none' }}
      >
        <div
          className="origin-center"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transition: dragFrom.current || pinchStart.current ? 'none' : 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {children}
        </div>

        {/* Keep frame context away from the view's own bottom telemetry. */}
        {/* The view draws its own callsign at the top left, so this badge is
            capped at a share of the width and allowed to wrap rather than
            run into it — on a phone the two were colliding. */}
        <p className="pointer-events-none absolute right-3 top-3 max-w-[46%] rounded-2xl border border-white/12 bg-black/55 px-2.5 py-1 text-right text-[11px] font-bold uppercase leading-tight tracking-[0.16em] text-[#7FE3F7] backdrop-blur-sm sm:max-w-[60%] sm:px-3 sm:text-[11px] sm:tracking-[0.18em]">
          {label}
        </p>
      </div>

      {/* Chrome. On a narrow screen this scrolls sideways rather than
          stacking four rows deep and pushing the view off the top. */}
      <div className="sd-chrome sd-controls mt-3 flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
        <div className="flex shrink-0 items-center gap-1.5" role="group" aria-label="Zoom">
          <button
            type="button"
            onClick={() => zoomAbout(scale / 1.25)}
            disabled={scale <= MIN + 0.001 && !onZoomOutBeyond}
            aria-label={scale <= MIN + 0.001 && zoomOutHint ? zoomOutHint : 'Zoom out'}
            title={scale <= MIN + 0.001 && zoomOutHint ? zoomOutHint : undefined}
            className="ui-round"
          >
            −
          </button>
          <span className="w-14 shrink-0 text-center text-[11px] tabular-nums text-ui-faint">{scale.toFixed(1)}×</span>
          <button
            type="button"
            onClick={() => zoomAbout(scale * 1.25)}
            disabled={scale >= MAX - 0.001}
            aria-label="Zoom in"
            className="ui-round"
          >
            +
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!zoomed && pan.x === 0 && pan.y === 0}
            className="ui-pill ml-1"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            aria-pressed={full}
            className="ui-pill ml-1"
          >
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>
        {actions}
      </div>
    </div>
  );
};

export default ViewFrame;
