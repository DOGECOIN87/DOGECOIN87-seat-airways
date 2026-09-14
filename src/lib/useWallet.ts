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
  /* Every Solana wallet exposes this, and it is the only thing standing
     between the advertising wall and anybody who can type a POST. */
  signMessage?: (data: Uint8Array, encoding?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
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
  /**
   * Sign a plain-text challenge, returning the signature as base58.
   *
   * Connecting a wallet proves nothing — the address is public and anyone can
   * claim it. A signature is the proof, so every write to the wall carries
   * one. Throws if the wallet refuses or cannot sign; the caller reports that
   * rather than publishing anyway.
   */
  signMessage: (message: string) => Promise<string>;
}

/** Solana addresses and signatures are base58, so encoding one is on us. */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function toBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
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

  const signMessage = useCallback(async (message: string) => {
    const found = findProvider();
    if (!found) throw new Error('No wallet to sign with.');
    if (!found.provider.signMessage) {
      throw new Error(`${found.name} cannot sign messages.`);
    }
    const res = await found.provider.signMessage(new TextEncoder().encode(message), 'utf8');
    // Phantom returns { signature }, some others return the bytes directly.
    const sig = res instanceof Uint8Array ? res : res.signature;
    if (!sig?.length) throw new Error('The wallet returned no signature.');
    return toBase58(sig);
  }, []);

  return { address, walletName, connecting, error, unavailable, connect, disconnect, signMessage };
}
