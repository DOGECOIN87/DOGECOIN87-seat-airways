/**
 * What your bag earns you.
 *
 * The premise says your seat is not a choice — it is what your holdings are
 * worth relative to everyone else's. Seats are handed out strictly by rank
 * from the manifest, and the manifest is finite, so the ladder is a queue
 * rather than a set of thresholds: passing a threshold you can then forget
 * about is not competitive, and having to out-hold the specific person in
 * front of you is.
 *
 * Each cabin is therefore a band of ranks. How many ranks it covers is simply
 * how many seats are in it, counted in the order the aircraft fills.
 */
import { CABIN_ZONES, type CabinSeat, type ZoneKey } from '../content/cabin';
import { SEAT_ORDER, findEntry, type Manifest } from './manifest';

export interface Rung {
  zone: ZoneKey;
  /** The first rank this cabin holds. */
  minRank: number;
  /** The last rank this cabin holds. Rank 1 is the biggest bag aboard. */
  maxRank: number;
  /** How it reads on the ladder. */
  label: string;
}

/** The cabins, as rank bands, derived from where the seats actually are. */
export const LADDER: readonly Rung[] = CABIN_ZONES.map((zone) => {
  let maxRank = 0;
  let minRank = Infinity;
  SEAT_ORDER.forEach((s, i) => {
    if (s.zone !== zone.key) return;
    maxRank = Math.max(maxRank, i + 1);
    minRank = Math.min(minRank, i + 1);
  });
  return {
    zone: zone.key,
    minRank: Number.isFinite(minRank) ? minRank : 0,
    maxRank,
    label: minRank === maxRank ? `Rank ${maxRank}` : `Ranks ${minRank}–${maxRank}`,
  };
});

export interface Berth {
  /** The seat earned, or null when the bag is not in the manifest. */
  seat: CabinSeat | null;
  /** True when the holder rides below the cut. */
  hold: boolean;
  /** Position on the manifest, 1 being the biggest bag. Null in the hold. */
  rank: number | null;
  /** The rung reached, for display. */
  rung: string;
  /** Tokens needed to pass whoever is directly above. Zero at the top. */
  gap: number;
  /** Who that is, in words. Null at the top of the aircraft. */
  nextLabel: string | null;
}

/**
 * The seat a holding earns, read off the manifest.
 *
 * Everything here is relative: the same balance is a flight-deck seat on a
 * quiet day and the cargo hold on a busy one, and that is the intended
 * behaviour — the aircraft is a leaderboard with legroom.
 */
export function berthFromManifest(manifest: Manifest, address: string | null, balance: number): Berth {
  const entry = findEntry(manifest, address);

  if (!entry) {
    // Below the cut. What it costs to get aboard is the last seat's balance.
    const seatsLeft = manifest.open > 0;
    return {
      seat: null,
      hold: true,
      rank: null,
      rung: 'Cargo hold',
      gap: seatsLeft ? 1 : Math.max(0, manifest.cutoff - balance),
      nextLabel: !address
        ? null
        : seatsLeft
          ? `${manifest.open} seats still unsold — any balance takes one`
          : `The last seat aboard is holding ${formatTokens(manifest.cutoff)}`,
    };
  }

  const above = manifest.entries[entry.rank - 2] ?? null;
  const zone = CABIN_ZONES.find((z) => z.key === entry.seat.zone);
  return {
    seat: entry.seat,
    hold: false,
    rank: entry.rank,
    rung: zone?.className ?? entry.seat.zone.toUpperCase(),
    gap: above ? Math.max(0, above.balance - entry.balance) : 0,
    nextLabel: above ? `#${above.rank} in ${above.seat.id} is holding ${formatTokens(above.balance)}` : null,
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
