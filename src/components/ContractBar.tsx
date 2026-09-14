import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The contract address, across the top of the page.
 *
 * It is the first thing somebody arriving from a link looks for and the one
 * string they need to copy exactly, so it sits above everything else and is
 * copyable in one press rather than one careful drag across 44 characters.
 *
 * The address is shown whole wherever there is room. It is only ever
 * abbreviated on a narrow screen, and even then the full value stays in the
 * DOM — a truncated address that cannot be copied in full is worse than no
 * address at all, because it looks like one.
 */

const MINT = import.meta.env.VITE_TOKEN_MINT as string | undefined;

/** Stands in until the deployment is pointed at a token. */
const PLACEHOLDER = 'XXXXXXXXXXXXXXXXXXXXX';

const ContractBar = () => {
  const address = MINT?.trim() || PLACEHOLDER;
  const real = Boolean(MINT?.trim());
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
        {real && (
          <button type="button" onClick={copy} className="sa-ca__copy">
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
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
