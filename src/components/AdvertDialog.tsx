import { useEffect, useRef, useState } from 'react';
import { type Banner } from '../lib/banners';
import { defaultEdit, filterCss, loadImage, loadImageFromSrc, panBy, renderBanner, type EditState } from '../lib/imageEdit';

interface AdvertDialogProps {
  seat: string; current: Banner | null;
  onSave: (banner: Banner) => Promise<string | null> | string | null;
  shared?: boolean; onClear: () => void; onClose: () => void;
}

const sliders: Array<{ key: keyof EditState['filter']; label: string; min: number; max: number; step: number }> = [
  { key: 'brightness', label: 'Bright', min: .4, max: 1.8, step: .05 },
  { key: 'contrast', label: 'Contrast', min: .4, max: 1.8, step: .05 },
  { key: 'saturate', label: 'Colour', min: 0, max: 2, step: .05 },
  { key: 'grayscale', label: 'Mono', min: 0, max: 1, step: .05 },
  { key: 'sepia', label: 'Sepia', min: 0, max: 1, step: .05 },
];
const prettyBytes = (n: number) => n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export default function AdvertDialog({ seat, current, onSave, onClear, onClose, shared }: AdvertDialogProps) {
  const own = current && !current.house ? current : null;
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [image, setImage] = useState(own?.image ?? '');
  const [edit, setEdit] = useState<EditState>(defaultEdit());
  const [bytes, setBytes] = useState(0);
  const [alt, setAlt] = useState(own?.alt ?? '');
  const [href, setHref] = useState(own?.href ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [grid, setGrid] = useState(true);
  const first = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    first.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  useEffect(() => {
    if (!own?.image) return;
    loadImageFromSrc(own.image).then(setSource).catch(() => undefined);
  }, [own?.image]);
  useEffect(() => {
    if (!source) return;
    const timer = window.setTimeout(() => {
      try { const out = renderBanner(source, edit); setImage(out.dataUrl); setBytes(out.bytes); }
      catch (e) { setError(e instanceof Error ? e.message : 'That edit could not be applied.'); }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [source, edit]);

  const take = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(null); setImage('');
    try { const img = await loadImage(file); setSource(img); setEdit(defaultEdit()); }
    catch (e) { setError(e instanceof Error ? e.message : 'That image could not be read.'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!image) return setError('Choose an image first.');
    setBusy(true); setError(null);
    try {
      const failure = await onSave({ image, alt: alt.trim() || `Advert on seat ${seat}`, href: href.trim() || undefined });
      if (failure) setError(failure); else onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'That advert could not be published.'); }
    finally { setBusy(false); }
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!source) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId || !source) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = Math.min(source.naturalWidth, source.naturalHeight) / edit.zoom / rect.width;
    const next = panBy(source, edit, (e.clientX - d.x) * scale, (e.clientY - d.y) * scale);
    d.x = e.clientX; d.y = e.clientY; setEdit(v => ({ ...v, ...next }));
  };
  const acceptPaste = (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); void take(file); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2B2F37]/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Advertise on seat ${seat}`} onPaste={acceptPaste} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="ui-card max-h-[94vh] w-full max-w-2xl overflow-y-auto p-5 sm:p-6">
      <header className="mb-4 flex items-baseline gap-3"><h2 className="text-[13px] font-bold uppercase tracking-[.2em] text-ui-deep">Seat {seat}</h2><p className="text-[11px] uppercase tracking-[.14em] text-ui-faint">Your billboard</p><button ref={first} type="button" onClick={onClose} className="ml-auto px-2 text-[18px] leading-none text-ui-soft" aria-label="Close">×</button></header>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]">
        <div>
          <div className="sa-editor-crop ui-well relative mx-auto aspect-square max-w-[360px] overflow-hidden" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void take(e.dataTransfer.files[0]); }}>
            {image ? <img src={image} alt="Edited advert preview" className="h-full w-full object-cover" style={{ filter: filterCss(edit.filter) }} /> : <button type="button" onClick={() => input.current?.click()} className="h-full w-full text-[11px] uppercase tracking-[.14em] text-ui-faint">Drop, paste, or choose an image</button>}
            {grid && image && <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_32.9%,rgba(255,255,255,.6)_33%,transparent_33.4%,transparent_66.2%,rgba(255,255,255,.6)_66.5%,transparent_67%),linear-gradient(0deg,transparent_32.9%,rgba(255,255,255,.6)_33%,transparent_33.4%,transparent_66.2%,rgba(255,255,255,.6)_66.5%,transparent_67%)]" />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2"><input ref={input} type="file" accept="image/*" hidden onChange={e => void take(e.target.files?.[0])} /><button type="button" className="sa-ghost px-3 py-1.5 text-[10px]" onClick={() => input.current?.click()}>Choose image</button><button type="button" className="sa-ghost px-3 py-1.5 text-[10px]" onClick={() => setEdit(defaultEdit())} disabled={!source}>Reset edits</button><button type="button" className="sa-ghost px-3 py-1.5 text-[10px]" onClick={() => setGrid(v => !v)} disabled={!image}>{grid ? 'Hide grid' : 'Show grid'}</button><span className="ml-auto text-[10px] uppercase tracking-[.12em] text-ui-faint">{busy ? 'Processing…' : bytes ? `${prettyBytes(bytes)} ready` : '512px square'}</span></div>
          <p className="mt-2 text-[10.5px] leading-relaxed text-ui-faint">Drag the crop to reposition it. Your wallet signs the exact edited bytes shown here.</p>
        </div>
        <div className="space-y-3">
          <div className="sa-adpreview mx-auto"><img src={image || current?.image || ''} alt="" /></div>
          <p className="text-center text-[10px] uppercase tracking-[.14em] text-ui-faint">On-seat preview</p>
          <label className="block text-[10px] uppercase tracking-[.14em] text-ui-faint">Zoom <input className="mt-1 w-full" type="range" min="1" max="4" step=".05" value={edit.zoom} onChange={e => setEdit(v => ({ ...v, zoom: Number(e.target.value) }))} /></label>
          {sliders.map(s => <label key={s.key} className="block text-[10px] uppercase tracking-[.14em] text-ui-faint">{s.label}<input className="mt-1 w-full" type="range" min={s.min} max={s.max} step={s.step} value={edit.filter[s.key]} onChange={e => setEdit(v => ({ ...v, filter: { ...v.filter, [s.key]: Number(e.target.value) } }))} /></label>)}
          <div className="flex gap-2"><button type="button" className="sa-ghost flex-1 px-2 py-1.5 text-[10px]" onClick={() => setEdit(v => ({ ...v, rotate: ((v.rotate + 90) % 360) as EditState['rotate'] }))}>Rotate</button><button type="button" className="sa-ghost flex-1 px-2 py-1.5 text-[10px]" onClick={() => setEdit(v => ({ ...v, flip: !v.flip }))}>Mirror</button></div>
        </div>
      </div>
      <label className="mt-4 block"><span className="mb-1 block text-[10px] uppercase tracking-[.16em] text-ui-faint">Description</span><input value={alt} onChange={e => setAlt(e.target.value)} maxLength={120} placeholder="What the advert says" className="ui-field" /></label>
      <label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase tracking-[.16em] text-ui-faint">Link (optional)</span><input value={href} onChange={e => setHref(e.target.value)} inputMode="url" placeholder="https://" className="ui-field" /></label>
      {error && <p role="alert" className="mt-3 text-[11.5px] font-semibold text-[#B3261E]">{error}</p>}
      <p className="mt-4 ui-rule pt-3 text-[10.5px] leading-relaxed text-ui-faint">{shared ? 'Your wallet will ask you to sign this advert. The signature proves the seat is yours and covers this exact image — it moves no funds.' : 'Saved in this browser only. Everyone else sees the published wall until yours is accepted onto it.'}</p>
      <div className="mt-4 flex gap-2"><button type="button" onClick={() => void save()} disabled={busy} className="sa-cta px-5 py-2 text-[11px] disabled:opacity-40">{busy ? 'Working…' : shared ? 'Sign and put it up' : 'Put it up'}</button>{current && <button type="button" onClick={() => { onClear(); onClose(); }} className="sa-ghost px-5 py-2 text-[11px]">Take it down</button>}</div>
    </div>
  </div>;
}
