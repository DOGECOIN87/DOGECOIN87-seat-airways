import { useState, type CSSProperties } from 'react';
import { CABIN_ZONES, CARGO_HOLD, LAVATORY_SEATS, type CabinRow, type ZoneKey } from '../content/cabin';
import { safeHref, type Banner, type BannerSet } from '../lib/banners';
import { shortAddress, type Manifest, type ManifestEntry } from '../lib/manifest';
import { formatShare, formatTokens } from '../lib/seatLadder';

/**
 * The cabin, from above.
 *
 * Two things are true of this map that are not true of a seat map anywhere
 * else. Every seat on it is sold by rank — the manifest seats the top holders
 * and stops, so the empty rows aft are not decoration, they are the seats
 * nobody has out-held anyone for yet. And every seat is a square, so every
 * sold seat is a billboard: the holder in it can put a 1:1 image on their
 * square, and the whole aircraft reads as a wall of them with the best
 * placements at the front.
 */

const ACCENT: Record<'cerise' | 'cyan' | 'violet', { line: string; text: string }> = {
  cerise: { line: 'border-seat-amber/45', text: 'text-seat-amber' },
  cyan: { line: 'border-seat-cyan/45', text: 'text-seat-cyan' },
  violet: { line: 'border-seat-edge/60', text: 'text-seat-edge' },
};

interface SeatProps {
  id: string;
  zone: ZoneKey;
  entry: ManifestEntry | null;
  banner: Banner | null;
  mine: boolean;
  wide?: boolean;
  onVisit: (id: string, zone: ZoneKey) => void;
  onInspect: (id: string | null) => void;
}

const Seat = ({ id, zone, entry, banner, mine, wide, onVisit, onInspect }: SeatProps) => {
  const lavatory = (LAVATORY_SEATS as readonly string[]).includes(id);
  const sold = entry !== null;

  const state = mine
    ? 'border-seat-amber shadow-[0_0_14px_rgba(255,179,0,0.55)]'
    : sold
      ? 'border-white/25 hover:border-seat-cyan'
      : zone === 'exit'
        ? 'border-seat-cyan/45 hover:bg-seat-cyan/20 hover:border-seat-cyan'
        : lavatory
          ? 'border-dashed border-blue-100/25 hover:border-seat-amber'
          : 'border-blue-100/18 hover:bg-seat-cyan/15 hover:border-seat-cyan';

  const label = sold
    ? `Seat ${id}, rank ${entry.rank}, ${shortAddress(entry.address)}${banner ? `. Advert: ${banner.alt}` : ''}. Look from here.`
    : `Seat ${id}, open${lavatory ? ', middle seat by the lavatory, does not recline' : ''}. Look from here.`;

  return (
    <button
      type="button"
      aria-pressed={mine}
      aria-label={label}
      onClick={() => onVisit(id, zone)}
      onMouseEnter={() => onInspect(id)}
      onFocus={() => onInspect(id)}
      onMouseLeave={() => onInspect(null)}
      onBlur={() => onInspect(null)}
      style={{ width: wide ? 'calc(var(--seat) * 2.2)' : 'var(--seat)', height: 'var(--seat)' }}
      className={`sa-seat relative flex-none overflow-hidden border transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${state} ${
        sold && !banner ? 'bg-white/[0.11]' : ''
      }`}
    >
      {banner ? (
        <img src={banner.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : sold ? (
        // No advert up yet, so the seat advertises itself: rank, then the
        // seat number under it, at a size somebody can actually read.
        <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
          <span className="font-mono text-[max(10px,0.42em)] font-semibold text-white/70">{entry.rank}</span>
          <span className="mt-[0.15em] font-mono text-[max(7px,0.26em)] text-white/35">{id}</span>
        </span>
      ) : (
        <span className="absolute inset-0 grid place-items-center font-mono text-[max(7px,0.26em)] text-blue-100/20">
          {id}
        </span>
      )}

      {/* Headrest — the line that turns a square into a seat. */}
      <span
        aria-hidden
        className={`absolute inset-x-[12%] top-[8%] h-[6%] ${
          banner ? 'bg-black/35' : mine ? 'bg-seat-amber/70' : sold ? 'bg-white/25' : 'bg-current opacity-20'
        }`}
      />
    </button>
  );
};

/** A run of consecutive rows with nobody in any of them. */
interface Gap {
  from: number;
  to: number;
  seats: number;
}

interface SeatMapProps {
  manifest: Manifest;
  banners: BannerSet;
  mine: string | null;
  /** The seat this visitor may advertise on, if any. */
  canAdvertise: string | null;
  onVisit: (id: string, zone: ZoneKey) => void;
  onAdvertise: (seat: string) => void;
}

const SeatMap = ({ manifest, banners, mine, canAdvertise, onVisit, onAdvertise }: SeatMapProps) => {
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  /* Runs of rows with nobody in them collapse into one line.

     The aircraft fills from the front, so an unexpanded map is mostly empty
     rows — a screen of blank outlines that says nothing except that the map
     is long. Folding them up puts the seats that are actually held, and the
     adverts on them, at a size worth looking at, and the fold itself carries
     the number: this many seats, nobody holding them. */
  const blocksFor = (rows: readonly CabinRow[]): ({ row: CabinRow } | { gap: Gap })[] => {
    const out: ({ row: CabinRow } | { gap: Gap })[] = [];
    let run: CabinRow[] = [];
    const flush = () => {
      if (!run.length) return;
      if (showAll || run.length < 3) {
        out.push(...run.map((row) => ({ row })));
      } else {
        out.push({
          gap: {
            from: run[0].n ?? 0,
            to: run[run.length - 1].n ?? 0,
            seats: run.reduce((n, r) => n + r.left.length + r.right.length, 0),
          },
        });
      }
      run = [];
    };
    for (const row of rows) {
      const sold = [...row.left, ...row.right].some((c) =>
        manifest.seats.has(row.n === null ? c : `${row.n}${c}`),
      );
      if (sold) { flush(); out.push({ row }); } else run.push(row);
    }
    flush();
    return out;
  };

  const shown = inspecting ?? mine;
  const entry = shown ? manifest.bySeat.get(shown) ?? null : null;
  const banner = shown ? banners[shown] ?? null : null;
  const link = safeHref(banner?.href);

  return (
    <div
      /* One knob sets the whole grid: the seat is a square and everything is
         measured off it, so the map scales from a phone to a desktop without
         a second layout. */
      style={{ '--seat': 'clamp(30px, 6.4vw, 62px)', '--cabin-w': 'min(100%, 42rem)' } as CSSProperties}
    >
      {/* ── Nose ── */}
      <svg viewBox="0 0 320 54" preserveAspectRatio="none" className="mx-auto block h-11 w-full max-w-[var(--cabin-w)]" aria-hidden>
        <path
          d="M160 6 C202 6 244 25 258 53 L62 53 C76 25 118 6 160 6 Z"
          fill="rgba(0,38,99,0.34)"
          stroke="rgba(126,205,224,0.3)"
          strokeWidth="1.25"
        />
        <path d="M132 34 h56" stroke="rgba(126,205,224,0.28)" strokeWidth="1.5" />
        <circle cx="160" cy="22" r="2.5" fill="#FFB300" />
      </svg>

      <div className="mx-auto max-w-[var(--cabin-w)] border-x border-white/12 bg-seat-panel/70 backdrop-blur-sm">
        {CABIN_ZONES.map((zone) => {
          const accent = ACCENT[zone.accent];
          return (
            <section key={zone.key} className="border-b border-white/10">
              <header className={`flex items-center gap-2 border-l-2 bg-white/[0.035] px-3.5 py-2 ${accent.line}`}>
                <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${accent.text}`}>{zone.name}</h3>
                <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-blue-100/35">{zone.note}</span>
              </header>

              <div className={`flex flex-col gap-[5px] px-3 py-3 ${zone.key === 'deck' ? 'items-center' : ''}`}>
                {blocksFor(zone.rows).map((block) =>
                  'gap' in block ? (
                    <button
                      key={`gap-${block.gap.from}`}
                      type="button"
                      onClick={() => setShowAll(true)}
                      className="group flex items-center gap-3 border border-dashed border-white/12 px-3 py-2.5 text-left transition-colors hover:border-seat-cyan/50"
                    >
                      <span aria-hidden className="flex gap-[3px]">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <span key={i} className="h-3 w-2 border border-white/15" />
                        ))}
                      </span>
                      <span className="text-[11.5px] text-blue-100/45">
                        Rows {block.gap.from}–{block.gap.to} ·{' '}
                        <span className="font-mono">{block.gap.seats}</span> seats nobody has taken
                      </span>
                      <span className="ml-auto whitespace-nowrap text-[10px] uppercase tracking-[0.16em] text-blue-100/30 group-hover:text-seat-cyan">
                        Show
                      </span>
                    </button>
                  ) : (
                    <div key={block.row.n ?? 'deck'} className="flex items-center justify-center gap-[5px]">
                      {block.row.n !== null && (
                        <span className="w-6 flex-none text-right font-mono text-[10px] text-blue-100/30">{block.row.n}</span>
                      )}
                      {[block.row.left, block.row.right].map((bank, side) => (
                        <div key={side} className="contents">
                          {side === 1 && <span aria-hidden className="w-5 flex-none" />}
                          {bank.map((c) => {
                            const id = block.row.n === null ? c : `${block.row.n}${c}`;
                            return (
                              <Seat
                                key={id}
                                id={id}
                                zone={zone.key}
                                entry={manifest.bySeat.get(id) ?? null}
                                banner={banners[id] ?? null}
                                mine={mine === id}
                                wide={block.row.n === null}
                                onVisit={onVisit}
                                onInspect={setInspecting}
                              />
                            );
                          })}
                        </div>
                      ))}
                      {block.row.n !== null && (
                        <span className="w-6 flex-none font-mono text-[10px] text-blue-100/30">{block.row.n}</span>
                      )}
                    </div>
                  ),
                )}
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
      <svg viewBox="0 0 320 64" preserveAspectRatio="none" className="mx-auto block h-12 w-full max-w-[var(--cabin-w)]" aria-hidden>
        <path
          d="M62 0 L258 0 C247 28 211 52 160 58 C109 52 73 28 62 0 Z"
          fill="rgba(0,38,99,0.34)"
          stroke="rgba(126,205,224,0.3)"
          strokeWidth="1.25"
        />
        <path d="M160 10 L160 48" stroke="rgba(255,179,0,0.5)" strokeWidth="2.5" />
      </svg>

      {/* ── Who is in the seat under the cursor ────────────────────────────
          A fixed panel rather than a floating card: the tiles are 28px and a
          popover on one would cover the three next to it. */}
      <div className="mx-auto mt-4 flex max-w-[var(--cabin-w)] items-start gap-3 border border-white/10 bg-seat-panel/70 p-3">
        <div className="grid h-[72px] w-[72px] flex-none place-items-center overflow-hidden border border-white/12 bg-black/35">
          {banner ? (
            <img src={banner.image} alt={banner.alt} className="h-full w-full object-cover" />
          ) : (
            <span className="px-1 text-center text-[9px] uppercase leading-tight tracking-[0.12em] text-blue-100/25">
              {entry ? 'No advert' : 'Seat open'}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          {shown ? (
            <>
              <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-blue-50">
                <span className="font-bold tracking-[0.12em]">{shown}</span>
                {entry ? (
                  <>
                    <span className="text-seat-amber tabular-nums">#{entry.rank}</span>
                    <span className="font-mono text-[11px] text-blue-100/50">{shortAddress(entry.address)}</span>
                  </>
                ) : (
                  <span className="text-[11px] uppercase tracking-[0.14em] text-blue-100/40">Unsold</span>
                )}
              </p>
              <p className="mt-1 text-[11.5px] tabular-nums text-blue-100/55">
                {entry
                  ? `${formatTokens(entry.balance)} · ${formatShare(entry.share)} of supply`
                  : `Out-hold #${manifest.entries.length || 1} to take it`}
              </p>
              {banner && (
                <p className="mt-1 truncate text-[11.5px] text-blue-100/70">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-seat-cyan/50 underline-offset-2 hover:text-seat-cyan">
                      {banner.alt}
                    </a>
                  ) : banner.alt}
                </p>
              )}
              {canAdvertise === shown && (
                <button
                  type="button"
                  onClick={() => onAdvertise(shown)}
                  className="mt-2 border border-seat-amber/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-seat-amber hover:bg-seat-amber hover:text-seat-night"
                >
                  {banner ? 'Change your advert' : 'Advertise here'}
                </button>
              )}
            </>
          ) : (
            <p className="text-[11.5px] leading-relaxed text-blue-100/45">
              Hover a seat to see who holds it. Sold seats carry their holder&apos;s advert — a square image, front rows first.
            </p>
          )}
        </div>
      </div>

      {/* ── Legend ── */}
      <ul className="mx-auto mt-4 flex max-w-[var(--cabin-w)] flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10.5px] uppercase tracking-[0.14em] text-blue-100/45">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3.5 w-3.5 border border-blue-100/25" /> Open
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3.5 w-3.5 bg-white/[0.13]" /> Held
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-3.5 w-3.5 border border-seat-amber shadow-[0_0_8px_#FFB300]" /> Yours
        </li>
        <li className="tabular-nums text-blue-100/35">
          {manifest.entries.length} seated · {manifest.open} open
        </li>
      </ul>
    </div>
  );
};

export default SeatMap;
