import { useMemo } from 'react';
import type { CabinZone } from '../content/cabin';
import { LAVATORY_NOTE, LAVATORY_SEATS } from '../content/cabin';
import { formatFeet } from '../lib/flightModel';

/**
 * The boarding pass.
 *
 * It is the screenshot — the one part of the page that leaves the page — so it
 * is built as a real stub: gradient edge, perforated tear line punched through
 * with notches, and a barcode drawn from the seat itself so no two passes look
 * alike. The altitude printed on it is the one you boarded at, not the live
 * one, which is what makes it worth keeping.
 */

interface BoardingPassProps {
  passenger: string;
  seat: string | null;
  zone: CabinZone | null;
  boardedAt: number | null;
}

/** A stable barcode for a seat — same seat, same bars, every render. */
function useBarcode(seed: string) {
  return useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const bars: { x: number; w: number }[] = [];
    let x = 0;
    for (let i = 0; i < 78 && x < 300; i++) {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      const w = 1 + ((h >>> 8) % 3);
      bars.push({ x, w });
      x += w + 1 + ((h >>> 16) % 3);
    }
    return bars;
  }, [seed]);
}

const Field = ({ label, value, big }: { label: string; value: string; big?: boolean }) => (
  <div className="min-w-0">
    <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-blue-100/40">{label}</p>
    <p
      className={`font-heading mt-1 truncate text-white ${big ? 'text-4xl leading-none' : 'text-xl leading-tight'}`}
      title={value}
    >
      {value}
    </p>
  </div>
);

const BoardingPass = ({ passenger, seat, zone, boardedAt }: BoardingPassProps) => {
  const bars = useBarcode(seat ?? 'STANDBY');
  const lavatory = seat !== null && (LAVATORY_SEATS as readonly string[]).includes(seat);

  const note = !seat
    ? 'No seat claimed. You are on the standby list.'
    : lavatory
      ? LAVATORY_NOTE
      : (zone?.perk ?? '');

  return (
    <div className="sa-shine bg-gradient-to-br from-seat-amber/70 via-seat-edge/50 to-seat-cyan/60 p-px">
      <div className="relative bg-[#141821]">
        {/* Upper stub */}
        <div className="px-5 pb-5 pt-5">
          <div className="flex items-center gap-2.5">
            <svg viewBox="0 0 24 24" className="h-5 w-5 flex-none" aria-hidden>
              <path
                d="M12 1 L13.6 9.4 L23 13.6 L23 15.6 L13.6 13.2 L13.2 19.6 L16.6 22 L16.6 23 L12 21.4 L7.4 23 L7.4 22 L10.8 19.6 L10.4 13.2 L1 15.6 L1 13.6 L10.4 9.4 Z"
                fill="#FFB300"
              />
            </svg>
            <p className="font-heading text-lg tracking-tight">
              <span className="text-seat-amber">SEAT</span>{' '}
              <span className="text-seat-cyan">AIRWAYS</span>
            </p>
            <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-blue-100/35">Boarding pass</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Passenger" value={passenger} />
            <Field label="Flight" value="FL350" />
            <Field label="Seat" value={seat ?? '—'} big />
            <Field label="Class" value={zone?.className ?? 'STANDBY'} />
            <Field label="Boarding group" value={zone?.group ?? '—'} />
            <Field label="Boarded at" value={boardedAt === null ? '—' : `${formatFeet(boardedAt)} FT`} />
          </div>
        </div>

        {/* Tear line, punched through both edges */}
        <div className="relative">
          <span
            aria-hidden
            className="absolute -left-[9px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 bg-seat-night"
            style={{ borderRadius: '9999px' }}
          />
          <span
            aria-hidden
            className="absolute -right-[9px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 bg-seat-night"
            style={{ borderRadius: '9999px' }}
          />
          <div
            aria-hidden
            className="mx-4 h-px"
            style={{
              background:
                'repeating-linear-gradient(90deg, rgba(52,237,243,0.45) 0 7px, transparent 7px 14px)',
            }}
          />
        </div>

        {/* Lower stub */}
        <div className="px-5 pb-5 pt-4">
          <svg viewBox="0 0 300 40" className="block h-9 w-full" aria-hidden preserveAspectRatio="none">
            {bars.map((b, i) => (
              <rect key={i} x={b.x} y="0" width={b.w} height="40" fill="#DDE8FF" opacity={0.55 + (i % 3) * 0.15} />
            ))}
          </svg>
          <p className="mt-3 text-[11.5px] leading-relaxed text-blue-100/55">{note}</p>
        </div>
      </div>
    </div>
  );
};

export default BoardingPass;
