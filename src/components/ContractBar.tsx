import { useCallback, useEffect, useRef, useState } from 'react';
import { PUMP_URL, TOKEN_MINT, hasToken } from '../lib/token';

/**
 * The contract address, across the top of the page.
 *
 * It is the first thing somebody arriving from a link looks for and the one
 * string they need to copy exactly, so it sits above everything else and is
 * copyable in one press rather than one careful drag across 44 characters.
 * The way to buy sits next to it, because that is what they were going to do
 * with the address anyway.
 *
 * The address is shown whole wherever there is room. It is only ever
 * abbreviated on a narrow screen, and even then the full value stays in the
 * DOM — a truncated address that cannot be copied in full is worse than no
 * address at all, because it looks like one.
 */

/** Stands in until the deployment is pointed at a token. */
const PLACEHOLDER = 'XXXXXXXXXXXXXXXXXXXXX';

/**
 * The pump.fun capsule.
 *
 * Drawn here rather than fetched: one more network request on the critical
 * path for a 16-pixel glyph is a poor trade, and a remote asset that fails to
 * load leaves a broken image in the header.
 */
const PumpMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden className="sa-pump__mark">
    <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="8.6" transform="rotate(45 12 12)" fill="#4ADE80" />
    <path d="M6 12 L18 12" stroke="#0F7A3D" strokeWidth="1.6" strokeLinecap="round" transform="rotate(45 12 12)" />
  </svg>
);

const ContractBar = () => {
  const address = TOKEN_MINT || PLACEHOLDER;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      /* Clipboard refused — an insecure origin, or permission denied. The
         address is selectable text either way, so say nothing and let the
         person copy it the ordinary way. */
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  }, [address]);

  return (
    <div className="sa-ca">
      <div className="sa-ca__inner">
        <span className="sa-ca__label">CA</span>
        <code className="sa-ca__value" title={address}>{address}</code>

        {hasToken && (
          <button type="button" onClick={copy} className="sa-ca__copy">
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}

        <a
          href={PUMP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="sa-pump"
        >
          <PumpMark />
          <span className="sa-pump__text">pump.fun</span>
        </a>

        {/* Announced rather than shown twice: the button's own label already
            changes, and a screen reader should hear it confirmed once. */}
        <span aria-live="polite" className="sr-only">
          {copied ? 'Contract address copied' : ''}
        </span>
      </div>
    </div>
  );
};

export default ContractBar;
