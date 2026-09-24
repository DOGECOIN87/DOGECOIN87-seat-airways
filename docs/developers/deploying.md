---
description: The page on GitHub Pages, the Worker on Cloudflare, the token, and these docs on GitBook.
---

# Deploying

## The page — GitHub Pages

`.github/workflows/deploy.yml` runs on every push to `main` and on manual dispatch: it installs, runs `npm test`, builds, and publishes `dist/` to GitHub Pages. A push that changes only `docs/` or `.gitbook.yaml` does not redeploy the site.

1. **Turn Pages on first.** Repository → **Settings → Pages → Source: GitHub Actions**. Without it the workflow builds and then fails at the deploy step with a permissions error.
2. **Configuration** goes in repository **variables**, not secrets: **Settings → Secrets and variables → Actions → Variables**. See [Configuration](configuration.md) for why.

### The domain

`public/CNAME` holds `seat-airlines.space`, and the build copies it into `dist/`, so the custom domain survives every deploy. At the registrar:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `dogecoin87.github.io.` |

Then **Settings → Pages → Custom domain → `seat-airlines.space`**, wait for the DNS check, and tick **Enforce HTTPS** once it is offered.

## The Worker — Cloudflare

`.github/workflows/worker.yml` runs on pushes to `main` that touch `worker/`. It type-checks and tests the Worker, and deploys it **only if** the repository has a `CLOUDFLARE_API_TOKEN` secret (with Workers Scripts, Workers KV Storage and Workers R2 Storage edit rights). Without one it stops after the tests and says so in the job summary — a green run does not by itself mean the Worker was deployed, so check the **Deploy** step.

By hand:

```bash
cd worker
npm install
npx wrangler deploy
curl -fsS https://<your-worker>/health
```

Worth knowing before you ship:

* **Migrations are applied by hand.** `wrangler deploy` ships code, not schema. Apply a new migration before the code that needs it:\
  `npx wrangler d1 migrations apply seat-airlines-directory --remote`
* **Set `RPC_URL`.** It is a secret: `npx wrangler secret put RPC_URL`, or run the **Set the Worker's RPC secret** workflow, which reads the repository's `RPC_URL` and `CLOUDFLARE_API_TOKEN` secrets.
* **`ALLOWED_ORIGINS` must name the site**, or every write fails in the browser with a CORS error.
* **Check `/health` after every deploy** — especially `sections` and `seated`.

## Changing the token

```bash
npm run token:update -- <new mint address>
npm run typecheck
npm run build
```

The script updates the page's committed address (`src/lib/token.ts`), the Worker's `TOKEN_MINT` (`worker/wrangler.toml`), **and every page in `docs/` that prints the old address**, so the documentation never points anyone at a retired token. Commit and push; both workflows deploy the change. If the repository has a `VITE_TOKEN_MINT` variable, set it to the same address, because it overrides the committed one.

A new mint is a new holder set: the seats and the holder count come from the new token's chain data. Visitors' browsers drop adverts and directory sessions saved for the old token. Server-side adverts, cards and messages are **not** deleted.

## These docs — GitBook

The documentation is the `docs/` folder of the repository, and `docs/gitbook-docs.yaml` is the contract GitBook reads: it names the site and maps this folder onto it as one space — one book, whose page tree is `SUMMARY.md`. (`.gitbook.yaml` at the repository root is the older, space-level version of the same pointer, kept for anything still reading it.) To connect a GitBook docs site:

1. In the site, open **Git Sync** and choose **GitHub**.
2. Install or authorise the GitBook app for `DOGECOIN87/DOGECOIN87-seat-airways`, pick the branch — `main` — and set the project directory to `docs/`, where GitBook finds `gitbook-docs.yaml`.
3. For the first sync, keep the direction **GitHub → GitBook**, so GitBook imports these pages rather than overwriting them with an empty site.
4. Publish the site from GitBook.
5. Point the site's footer at it: set the repository variable `VITE_DOCS_URL` to the published address, then re-run the Pages deploy (**Actions → Deploy to GitHub Pages → Run workflow**). Until then the footer's **Docs on GitBook** link opens these pages on GitHub.

After that the sync runs both ways: a push to `docs/` updates GitBook, and an edit made in GitBook arrives as a commit.
