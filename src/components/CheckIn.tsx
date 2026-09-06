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
  /** False when the deployment has not been pointed at a real token yet. */
  live: boolean;
  loading: boolean;
}

const CheckIn = ({ wallet, holding, berth, live, loading }: CheckInProps) => {
  const { address, walletName, connecting, error, unavailable, connect, disconnect } = wallet;

  if (!address) {
    return (
      <section className="border border-seat-amber/35 bg-[#141821]/85 backdrop-blur-sm" aria-label="Check in">
        <div className="px-5 py-5">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-seat-amber">Check in</p>
          <h3 className="font-heading mt-2 text-2xl leading-tight text-white">The aircraft seats you.</h3>
          <p className="mt-2 max-w-[42ch] text-[13px] leading-relaxed text-blue-100/65">
            You don&apos;t pick a seat. Connect a wallet and your holding decides the cabin — bigger bag,
            further forward. Everyone under the last cutoff rides in the hold.
          </p>

          <button
            type="button"
            onClick={connect}
            disabled={connecting}
            className="sa-shine mt-5 inline-flex w-full items-center justify-center gap-2 px-6 py-3.5 text-sm font-extrabold uppercase tracking-wide text-seat-night transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan"
            style={{ background: '#FFB300' }}
          >
            {connecting ? 'Checking in…' : 'Check in with a wallet'}
            {!connecting && <span aria-hidden>→</span>}
          </button>

          {error && (
            <p role="alert" className="mt-3 text-[12px] leading-relaxed text-[#FF8A7E]">
              {error}
            </p>
          )}
          {unavailable && !error && (
            <p className="mt-3 text-[12px] leading-relaxed text-blue-100/45">
              No wallet extension detected. Phantom, Solflare and Backpack all work.
            </p>
          )}
          {!live && (
            <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-relaxed text-blue-100/40">
              Demonstration mode — this deployment isn&apos;t pointed at a token yet, so the balance shown
              after check-in is an example, not your real holding.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="border border-white/12 bg-[#141821]/80 backdrop-blur-sm" aria-label="Checked in">
      <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3.5">
        <span
          aria-hidden
          className="h-2 w-2 shrink-0 bg-seat-amber"
          style={{ borderRadius: '9999px', boxShadow: '0 0 10px #FFB300' }}
        />
        <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-blue-100/55">
          Checked in{walletName ? ` · ${walletName}` : ''}
        </p>
        <button
          type="button"
          onClick={disconnect}
          className="ml-auto text-[10px] uppercase tracking-[0.16em] text-blue-100/40 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seat-cyan"
        >
          Sign out
        </button>
      </header>

      <dl className="grid grid-cols-2 gap-px bg-white/[0.07]">
        {[
          { k: 'Passenger', v: short(address) },
          { k: 'Cabin', v: berth.hold ? 'CARGO HOLD' : berth.rung },
          { k: 'Holding', v: holding ? formatTokens(holding.balance) : loading ? '—' : 'unread' },
          { k: 'Share of supply', v: holding ? formatShare(holding.share) : loading ? '—' : 'unread' },
        ].map((cell) => (
          <div key={cell.k} className="bg-[#141821] px-5 py-3.5">
            <dt className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-100/40">{cell.k}</dt>
            <dd className="mt-1 break-words text-[15px] leading-snug text-white">{cell.v}</dd>
          </div>
        ))}
      </dl>

      {!live && (
        <p className="border-t border-white/10 px-5 py-3 text-[11px] leading-relaxed text-blue-100/40">
          Demonstration figures — not your real balance.
        </p>
      )}
    </section>
  );
};

export default CheckIn;
