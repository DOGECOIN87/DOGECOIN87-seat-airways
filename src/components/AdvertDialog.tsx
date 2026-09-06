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
  onSave: (banner: Banner) => string | null;
  onClear: () => void;
  onClose: () => void;
}

const AdvertDialog = ({ seat, current, onSave, onClear, onClose }: AdvertDialogProps) => {
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

  const save = () => {
    if (!image) return setError('Choose an image first.');
    const failure = onSave({ image, alt: alt.trim() || `Advert on seat ${seat}`, href: href.trim() || undefined });
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-seat-night/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Advertise on seat ${seat}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md border border-seat-edge bg-seat-panel p-5 shadow-2xl">
        <header className="mb-4 flex items-baseline gap-3">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.2em] text-seat-amber">Seat {seat}</h2>
          <p className="text-[11px] uppercase tracking-[0.14em] text-blue-100/40">Your billboard</p>
          <button
            ref={first}
            type="button"
            onClick={onClose}
            className="ml-auto px-2 text-[18px] leading-none text-blue-100/50 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="flex gap-4">
          <div
            className="grid h-24 w-24 flex-none place-items-center border border-seat-edge bg-black/40"
            aria-hidden={!image}
          >
            {image
              ? <img src={image} alt="" className="h-full w-full object-cover" />
              : <span className="text-[10px] uppercase tracking-[0.14em] text-blue-100/30">1:1</span>}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-blue-100/45">Image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => take(e.target.files?.[0])}
                className="block w-full text-[11px] text-blue-100/70 file:mr-3 file:border file:border-seat-edge file:bg-white/5 file:px-2.5 file:py-1 file:text-[10px] file:uppercase file:tracking-[0.14em] file:text-seat-cyan hover:file:bg-white/10"
              />
            </label>
            <p className="text-[10.5px] leading-relaxed text-blue-100/40">
              Cropped square from the centre and stored at {BANNER_SIZE}px. Any shape works; only the middle of it lands on the seat.
            </p>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-blue-100/45">Description</span>
          <input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            maxLength={120}
            placeholder="What the advert says"
            className="w-full border border-seat-edge bg-black/30 px-2.5 py-1.5 text-[12px] text-blue-50 placeholder:text-blue-100/25 focus:border-seat-cyan focus:outline-none"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[10px] uppercase tracking-[0.16em] text-blue-100/45">Link (optional)</span>
          <input
            value={href}
            onChange={(e) => setHref(e.target.value)}
            inputMode="url"
            placeholder="https://"
            className="w-full border border-seat-edge bg-black/30 px-2.5 py-1.5 text-[12px] text-blue-50 placeholder:text-blue-100/25 focus:border-seat-cyan focus:outline-none"
          />
        </label>

        {error && <p role="alert" className="mt-3 text-[11.5px] text-red-300">{error}</p>}

        <p className="mt-4 border-t border-white/10 pt-3 text-[10.5px] leading-relaxed text-blue-100/40">
          Saved in this browser only. Everyone else sees the published wall until yours is accepted onto it.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="border border-seat-amber bg-seat-amber px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-seat-night disabled:opacity-40"
          >
            {busy ? 'Cropping…' : 'Put it up'}
          </button>
          {current && (
            <button
              type="button"
              onClick={() => { onClear(); onClose(); }}
              className="border border-seat-edge px-4 py-1.5 text-[11px] uppercase tracking-[0.16em] text-blue-100/60 hover:text-white"
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
