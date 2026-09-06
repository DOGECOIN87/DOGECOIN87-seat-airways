import { useState } from 'react';
import { CABIN_ZONES, CARGO_HOLD, LAVATORY_SEATS, type ZoneKey } from '../content/cabin';
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
      className={`relative aspect-square flex-none overflow-hidden border transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan ${state} ${
        wide ? 'h-7 w-[3.75rem]' : 'h-7 w-7'
      } ${sold && !banner ? 'bg-white/[0.13]' : ''}`}
    >
      {banner ? (
        <img src={banner.image} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : sold && !wide ? (
        // No advert up yet: the rank is the placeholder, which is its own
        // advertisement for the seat.
        <span className="absolute inset-0 grid place-items-center text-[9px] font-bold tabular-nums text-white/45">
          {entry.rank}
        </span>
      ) : null}

      {/* Headrest — the line that turns a square into a seat. */}
      <span
        aria-hidden
        className={`absolute inset-x-1 top-[3px] h-[2px] ${
          banner ? 'bg-black/35' : mine ? 'bg-seat-amber/70' : sold ? 'bg-white/25' : 'bg-current opacity-25'
        }`}
      />
      {wide && !banner && (
        <span className="relative text-[9px] font-bold tracking-[0.1em]">{id}</span>
      )}
    </button>
  );
};

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

  const shown = inspecting ?? mine;
  const entry = shown ? manifest.bySeat.get(shown) ?? null : null;
  const banner = shown ? banners[shown] ?? null : null;
  const link = safeHref(banner?.href);

  return (
    <div>
      {/* ── Nose ── */}
      <svg viewBox="0 0 320 54" className="block w-full max-w-[460px] mx-auto" aria-hidden>
        <path
          d="M160 2 C205 2 250 22 264 52 L56 52 C70 22 115 2 160 2 Z"
          fill="rgba(8,15,51,0.7)"
          stroke="rgba(52,237,243,0.28)"
          strokeWidth="1.5"
        />
        <path d="M136 30 h48" stroke="rgba(52,237,243,0.4)" strokeWidth="2" />
        <circle cx="160" cy="18" r="3" fill="#FFB300" />
      </svg>

      <div className="mx-auto max-w-[460px] border-x border-white/12 bg-[#141821]/60 backdrop-blur-sm">
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
                    {[row.left, row.right].map((bank, side) => (
                      <div key={side} className="contents">
                        {side === 1 && <span aria-hidden className="w-4 flex-none" />}
                        {bank.map((c) => {
                          const id = row.n === null ? c : `${row.n}${c}`;
                          return (
                            <Seat
                              key={id}
                              id={id}
                              zone={zone.key}
                              entry={manifest.bySeat.get(id) ?? null}
                              banner={banners[id] ?? null}
                              mine={mine === id}
                              wide={row.n === null}
                              onVisit={onVisit}
                              onInspect={setInspecting}
                            />
                          );
                        })}
                      </div>
                    ))}
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
      <svg viewBox="0 0 320 64" className="block w-full max-w-[460px] mx-auto" aria-hidden>
        <path
          d="M56 0 L264 0 C252 30 214 56 160 62 C106 56 68 30 56 0 Z"
          fill="rgba(8,15,51,0.7)"
          stroke="rgba(52,237,243,0.28)"
          strokeWidth="1.5"
        />
        <path d="M160 12 L160 52" stroke="rgba(247,21,171,0.55)" strokeWidth="3" />
      </svg>

      {/* ── Who is in the seat under the cursor ────────────────────────────
          A fixed panel rather than a floating card: the tiles are 28px and a
          popover on one would cover the three next to it. */}
      <div className="mx-auto mt-4 flex max-w-[460px] items-start gap-3 border border-white/10 bg-[#141821]/60 p-3">
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
      <ul className="mx-auto mt-4 flex max-w-[460px] flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10.5px] uppercase tracking-[0.14em] text-blue-100/45">
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
