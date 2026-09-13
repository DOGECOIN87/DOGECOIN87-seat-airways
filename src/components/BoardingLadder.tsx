import { ALL_SEATS, CABIN_ZONES } from '../content/cabin';
import { LADDER, formatShare, formatTokens, type Berth } from '../lib/seatLadder';
import type { Holding } from '../lib/holdings';

/**
 * The boarding ladder.
 *
 * Airlines have solved this piece of interface already — a status ladder with
 * the tiers stacked, your tier lifted out, and a meter showing what the next
 * one costs — so this borrows that form rather than inventing one. It is the
 * page's argument in a single object: seats are finite, they are ordered, and
 * the only thing that moves you up it is the size of your bag.
 *
 * It reads as one object, not five cards: a single frame, hairline dividers,
 * and exactly one rung lifted. Everything else stays quiet so the lift means
 * something.
 */

interface BoardingLadderProps {
  berth: Berth;
  holding: Holding | null;
  /** Null until a wallet is connected — the ladder still shows the rungs. */
  address: string | null;
  /** How many seats are actually held, so each cabin can show how full it is. */
  manifestSize: number;
}

const seatCount = (zone: string) => ALL_SEATS.filter((s) => s.zone === zone).length;

const BoardingLadder = ({ berth, holding, address, manifestSize }: BoardingLadderProps) => {
  const share = holding?.share ?? 0;
  const seated = Boolean(address) && !berth.hold;
  const balance = holding?.balance ?? 0;

  /* How close you are to the bag directly above yours. */
  const target = balance + berth.gap;
  const progress = berth.gap <= 0 ? 1 : Math.max(0.02, Math.min(1, balance / Math.max(target, 1e-9)));

  return (
    <section
      className="ui-card"
      aria-label="Boarding ladder: what each cabin costs"
    >
      <header className="flex items-baseline gap-3 ui-rule-b px-5 py-3.5">
        <h3 className="font-heading text-lg leading-none text-ui-ink">Boarding ladder</h3>
        <p className="ml-auto whitespace-nowrap text-[10px] uppercase tracking-[0.18em] text-ui-faint">
          By rank
        </p>
      </header>

      <ol>
        {LADDER.map((rung) => {
          const zone = CABIN_ZONES.find((z) => z.key === rung.zone);
          const here = seated && berth.seat?.zone === rung.zone;
          const reached = seated && berth.rank !== null && berth.rank <= rung.maxRank;
          const held = manifestSize >= rung.minRank
            ? Math.min(rung.maxRank, manifestSize) - rung.minRank + 1
            : 0;
          return (
            <li
              key={rung.zone}
              aria-current={here ? 'true' : undefined}
              className={`relative flex items-center gap-4 py-3.5 pl-5 pr-5 ${here ? 'bg-ui-blue/[0.09]' : ''}`}
            >
              {/* The rail is the only thing that marks your rung. */}
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 w-[3px] ${here ? 'bg-ui-blue' : 'bg-transparent'}`}
              />
              <span
                className={`w-6 shrink-0 text-center text-[11px] tabular-nums ${
                  reached ? 'text-ui-deep' : 'text-ui-faint'
                }`}
                aria-hidden
              >
                {zone?.group ?? '—'}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-bold ${here ? 'text-ui-ink' : 'text-ui-soft'}`}>
                  {zone?.name ?? rung.zone}
                  {here && berth.seat && (
                    <span className="ml-2 align-middle text-[11px] font-normal tabular-nums text-ui-deep">
                      seat {berth.seat.id} · #{berth.rank}
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-ui-faint">
                  {rung.label} · <span className="font-mono">{held}</span> of{' '}
                  <span className="font-mono">{seatCount(rung.zone)}</span> taken
                </span>
              </span>
              <span
                className={`shrink-0 text-right text-[12px] tabular-nums ${
                  reached ? 'text-ui-ink' : 'text-ui-faint'
                }`}
              >
                #{rung.maxRank}
              </span>
            </li>
          );
        })}

        {/* Everyone under the last cutoff. Not a punishment — the biggest room. */}
        <li
          aria-current={berth.hold && address ? 'true' : undefined}
          className={`relative flex items-center gap-4 py-3.5 pl-5 pr-5 ${
            berth.hold && address ? 'bg-ui-blue/[0.09]' : ''
          }`}
        >
          <span
            aria-hidden
            className={`absolute inset-y-0 left-0 w-[3px] ${berth.hold && address ? 'bg-ui-blue' : 'bg-transparent'}`}
          />
          <span className="w-6 shrink-0 text-center text-[11px] text-ui-faint" aria-hidden>—</span>
          <span className="min-w-0 flex-1">
            <span className={`block text-sm font-bold ${berth.hold && address ? 'text-ui-ink' : 'text-ui-soft'}`}>
              Cargo hold
            </span>
            <span className="block text-[11px] text-ui-faint">Unlimited · everyone below the cut</span>
          </span>
          <span className="shrink-0 text-right text-[12px] tabular-nums text-ui-faint">—</span>
        </li>
      </ol>

      {/* What the next rung costs, in the units you actually hold. */}
      {address && holding && (
        <div className="ui-rule px-5 py-4">
          {berth.nextLabel ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-ui-faint">Next up</p>
                <p className="text-[11px] tabular-nums text-ui-faint">
                  {formatShare(share)} of {formatTokens(holding.supply)}
                </p>
              </div>
              <div className="mt-2 h-1.5 w-full bg-transparent">
                <div
                  className="sa-climb-fill h-full transition-[width] duration-700"
                  style={{ width: `${Math.max(2, progress * 100)}%` }}
                />
              </div>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ui-soft/70">
                {berth.nextLabel}. You need{' '}
                <span className="font-bold tabular-nums text-ui-ink">{formatTokens(berth.gap)}</span> more to take it.
              </p>
            </>
          ) : (
            <p className="text-[12.5px] text-ui-soft/70">
              You hold the biggest bag on this aircraft. There is no seat above yours.
            </p>
          )}
        </div>
      )}
    </section>
  );
};

export default BoardingLadder;
