/**
 * Wallet connect, without a wallet library.
 *
 * The page needs one thing from a wallet — the public key — so it talks to the
 * injected provider directly rather than pulling in an adapter stack an order
 * of magnitude larger than the rest of the app. Phantom, Solflare and Backpack
 * all expose the same `connect()` shape.
 *
 * If no provider is installed, `connect` reports that plainly instead of
 * failing silently, and the page stays fully usable without one.
 */
import { useCallback, useEffect, useState } from 'react';

interface InjectedProvider {
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString(): string } }>;
  disconnect?: () => Promise<void>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  publicKey?: { toString(): string } | null;
  isPhantom?: boolean;
}

type Injected = Window & {
  solana?: InjectedProvider;
  solflare?: InjectedProvider;
  backpack?: InjectedProvider;
};

function findProvider(): { name: string; provider: InjectedProvider } | null {
  if (typeof window === 'undefined') return null;
  const w = window as Injected;
  if (w.solana) return { name: w.solana.isPhantom ? 'Phantom' : 'Wallet', provider: w.solana };
  if (w.solflare) return { name: 'Solflare', provider: w.solflare };
  if (w.backpack) return { name: 'Backpack', provider: w.backpack };
  return null;
}

export interface WalletState {
  address: string | null;
  walletName: string | null;
  connecting: boolean;
  /** Null unless something went wrong the person needs to know about. */
  error: string | null;
  /** True when no wallet extension is present at all. */
  unavailable: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  // Reconnect silently if this browser has already trusted the site, so a
  // returning holder is seated without being asked again.
  useEffect(() => {
    const found = findProvider();
    if (!found) {
      setUnavailable(true);
      return;
    }
    setWalletName(found.name);
    found.provider
      .connect({ onlyIfTrusted: true })
      .then((res) => {
        const key = res?.publicKey ?? found.provider.publicKey;
        if (key) setAddress(key.toString());
      })
      .catch(() => {
        /* not previously trusted — wait to be asked */
      });
  }, []);

  const connect = useCallback(async () => {
    const found = findProvider();
    if (!found) {
      setUnavailable(true);
      setError('No Solana wallet found. Install Phantom, Solflare or Backpack, then try again.');
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const res = await found.provider.connect();
      const key = res?.publicKey ?? found.provider.publicKey;
      if (!key) throw new Error('The wallet connected but did not return an address.');
      setWalletName(found.name);
      setAddress(key.toString());
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // A refused prompt is a choice, not a failure worth shouting about.
      setError(/reject|denied|cancel/i.test(message) ? null : message);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const found = findProvider();
    try {
      await found?.provider.disconnect?.();
    } catch {
      /* disconnecting is best-effort; drop the address either way */
    }
    setAddress(null);
  }, []);

  return { address, walletName, connecting, error, unavailable, connect, disconnect };
}
