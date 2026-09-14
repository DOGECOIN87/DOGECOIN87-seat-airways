import { formatShare, formatTokens, type Berth } from '../lib/seatLadder';
import type { Holding } from '../lib/holdings';
import type { WalletState } from '../lib/useWallet';

/**
 * Check-in.
 *
 * The moment the page turns on: you connect, and the aircraft tells you where
 * you sit. It is written as a desk rather than a wallet button, because that
 * is what it is — you present a bag, it gives you a seat, and you have no say
 * in which one.
 *
 * Before check-in this is the only lit thing in the column, so the page has an
 * obvious next move. After it, it recedes to a receipt: who you are, what you
 * hold, and the seat that bought.
 */

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

interface CheckInProps {
  wallet: WalletState;
  holding: Holding | null;
  berth: Berth;
  loading: boolean;
}

const CheckIn = ({ wallet, holding, berth, loading }: CheckInProps) => {
  const { address, walletName, connecting, error, unavailable, connect, disconnect } = wallet;

  if (!address) {
    return (
      <section className="ui-card ui-card--accent" aria-label="Check in">
        <div className="px-5 py-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-ui-deep">Boarding</p>
          <h3 className="font-heading mt-2 text-2xl leading-tight text-ui-ink">Where do you sit?</h3>
          <p className="mt-2 max-w-[42ch] text-[13px] leading-relaxed text-ui-soft">
            Connect a wallet and the manifest answers it: bigger bag, further forward. Everyone under the
            last cutoff rides in the hold.
          </p>

          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="sa-cta sa-shine mt-5 w-full justify-center disabled:opacity-60"
          >
            {connecting ? 'Checking in…' : 'Check in with a wallet'}
            {!connecting && <span aria-hidden>→</span>}
          </button>

          {error && (
            <p role="alert" className="mt-3 text-[12px] font-semibold leading-relaxed text-[#B3261E]">
              {error}
            </p>
          )}
          {unavailable && !error && (
            <p className="mt-3 text-[12px] leading-relaxed text-ui-faint">
              No wallet extension detected. Phantom, Solflare and Backpack all work.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="ui-card" aria-label="Checked in">
      <header className="flex items-center gap-3 ui-rule-b px-5 py-3.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 bg-ui-blue"
          style={{ borderRadius: '9999px', boxShadow: '0 0 10px #FFB300' }}
        />
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-ui-soft">
          {`Checked in${walletName ? ` · ${walletName}` : ''}`}
        </p>
        <button
          type="button"
          onClick={disconnect}
          className="ml-auto text-[10px] uppercase tracking-[0.16em] text-ui-faint underline-offset-4 transition-colors hover:text-ui-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-blue"
        >
          Sign out
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-px bg-transparent">
        {[
          { k: 'Passenger', v: short(address) },
          { k: 'Cabin', v: berth.hold ? 'CARGO HOLD' : berth.rung },
          { k: 'Holding', v: holding ? formatTokens(holding.balance) : loading ? '—' : 'unread' },
          { k: 'Share of supply', v: holding ? formatShare(holding.share) : loading ? '—' : 'unread' },
        ].map((cell) => (
          <div key={cell.k} className="bg-transparent px-5 py-3.5">
            <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-ui-faint">{cell.k}</dt>
            <dd className="mt-1 break-words text-[15px] leading-snug text-ui-ink">{cell.v}</dd>
          </div>
        ))}
      </dl>

    </section>
  );
};

export default CheckIn;
