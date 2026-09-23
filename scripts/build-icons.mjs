#!/usr/bin/env node
/**
 * Draws the favicon and the app icons from the logo, so they can never drift
 * from it:
 *
 *   public/seat-airlines-logo.svg  →  favicon.svg, icon-square.svg,
 *                                     favicon-32.png, apple-touch-icon.png,
 *                                     icon-192.png, icon-512.png
 *
 *   npm run icons
 *
 * The SVGs nest the logo's own markup, framed to its disc, because an icon —
 * like any image — cannot load another file. The PNGs need a browser to
 * rasterise them: the script uses Playwright when it can import it (set
 * PLAYWRIGHT_MODULE to its path if it is installed globally) and says so when
 * it cannot.
 */
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const pub = (name) => new URL(`public/${name}`, root);

const logo = (await readFile(pub('seat-airlines-logo.svg'), 'utf8')).trim();
/* The disc's frame on the logo's canvas: read from the component that draws
   the logo on the page, so the tab and the top bar crop it the same way. */
const mark = await readFile(new URL('src/components/Mark.tsx', root), 'utf8');
const frame = mark.match(/LOGO_FRAME = '([^']+)'/)?.[1];
if (!frame) throw new Error('LOGO_FRAME not found in src/components/Mark.tsx');

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const favicon = `<svg ${NS} viewBox="${frame}" width="420" height="420">${logo}</svg>\n`;

/* The maskable icon: the disc inside the safe zone, on the light panel
   ground, as the icons have always been drawn. */
const S = 512;
const disc = Math.round(S * 0.784);
const at = (S - disc) / 2;
const square =
  `<svg ${NS} viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">` +
  `<rect width="${S}" height="${S}" fill="#DFE0E4"/>` +
  `<svg x="${at}" y="${at}" width="${disc}" height="${disc}" viewBox="${frame}">${logo}</svg></svg>\n`;

await writeFile(pub('favicon.svg'), favicon);
await writeFile(pub('icon-square.svg'), square);
console.log('wrote favicon.svg, icon-square.svg');

const pw = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright').catch(() => null);
if (!pw) {
  console.log('Playwright not found: PNG icons left as they were.');
} else {
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  const raster = async (svg, name, size, transparent) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      '<body style="margin:0;background:transparent">' +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" ` +
      `width="${size}" height="${size}" style="display:block"></body>`,
    );
    await page.waitForFunction(() => document.images[0]?.complete && document.images[0].naturalWidth > 0);
    await page.screenshot({ path: new URL(`public/${name}`, root).pathname, omitBackground: transparent });
    console.log(`wrote ${name}`);
  };
  await raster(favicon, 'favicon-32.png', 32, true);
  await raster(square, 'apple-touch-icon.png', 180, false);
  await raster(square, 'icon-192.png', 192, false);
  await raster(square, 'icon-512.png', 512, false);
  await browser.close();
}
