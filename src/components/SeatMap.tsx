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
  onVisit: (id: string, zone: ZoneKey) => void;
  onInspect: (id: string | null) => void;
}

const Seat = ({ id, zone, entry, banner, mine, onVisit, onInspect }: SeatProps) => {
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
      style={{ width: 'var(--seat)', height: 'var(--seat)' }}
      className={`sa-seat relative flex-none overflow-hidden border transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${state} ${
        sold && !banner ? 'sa-seat--held' : ''
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

  /* How big a seat is drawn, by class.

     Every seat is the same square in the ladder's arithmetic, but they are
     emphatically not the same placement, and a map that draws rank 1 and rank
     40 at identical size is quietly arguing that they are. The front of the
     cabin is the front of the wall, so it is drawn that way. */
  const ZONE_SCALE: Record<ZoneKey, number> = {
    deck: 1.5, first: 1.22, business: 1, exit: 1, economy: 1,
  };

  /* With nothing under the cursor the panel falls back to the best seat on
     the aircraft rather than to an empty square: the front of the wall is
     what the section is selling, so that is what it shows at rest. */
  const shown = inspecting ?? mine ?? manifest.entries[0]?.seat.id ?? null;
  const resting = !inspecting && !mine;
  const entry = shown ? manifest.bySeat.get(shown) ?? null : null;
  const banner = shown ? banners[shown] ?? null : null;
  const link = safeHref(banner?.href);

  return (
    <div
      className="sa-map"
      /* One knob sets the whole grid: the seat is a square and everything is
         measured off it, so the map scales from a phone to a desktop without
         a second layout. */
      style={{ '--seat-base': 'clamp(30px, 5.2vw, 76px)', '--seat': 'var(--seat-base)', '--cabin-w': 'min(100%, 40rem)' } as CSSProperties}
    >
      <div className="sa-map__body">
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

        <div className="sa-map__cabin mx-auto max-w-[var(--cabin-w)]">
          {CABIN_ZONES.map((zone) => {
            const accent = ACCENT[zone.accent];
            return (
              <section key={zone.key} className="border-b border-white/10">
                <header className={`flex items-center gap-2 border-l-2 bg-white/[0.035] px-3.5 py-2 ${accent.line}`}>
                  <h3 className={`text-[11px] font-bold uppercase tracking-[0.2em] ${accent.text}`}>{zone.name}</h3>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-blue-100/35">{zone.note}</span>
                </header>

                <div
                  className={`flex flex-col gap-[5px] px-3 py-3.5 ${zone.key === 'deck' ? 'items-center' : ''}`}
                  style={{ '--seat': `calc(var(--seat-base) * ${ZONE_SCALE[zone.key]})` } as CSSProperties}
                >
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
      </div>

      {/* ── Who is in the seat under the cursor ────────────────────────────
          Beside the map rather than under it, and sticky, so the advert you
          are pointing at is shown at a size worth looking at while the map
          stays where it was. A popover on a tile would cover the three next
          to it, which is the whole reason this is a panel. */}
      <aside className="sa-map__side">
        <div className="sa-map__card">
          <p className="sa-map__label">{resting ? 'Best placement on board' : 'Seat'}</p>

          <div className="sa-map__preview">
            {banner ? (
              <img src={banner.image} alt={banner.alt} />
            ) : (
              <span className="sa-map__preview-empty">{entry ? 'No advert yet' : 'Seat open'}</span>
            )}
          </div>

          {shown ? (
            <>
              <p className="sa-map__seat">
                <span>{shown}</span>
                {entry ? (
                  <span className="sa-map__rank">#{entry.rank}</span>
                ) : (
                  <span className="sa-map__unsold">Unsold</span>
                )}
              </p>
              {entry ? (
                <dl className="sa-map__facts">
                  <div>
                    <dt>Holder</dt>
                    <dd className="font-mono">{shortAddress(entry.address)}</dd>
                  </div>
                  <div>
                    <dt>Bag</dt>
                    <dd className="tabular-nums">{formatTokens(entry.balance)}</dd>
                  </div>
                  <div>
                    <dt>Share</dt>
                    <dd className="tabular-nums">{formatShare(entry.share)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="sa-map__note">
                  Nobody holds this seat. Out-hold #{manifest.entries.length || 1} and it is yours.
                </p>
              )}

              {banner && (
                <p className="sa-map__alt">
                  {link ? (
                    <a href={link} target="_blank" rel="noopener noreferrer nofollow">{banner.alt}</a>
                  ) : banner.alt}
                </p>
              )}

              {canAdvertise === shown && (
                <button type="button" onClick={() => onAdvertise(shown)} className="sa-map__advertise">
                  {banner ? 'Change your advert' : 'Advertise here'}
                </button>
              )}
              {resting && (
                <p className="sa-map__note">
                  Point at any seat to see who holds it and what they are running.
                </p>
              )}
            </>
          ) : (
            <p className="sa-map__note">
              Point at any seat to see who holds it and what they are running. Every held square is its
              holder&apos;s to fill — the ones showing Seat Airways creative are the placements still open.
            </p>
          )}
        </div>

        {/* ── Legend ── */}
        <ul className="sa-map__legend">
          <li><span aria-hidden className="sa-key sa-key--open" /> Open</li>
          <li><span aria-hidden className="sa-key sa-key--held" /> Held</li>
          <li><span aria-hidden className="sa-key sa-key--mine" /> Yours</li>
          <li className="sa-map__count tabular-nums">{manifest.entries.length} seated · {manifest.open} open</li>
        </ul>
      </aside>
    </div>
  );
};

export default SeatMap;
