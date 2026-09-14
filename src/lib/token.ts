/**
 * The token this aircraft flies.
 *
 * One place. The contract address drives the CA bar at the top of the page,
 * the pump.fun link beside it, the market feed, the balance lookups and the
 * seat ladder — and every one of those used to reach for the environment
 * variable itself, which meant going live was a change in five files or a
 * settings page nobody could see from the code.
 *
 * `VITE_TOKEN_MINT` still wins where it is set, so a fork or a staging
 * deployment can point somewhere else without touching this. But the
 * committed value below is what production runs on, which makes going live a
 * one-line edit that reviews like any other change and deploys like any other
 * push.
 */

/** The mint, as committed. Empty until the token exists. */
const COMMITTED_MINT = 'AWJCyg9PrMtYju9yaQmdQLcwrGobHMTv9JU3mo4upump';

const ENV_MINT = (import.meta.env.VITE_TOKEN_MINT as string | undefined)?.trim();

/** The contract address, or empty string if this deployment has no token yet. */
export const TOKEN_MINT = ENV_MINT || COMMITTED_MINT;

/** True once the aircraft has something to fly. */
export const hasToken = Boolean(TOKEN_MINT);

/**
 * Where to buy it.
 *
 * Without a mint this points at pump.fun itself rather than at a coin page
 * that would 404 — a dead link on the header is worse than a general one.
 */
export const PUMP_URL = TOKEN_MINT
  ? `https://pump.fun/coin/${TOKEN_MINT}`
  : 'https://pump.fun';
