import { useEffect, useMemo, useState } from 'react';
import { demoHolders, isConfigured, readHolders, type HolderList } from './holdings';
import type { Holding } from './holdings';
import { EMPTY_MANIFEST, seatHolders, type Manifest } from './manifest';

/**
 * The manifest, kept current.
 *
 * The holder list is read once and then re-read on a slow interval — slow
 * because a seating chart that reshuffles every few seconds is unreadable, and
 * because every read is somebody's RPC quota. The viewer's own balance is
 * merged in before seating, so connecting a wallet puts you on the aircraft
 * (or shows you exactly how far off it you are) without waiting for the next
 * poll to notice you.
 */

/** How often the holder list is re-read, in milliseconds. */
const REFRESH = 90_000;

export function useManifest(address: string | null, holding: Holding | null): Manifest {
  // Lazily: useState evaluates its argument on every render otherwise, and
  // this builds a whole demonstration holder list each time.
  const [list, setList] = useState<HolderList | null>(() => (isConfigured ? null : demoHolders()));

  useEffect(() => {
    if (!isConfigured) return;
    let alive = true;
    const load = async () => {
      const next = await readHolders();
      // A failed read keeps whatever was already on screen rather than
      // emptying the aircraft.
      if (alive && next) setList(next);
    };
    void load();
    const id = setInterval(load, REFRESH);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return useMemo(() => {
    if (!list) return EMPTY_MANIFEST;

    const holders = [...list.holders];
    if (address && holding && holding.balance > 0) {
      const at = holders.findIndex((h) => h.address === address);
      const mine = { address, balance: holding.balance };
      if (at >= 0) holders[at] = mine;
      else holders.push(mine);
    }
    return seatHolders(holders, list.supply, list.live && (holding?.live ?? true));
  }, [list, address, holding?.balance, holding?.live]);
}
