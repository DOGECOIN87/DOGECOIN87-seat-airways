#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

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

await writeFile(frontendPath, frontend.replace(frontendPattern, `$1${nextMint}$2`));
await writeFile(workerPath, worker.replace(workerPattern, `$1${nextMint}$2`));
console.log(`Updated frontend and Worker token mint to ${nextMint}`);
console.log('Next: run npm run typecheck && npm run build, then commit and push.');
