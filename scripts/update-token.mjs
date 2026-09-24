#!/usr/bin/env node
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const nextMint = process.argv[2]?.trim();
if (!nextMint || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(nextMint)) {
  console.error('Usage: npm run token:update -- <Solana mint address>');
  console.error('Expected a base58 Solana address between 32 and 44 characters.');
  process.exit(1);
}

const frontendPath = 'src/lib/token.ts';
const workerPath = 'worker/wrangler.toml';
const frontend = await readFile(frontendPath, 'utf8');
const worker = await readFile(workerPath, 'utf8');

const frontendPattern = /(const COMMITTED_MINT = ')[^']+(';)/;
const workerPattern = /(TOKEN_MINT = ")[^"]+("\n)/;
if (!frontendPattern.test(frontend)) throw new Error(`Could not find committed mint in ${frontendPath}`);
if (!workerPattern.test(worker)) throw new Error(`Could not find Worker TOKEN_MINT in ${workerPath}`);

/* The documentation prints the address as well, and a contract address left
   stale in the docs is exactly how somebody ends up buying the wrong token.
   So every copy of the outgoing mint under docs/ moves with the other two. */
const docsPath = 'docs';
const previousMint = frontend.match(/const COMMITTED_MINT = '([^']*)';/)?.[1] ?? '';

async function markdownUnder(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const found = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await markdownUnder(path)));
    else if (entry.name.endsWith('.md')) found.push(path);
  }
  return found;
}

const docs = [];
if (previousMint && previousMint !== nextMint) {
  for (const path of await markdownUnder(docsPath)) {
    const text = await readFile(path, 'utf8');
    if (!text.includes(previousMint)) continue;
    docs.push([path, text.split(previousMint).join(nextMint)]);
  }
}

await writeFile(frontendPath, frontend.replace(frontendPattern, `$1${nextMint}$2`));
await writeFile(workerPath, worker.replace(workerPattern, `$1${nextMint}$2`));
for (const [path, text] of docs) await writeFile(path, text);
console.log(`Updated frontend and Worker token mint to ${nextMint}`);
console.log(docs.length
  ? `Updated the address in ${docs.length} documentation page(s): ${docs.map(([path]) => path).join(', ')}`
  : 'No documentation page printed the previous address.');
console.log('Next: run npm run typecheck && npm run build, then commit and push.');
