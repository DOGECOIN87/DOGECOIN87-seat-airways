import { useEffect, useRef, useState } from 'react';
import { BANNER_SIZE, toSquare, type Banner } from '../lib/banners';

/**
 * Putting an advert on a seat.
 *
 * The image is cropped to 1:1 here, before it is stored, so the seat grid can
 * never be knocked out of shape by what somebody uploads. The preview shows
 * the crop rather than the original — what you see is what goes on the wall.
 */

interface AdvertDialogProps {
  seat: string;
  current: Banner | null;
  /**
   * Put it up. Resolves to an error worth showing, or null on success.
   *
   * Async because publishing now means a wallet signature and a round trip,
   * and both of those are things a person waits on — the dialog has to be
   * able to say so rather than appearing to hang.
   */
  onSave: (banner: Banner) => Promise<string | null> | string | null;
  /** Whether saving publishes for everyone or only into this browser. */
  shared?: boolean;
  onClear: () => void;
  onClose: () => void;
}

const AdvertDialog = ({ seat, current, onSave, onClear, onClose, shared }: AdvertDialogProps) => {
  const [image, setImage] = useState(current?.image ?? '');
  const [alt, setAlt] = useState(current?.alt ?? '');
  const [href, setHref] = useState(current?.href ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setImage(await toSquare(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That image could not be read.');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!image) return setError('Choose an image first.');
    setBusy(true);
    setError(null);
    try {
      const failure = await onSave({
        image,
        alt: alt.trim() || `Advert on seat ${seat}`,
        href: href.trim() || undefined,
      });
      if (failure) setError(failure);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That advert could not be published.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2B2F37]/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Advertise on seat ${seat}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="ui-card w-full max-w-md p-6">
        <header className="mb-4 flex items-baseline gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.2em] text-ui-deep">Seat {seat}</h2>
          <p className="text-[11px] uppercase tracking-[0.14em] text-ui-faint">Your billboard</p>
          <button
            ref={first}
            type="button"
            onClick={onClose}
            className="ml-auto px-2 text-[18px] leading-none text-ui-soft hover:text-ui-ink"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex gap-4">
          <div
            className="ui-well grid h-24 w-24 flex-none place-items-center overflow-hidden"
            aria-hidden={!image}
          >
            {image
              ? <img src={image} alt="" className="h-full w-full object-cover" />
              : <span className="text-[10px] uppercase tracking-[0.14em] text-ui-faint">1:1</span>}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-ui-faint">Image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => take(e.target.files?.[0])}
                className="block w-full text-[11px] text-ui-soft file:mr-3 file:rounded-full file:border-0 file:bg-ui-bg file:px-3 file:py-1.5 file:text-[10px] file:font-bold file:uppercase file:tracking-[0.14em] file:text-ui-deep"
              />
            </label>
            <p className="text-[10.5px] leading-relaxed text-ui-faint">
              Cropped square from the centre and stored at {BANNER_SIZE}px. Any shape works; only the middle of it lands on the seat.
            </p>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-ui-faint">Description</span>
          <input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            maxLength={120}
            placeholder="What the advert says"
            className="ui-field"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-ui-faint">Link (optional)</span>
          <input
            value={href}
            onChange={(e) => setHref(e.target.value)}
            inputMode="url"
            placeholder="https://"
            className="ui-field"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-[11.5px] font-semibold text-[#B3261E]">{error}</p>
        )}

        <p className="mt-4 ui-rule pt-3 text-[10.5px] leading-relaxed text-ui-faint">
          {shared
            ? 'Your wallet will ask you to sign this advert. The signature proves the seat is yours and covers this exact image — it moves no funds.'
            : 'Saved in this browser only. Everyone else sees the published wall until yours is accepted onto it.'}
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="sa-cta px-5 py-2 text-[11px] disabled:opacity-40"
          >
            {busy ? 'Working…' : shared ? 'Sign and put it up' : 'Put it up'}
          </button>
          {current && (
            <button
              type="button"
              onClick={() => { onClear(); onClose(); }}
              className="sa-ghost px-5 py-2 text-[11px]"
            >
              Take it down
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvertDialog;
