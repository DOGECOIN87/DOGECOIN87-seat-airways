/**
 * Where the documentation is published.
 *
 * The docs are this repository's docs/ folder, which GitBook publishes through
 * Git Sync at the committed address below. If that address ever changes — a
 * custom domain, a renamed site — set `VITE_DOCS_URL`, a repository variable
 * like the others since it is not a secret, and the footer's GitBook link
 * follows it without a code change.
 *
 * Blank counts as unset, for the reason `workerBase.ts` gives: the deploy
 * workflow passes every variable, created or not.
 */
const COMMITTED_DOCS_URL = 'https://seat-airlines.gitbook.io/seat-airlines-docs/';

export const DOCS_URL = (import.meta.env.VITE_DOCS_URL as string | undefined)?.trim() || COMMITTED_DOCS_URL;
