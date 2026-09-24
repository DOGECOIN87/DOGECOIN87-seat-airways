/**
 * Where the documentation is published.
 *
 * The docs are this repository's docs/ folder, which GitBook publishes through
 * Git Sync. GitBook hands the site its address when it is first published, so
 * the address is a setting rather than something this file can know: set
 * `VITE_DOCS_URL` — a repository variable like the others, since it is not a
 * secret — and the footer's GitBook link follows it. Until then the link opens
 * the same pages on GitHub, which always exist, rather than guessing at an
 * address that might not.
 *
 * Blank counts as unset, for the reason `workerBase.ts` gives: the deploy
 * workflow passes every variable, created or not.
 */
const COMMITTED_DOCS_URL = 'https://github.com/DOGECOIN87/DOGECOIN87-seat-airways/tree/main/docs';

export const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string | undefined)?.trim() || COMMITTED_DOCS_URL;
