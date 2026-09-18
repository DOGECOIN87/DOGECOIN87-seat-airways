import { BANNER_SIZE, MAX_UPLOAD_BYTES } from './banners';

export interface FilterState {
  brightness: number;
  contrast: number;
  saturate: number;
  grayscale: number;
  sepia: number;
}

export interface EditState {
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotate: 0 | 90 | 180 | 270;
  flip: boolean;
  filter: FilterState;
}

export const defaultEdit = (): EditState => ({
  zoom: 1, offsetX: 0, offsetY: 0, rotate: 0, flip: false,
  filter: { brightness: 1, contrast: 1, saturate: 1, grayscale: 0, sepia: 0 },
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const filterCss = (f: FilterState) =>
  `brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturate}) grayscale(${f.grayscale}) sepia(${f.sepia})`;

export async function loadImage(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is over 8 MB.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('That image took too long to read.')), 20000);
      img.onload = () => { window.clearTimeout(timer); resolve(); };
      img.onerror = () => { window.clearTimeout(timer); reject(new Error('That image could not be read.')); };
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('That image has no pixels.');
    return img;
  } finally { URL.revokeObjectURL(url); }
}

export function loadImageFromSrc(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The current image could not be reloaded for editing.'));
    img.src = src;
  });
}

export function cropCenter(img: HTMLImageElement, edit: EditState) {
  const w = img.naturalWidth, h = img.naturalHeight;
  const crop = Math.min(w, h) / edit.zoom;
  const maxX = Math.max(0, w / 2 - crop / 2);
  const maxY = Math.max(0, h / 2 - crop / 2);
  let px = clamp(edit.offsetX, -1, 1) * maxX;
  let py = clamp(edit.offsetY, -1, 1) * maxY;
  if (edit.rotate === 180) { px = -px; py = -py; }
  if (edit.rotate === 90) [px, py] = [py, -px];
  if (edit.rotate === 270) [px, py] = [-py, px];
  return { cx: w / 2 + px, cy: h / 2 + py, crop };
}

export function panBy(img: HTMLImageElement, edit: EditState, dx: number, dy: number) {
  const crop = Math.min(img.naturalWidth, img.naturalHeight) / edit.zoom;
  const maxX = Math.max(0, img.naturalWidth / 2 - crop / 2);
  const maxY = Math.max(0, img.naturalHeight / 2 - crop / 2);
  return {
    offsetX: maxX ? clamp(edit.offsetX - dx / maxX, -1, 1) : 0,
    offsetY: maxY ? clamp(edit.offsetY - dy / maxY, -1, 1) : 0,
  };
}

const estimatedBytes = (url: string) => Math.ceil((url.length - url.indexOf(',') - 1) * 0.75);
export interface RenderedBanner { dataUrl: string; bytes: number; type: string; }

export function renderBanner(img: HTMLImageElement, edit: EditState, size = BANNER_SIZE): RenderedBanner {
  const { cx, cy, crop } = cropCenter(img, edit);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot process images.');
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = filterCss(edit.filter);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(edit.rotate * Math.PI / 180);
  ctx.scale(edit.flip ? -1 : 1, 1);
  ctx.drawImage(img, cx - crop / 2, cy - crop / 2, crop, crop, -size / 2, -size / 2, size, size);
  ctx.restore();
  const attempts: Array<[string, number]> = [
    ['image/webp', .9], ['image/webp', .75], ['image/webp', .6],
    ['image/jpeg', .85], ['image/jpeg', .7], ['image/jpeg', .55],
  ];
  let best: RenderedBanner | null = null;
  for (const [type, quality] of attempts) {
    const dataUrl = canvas.toDataURL(type, quality);
    if (!dataUrl.startsWith(`data:${type}`)) continue;
    const out = { dataUrl, bytes: estimatedBytes(dataUrl), type };
    if (!best || out.bytes < best.bytes) best = out;
    if (out.bytes <= 512 * 1024) return out;
  }
  if (best) return best;
  throw new Error('Could not encode the image. Try a smaller or simpler one.');
}
