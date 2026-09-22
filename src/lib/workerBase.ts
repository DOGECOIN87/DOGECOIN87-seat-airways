/**
 * Where this deployment's Worker is, and how that gets decided.
 *
 * One Worker serves everything the page cannot do alone: the advert wall, the
 * cabin directory, the flight controls, and the holder list behind the
 * seating chart. Which Worker that is was a build-time variable with no
 * default, so a build that had not been told turned all four off at once —
 * the directory said so on the page and the rest simply went quiet.
 *
 * That is a poor way to fail for a value that is not a secret. Vite inlines
 * every VITE_ variable into the bundle it ships, so this URL is readable by
 * anybody who opens the site and looks; keeping it out of the repository hid
 * it from the repository and from nobody else. `worker/wrangler.toml` has
 * named this deployment in the open since it existed — the KV namespace, the
 * database, the bucket, the mint, the allowed origins — so the one address
 * tying them together was the odd one out.
 *
 * It has a default now, and a deployment that configures nothing still works.
 * A variable still wins wherever one is set, which is what a fork needs.
 *
 * ── Why blank counts as unset ─────────────────────────────────────────────
 * `deploy.yml` passes every variable on every build, so one that was never
 * created arrives as an empty string rather than as nothing at all. `??`
 * steps past `null` and `undefined` only, so an empty string satisfied it and
 * ended the search: setting `VITE_BANNERS_API` alone — which is exactly what
 * the Worker's own deploy summary tells an operator to do — left the
 * directory reading an empty `VITE_DIRECTORY_API` and switching itself off.
 * The fallback written to spare somebody a second variable was defeated by
 * the variable it was meant to make optional.
 *
 * So absent and blank are one thing here. `transactions.ts`, `marketFeed.ts`
 * and `token.ts` had already each decided that for themselves; these two were
 * the ones that had not.
 */

/**
 * The Worker this site is deployed against.
 *
 * `seat-airlines-banners`, whose bindings and allowed origins are in
 * `worker/wrangler.toml`. A fork points itself somewhere else by setting
 * `VITE_BANNERS_API` rather than by editing this line.
 */
export const DEFAULT_WORKER_API = 'https://seat-airlines-banners.trashmarket.workers.dev';

/**
 * The first of these that was actually configured, else the default above.
 *
 * A trailing slash is dropped so callers can append a path without minding
 * whether one is already there.
 */
export const resolveWorkerApi = (...configured: (string | undefined)[]): string => {
  const set = configured.find((value) => value?.trim());
  return (set?.trim() || DEFAULT_WORKER_API).replace(/\/$/, '');
};
