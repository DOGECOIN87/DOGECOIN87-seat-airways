import { CABIN_ZONES, CARGO_HOLD, LAVATORY_SEATS, type ZoneKey } from '../content/cabin';

/**
 * The cabin, drawn as a seat map.
 *
 * Occupancy is decided once by the seeded roll in `flightModel` and handed in,
 * so the aircraft does not reshuffle itself between renders — a seat you were
 * looking at a second ago is still the same seat. The forward cabin runs
 * fuller than the back, which is the premise made visible: the good seats are
 * the scarce ones.
 */

const ACCENT: Record<'cerise' | 'cyan' | 'violet', { line: string; text: string }> = {
  cerise: { line: 'border-seat-amber/45', text: 'text-seat-amber' },
  cyan: { line: 'border-seat-cyan/45', text: 'text-seat-cyan' },
  violet: { line: 'border-seat-edge/60', text: 'text-seat-edge' },
};

interface SeatProps {
  id: string;
  zone: ZoneKey;
  taken: boolean;
  mine: boolean;
  wide?: boolean;
  onClaim: (id: string, zone: ZoneKey) => void;
}

const Seat = ({ id, zone, taken, mine, wide, onClaim }: SeatProps) => {
  const lavatory = (LAVATORY_SEATS as readonly string[]).includes(id);

  const state = mine
    ? 'border-seat-amber bg-seat-amber text-seat-night shadow-[0_0_14px_rgba(247,21,171,0.7)]'
    : taken
      ? 'border-transparent bg-white/[0.17] cursor-not-allowed'
      : zone === 'exit'
        ? 'border-seat-cyan/70 hover:bg-seat-cyan/25 hover:shadow-[0_0_12px_rgba(52,237,243,0.55)]'
        : lavatory
          ? 'border-dashed border-blue-100/35 hover:bg-seat-amber/25 hover:border-seat-amber'
          : 'border-blue-100/25 hover:bg-seat-cyan/25 hover:border-seat-cyan hover:shadow-[0_0_12px_rgba(52,237,243,0.45)]';

  return (
    <button
      type="button"
      disabled={taken}
      aria-pressed={mine}
      aria-label={
        taken
          ? `Seat ${id}, taken`
          : `Claim seat ${id}${lavatory ? ', middle seat by the lavatory, does not recline' : ''}`
      }
      title={lavatory ? 'Middle seat, last row, by the lavatory. Does not recline.' : `Seat ${id}`}
      onClick={() => onClaim(id, zone)}
      className={`relative h-6 flex-none border transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${state} ${
        wide ? 'w-[3.75rem]' : 'w-[1.6rem]'
      }`}
    >
      {/* Headrest — the line that turns a square into a seat. */}
      <span
        aria-hidden
        className={`absolute inset-x-1 top-[3px] h-[2px] ${
          mine ? 'bg-seat-night/45' : taken ? 'bg-white/25' : 'bg-current opacity-30'
        }`}
      />
      {wide && (
        <span className="relative text-[9px] font-bold tracking-[0.1em]">{id}</span>
      )}
    </button>
  );
};

interface SeatMapProps {
  taken: ReadonlySet<string>;
  mine: string | null;
  onClaim: (id: string, zone: ZoneKey) => void;
}

const SeatMap = ({ taken, mine, onClaim }: SeatMapProps) => {
  const free = CABIN_ZONES.reduce(
    (n, zone) =>
      n +
      zone.rows.reduce(
        (rn, row) => rn + [...row.left, ...row.right].filter((c) => !taken.has(row.n === null ? c : `${row.n}${c}`)).length,
        0,
      ),
    0,
  );

  return (
    <div>
      {/* ── Nose ── */}
      <svg viewBox="0 0 320 54" className="block w-full max-w-[420px] mx-auto" aria-hidden>
        <path
          d="M160 2 C205 2 250 22 264 52 L56 52 C70 22 115 2 160 2 Z"
          fill="rgba(8,15,51,0.7)"
          stroke="rgba(52,237,243,0.28)"
          strokeWidth="1.5"
        />
        <path d="M136 30 h48" stroke="rgba(52,237,243,0.4)" strokeWidth="2" />
        <circle cx="160" cy="18" r="3" fill="#FFB300" />
      </svg>

      <div className="mx-auto max-w-[420px] border-x border-white/12 bg-[#141821]/60 backdrop-blur-sm">
        {CABIN_ZONES.map((zone) => {
          const accent = ACCENT[zone.accent];
          return (
            <section key={zone.key} className="border-b border-white/10">
              <header className={`flex items-center gap-2 border-l-2 bg-white/[0.035] px-3.5 py-2 ${accent.line}`}>
                <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${accent.text}`}>{zone.name}</h3>
                <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-blue-100/35">{zone.note}</span>
              </header>

              <div className={`flex flex-col gap-[5px] px-3 py-3 ${zone.key === 'deck' ? 'items-center' : ''}`}>
                {zone.rows.map((row) => (
                  <div key={row.n ?? 'deck'} className="flex items-center justify-center gap-[5px]">
                    {row.n !== null && (
                      <span className="w-5 flex-none text-right text-[10px] tabular-nums text-blue-100/30">{row.n}</span>
                    )}
                    {row.left.map((c) => {
                      const id = row.n === null ? c : `${row.n}${c}`;
                      return (
                        <Seat
                          key={id}
                          id={id}
                          zone={zone.key}
                          taken={taken.has(id)}
                          mine={mine === id}
                          wide={row.n === null}
                          onClaim={onClaim}
                        />
                      );
                    })}
                    <span aria-hidden className="w-4 flex-none" />
                    {row.right.map((c) => {
                      const id = row.n === null ? c : `${row.n}${c}`;
                      return (
                        <Seat
                          key={id}
                          id={id}
                          zone={zone.key}
                          taken={taken.has(id)}
                          mine={mine === id}
                          wide={row.n === null}
                          onClaim={onClaim}
                        />
                      );
                    })}
                    {row.n !== null && (
                      <span className="w-5 flex-none text-[10px] tabular-nums text-blue-100/30">{row.n}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {/* ── Cargo hold ── */}
        <section>
          <header className="flex items-center gap-2 border-l-2 border-white/20 bg-white/[0.035] px-3.5 py-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-100/55">{CARGO_HOLD.name}</h3>
            <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-blue-100/35">{CARGO_HOLD.note}</span>
          </header>
          <p className="px-3.5 py-3.5 text-[12.5px] leading-relaxed text-blue-100/55">{CARGO_HOLD.body}</p>
        </section>
      </div>

      {/* ── Tail ── */}
      <svg viewBox="0 0 320 64" className="block w-full max-w-[420px] mx-auto" aria-hidden>
        <path
          d="M56 0 L264 0 C252 30 214 56 160 62 C106 56 68 30 56 0 Z"
          fill="rgba(8,15,51,0.7)"
          stroke="rgba(52,237,243,0.28)"
          strokeWidth="1.5"
        />
        <path d="M160 12 L160 52" stroke="rgba(247,21,171,0.55)" strokeWidth="3" />
      </svg>

      {/* ── Legend ── */}
      <ul className="mx-auto mt-5 flex max-w-[420px] flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10.5px] uppercase tracking-[0.14em] text-blue-100/45">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3 w-3.5 border border-blue-100/25" /> Free
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3 w-3.5 bg-white/[0.17]" /> Taken
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3 w-3.5 bg-seat-amber shadow-[0_0_8px_#FFB300]" /> Yours
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3 w-3.5 border border-seat-cyan/70" /> Exit row
        </li>
        <li className="tabular-nums text-blue-100/35">{free} seats free</li>
      </ul>
    </div>
  );
};

export default SeatMap;
