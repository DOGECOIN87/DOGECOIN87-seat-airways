import { TOKEN_MINT } from './token';

const ACTIVE_MINT_KEY = 'seat-airlines.active-mint.v1';
const TOKEN_SCOPED_KEYS = [
  'seat-airlines.banners.v1',
  'seat-airlines.directory.session.v1',
] as const;

/**
 * Remove browser state that belongs to the previous token when the aircraft
 * rotates to a new mint. Holder counts and seats are chain-derived and are not
 * stored here; this only prevents stale local adverts and directory sessions
 * from following a wallet into the new aircraft.
 */
export function resetClientStateForToken(): void {
  if (typeof window === 'undefined' || !TOKEN_MINT) return;
  try {
    const previousMint = window.localStorage.getItem(ACTIVE_MINT_KEY);
    if (previousMint && previousMint !== TOKEN_MINT) {
      for (const key of TOKEN_SCOPED_KEYS) window.localStorage.removeItem(key);
    }
    window.localStorage.setItem(ACTIVE_MINT_KEY, TOKEN_MINT);
  } catch {
    // Storage may be blocked; the live chain and server remain authoritative.
  }
}
