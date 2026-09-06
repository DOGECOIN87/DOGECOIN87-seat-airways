/**
 * What your bag earns you.
 *
 * The premise says your seat is not a choice — it is what your holdings are
 * worth. This turns a balance into a specific seat on a specific row.
 *
 * Ranking is done by **share of supply**, not by position in a holder list.
 * That is a deliberate constraint: reading one wallet's balance needs a single
 * RPC call, whereas "are you in the top two" needs every holder's balance from
 * an indexer. Share of supply gives an honest, stable ladder that a browser can
 * work out on its own — and it does not silently change under you because
 * somebody else sold.
 */
import { ALL_SEATS, CABIN_ZONES, type CabinSeat, type ZoneKey } from '../content/cabin';

/** The cutoffs, as a share of total supply. */
export const LADDER: { zone: ZoneKey; minShare: number; label: string }[] = [
  { zone: 'deck', minShare: 0.01, label: '1% of supply' },
  { zone: 'first', minShare: 0.005, label: '0.5% of supply' },
  { zone: 'business', minShare: 0.002, label: '0.2% of supply' },
  { zone: 'exit', minShare: 0.0005, label: '0.05% of supply' },
  { zone: 'economy', minShare: 0, label: 'any balance at all' },
];

export interface Berth {
  /** The seat earned, or null when the holding is below every cutoff. */
  seat: CabinSeat | null;
  /** True when the holder rides below the floor. */
  hold: boolean;
  /** The rung reached, for display. */
  rung: string;
  /** What the next rung up costs, as a share. Null at the top. */
  nextShare: number | null;
  nextLabel: string | null;
}

/** A stable index from an address — the same wallet always gets the same seat. */
function hashOf(address: string): number {
  let h = 2166136261;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * The seat a holding earns.
 *
 * `share` is the holder's fraction of supply, 0–1. Which seat *within* the
 * earned cabin comes from the address, so it is stable across reloads and two
 * wallets rarely land on the same one — and when they do, that is the premise
 * working: seats are finite, and a bigger bag can take yours.
 */
export function berthFor(share: number, address: string | null): Berth {
  if (!address || share <= 0) {
    return {
      seat: null,
      hold: true,
      rung: 'Cargo hold',
      nextShare: 0,
      nextLabel: 'any balance at all',
    };
  }

  const rungIndex = LADDER.findIndex((r) => share >= r.minShare);
  const rung = LADDER[rungIndex] ?? LADDER[LADDER.length - 1];
  const zone = CABIN_ZONES.find((z) => z.key === rung.zone);
  const seats = ALL_SEATS.filter((s) => s.zone === rung.zone);
  const seat = seats.length ? seats[hashOf(address) % seats.length] : null;
  const next = rungIndex > 0 ? LADDER[rungIndex - 1] : null;

  return {
    seat,
    hold: false,
    rung: zone?.className ?? rung.zone.toUpperCase(),
    nextShare: next ? next.minShare : null,
    nextLabel: next ? `${CABIN_ZONES.find((z) => z.key === next.zone)?.name ?? next.zone} at ${next.label}` : null,
  };
}

/** A share as a readable percentage — small bags need the decimals. */
export function formatShare(share: number): string {
  if (share <= 0) return '0%';
  if (share < 0.0001) return `${(share * 100).toFixed(5)}%`;
  if (share < 0.01) return `${(share * 100).toFixed(3)}%`;
  return `${(share * 100).toFixed(2)}%`;
}

/** A token amount at human scale. Supplies run to billions; balances rarely do. */
export function formatTokens(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
