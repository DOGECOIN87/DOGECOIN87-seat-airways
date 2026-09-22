/**
 * What the aeroplane is doing, over the wire.
 *
 * The switches are the aircraft's rather than the browser's — see
 * `manualControls.ts` — so this is how a page finds out that somebody has
 * rolled it, and how the one wallet that may do so says to.
 *
 * ── Why this polls, and why it is cheap ───────────────────────────────────
 * Everything else the page reads is slow-moving: the holder list every ninety
 * seconds, the wall every minute, the weather every fifteen. This is not.
 * Somebody presses a switch and expects the aeroplane to roll, and a minute
 * of nothing happening reads as a broken button rather than as a poll
 * interval. So it is asked for far more often than anything else here.
 *
 * What keeps that from being expensive is that the answer is tiny and almost
 * always the same one. The record is five fields; the Worker holds it in a
 * warm snapshot so most reads never touch storage; and the response carries a
 * short `max-age`, so a browser asking again inside it is answered by its own
 * cache without a round trip at all.
 */

import { HANDS_OFF, clamped, type ManualControls } from './manualControls';
import { WORKER_API, type Session } from './networkingApi';
import { abortableFetch } from './visibility';

/** True when there is somewhere for the aeroplane's state to live. */
export const hasFlight = Boolean(WORKER_API);

/**
 * What the aeroplane is being told to do, or hands off.
 *
 * Never throws and never returns null. Every failure — no Worker, no network,
 * a shape nobody recognises — is an aeroplane flying the market, which is
 * what it does when nobody has touched anything. A visitor should never see
 * an error about a switch they did not press.
 */
export async function fetchFlight(): Promise<ManualControls> {
  if (!WORKER_API) return HANDS_OFF;
  try {
    /* Timed out rather than plain, and that matters more here than it looks:
       the poll loop waits for this before scheduling the next one, so one
       request that never settles is polling stopped for the life of the page
       — an aeroplane frozen in whatever attitude it was last seen in. */
    const res = await abortableFetch(`${WORKER_API}/flight`);
    if (!res.ok) return HANDS_OFF;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== 'object') return HANDS_OFF;
    // Clamped here too. The Worker clamps what it stores, but this page has
    // no way to know it is talking to the Worker it thinks it is.
    return clamped(body as Partial<ManualControls>);
  } catch {
    return HANDS_OFF;
  }
}

/**
 * Take hold of it.
 *
 * Only the operator's session is accepted, and the refusal is a plain 403 —
 * unlike the logbook's 404, because this is not hidden. Everybody watching
 * the aeroplane roll already knows somebody rolled it.
 */
export async function setFlight(session: Session, controls: ManualControls): Promise<ManualControls> {
  if (!WORKER_API) throw new Error('This deployment has no flight controls.');
  const res = await fetch(`${WORKER_API}/flight`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${session.token}` },
    body: JSON.stringify(controls),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The flight controls refused that (${res.status}).`);
  }
  return clamped((await res.json()) as Partial<ManualControls>);
}
