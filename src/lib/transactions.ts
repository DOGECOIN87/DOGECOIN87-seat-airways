import { useEffect, useState } from 'react';
import { visibilityAwareInterval } from './visibility';

const RPC_URL = (import.meta.env.VITE_RPC_URL as string | undefined)?.trim() || undefined;
export const transactionsConfigured = Boolean(RPC_URL);

export interface WalletTransaction {
  signature: string;
  blockTime: number | null;
  slot: number;
  err: unknown;
  memo: string | null;
  confirmationStatus: string | null;
}

interface SignatureResponse {
  result?: WalletTransaction[];
  error?: unknown;
}

async function readRecentSignatures(address: string, limit = 6): Promise<WalletTransaction[] | null> {
  if (!RPC_URL) return null;
  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `seat-activity-${address}`,
        method: 'getSignaturesForAddress',
        params: [address, { limit }],
      }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as SignatureResponse;
    return body.error || !Array.isArray(body.result) ? null : body.result;
  } catch {
    return null;
  }
}

export interface WalletActivity {
  rows: WalletTransaction[];
  loading: boolean;
  configured: boolean;
  failed: boolean;
  refreshedAt: number | null;
}

/** Recent on-chain activity for the wallet occupying the selected seat. */
export function useWalletActivity(address: string | null): WalletActivity {
  const [rows, setRows] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setRows([]);
    setFailed(false);
    setRefreshedAt(null);

    if (!address || !RPC_URL) {
      setLoading(false);
      return;
    }

    const load = async () => {
      if (alive) setLoading(true);
      const next = await readRecentSignatures(address);
      if (!alive) return;
      if (next) {
        setRows(next);
        setFailed(false);
        setRefreshedAt(Date.now());
      } else {
        setFailed(true);
      }
      setLoading(false);
    };

    const stop = visibilityAwareInterval(load, 30_000);
    return () => {
      alive = false;
      stop();
    };
  }, [address]);

  return { rows, loading, configured: transactionsConfigured, failed, refreshedAt };
}

export function shortSignature(signature: string): string {
  return signature.length > 12 ? `${signature.slice(0, 5)}…${signature.slice(-5)}` : signature;
}

export function formatActivityTime(blockTime: number | null): string {
  if (!blockTime) return 'Time unavailable';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(blockTime * 1000);
}

export function transactionStatus(transaction: WalletTransaction): string {
  return transaction.err ? 'Failed' : transaction.confirmationStatus === 'finalized' ? 'Finalized' : 'Confirmed';
}
