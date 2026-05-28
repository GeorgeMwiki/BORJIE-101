#!/usr/bin/env node
/**
 * build-mobile-brand-assets — render the Expo icon + splash + adaptive
 * icon + favicon assets for the workforce-mobile and buyer-mobile apps
 * from the canonical Borjie SVG brand sources.
 *
 * Targets per app (under `apps/<name>/assets/`):
 *   - icon.png             1024 x 1024 (Expo iOS/Android master icon)
 *   - adaptive-icon.png    1024 x 1024 (Android adaptive foreground)
 *   - splash.png           1242 x 2436 (iPhone XS standard)
 *   - favicon.png          48 x 48 (Expo web)
 *
 * The icon source is `borjie-mark.svg` rendered onto a midnight
 * background tile. The splash centres a 60% mark on the midnight
 * field. All idempotent — re-runs cleanly overwrite the previous
 * outputs.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const brandDir = path.join(
  repoRoot,
  'packages',
  'design-system',
  'src',
  'brand',
);

const apps = ['workforce-mobile', 'buyer-mobile'];

async function renderMarkOnto(bg, sizePx, padPct) {
  const inner = Math.round(sizePx * (1 - padPct * 2));
  const padPx = Math.round(sizePx * padPct);
  const svg = await fs.readFile(path.join(brandDir, 'borjie-mark.svg'));
  const markPng = await sharp(svg, { density: 512 })
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: sizePx,
      height: sizePx,
      channels: 4,
      background: bg,
    },
  })
    .composite([{ input: markPng, top: padPx, left: padPx }])
    .png()
    .toBuffer();
}

async function renderSplash(bg, width, height, markFraction) {
  const markSize = Math.round(Math.min(width, height) * markFraction);
  const svg = await fs.readFile(path.join(brandDir, 'borjie-mark.svg'));
  const markPng = await sharp(svg, { density: 512 })
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const top = Math.round((height - markSize) / 2);
  const left = Math.round((width - markSize) / 2);

  return sharp({
    create: { width, height, channels: 4, background: bg },
  })
    .composite([{ input: markPng, top, left }])
    .png()
    .toBuffer();
}

async function buildForMobileApp(appName) {
  const assetsDir = path.join(repoRoot, 'apps', appName, 'assets');
  await fs.mkdir(assetsDir, { recursive: true });

  // Borjie midnight near-black, warm-shifted.
  const bg = { r: 0x17, g: 0x10, b: 0x0a, alpha: 1 };

  const icon = await renderMarkOnto(bg, 1024, 0.16);
  await fs.writeFile(path.join(assetsDir, 'icon.png'), icon);

  // Adaptive icon foreground is transparent — Android composites it onto
  // the adaptiveIcon.backgroundColor at runtime.
  const adaptive = await renderMarkOnto({ r: 0, g: 0, b: 0, alpha: 0 }, 1024, 0.24);
  await fs.writeFile(path.join(assetsDir, 'adaptive-icon.png'), adaptive);

  const splash = await renderSplash(bg, 1242, 2436, 0.42);
  await fs.writeFile(path.join(assetsDir, 'splash.png'), splash);

  const favicon = await renderMarkOnto(bg, 48, 0.08);
  await fs.writeFile(path.join(assetsDir, 'favicon.png'), favicon);

  console.log(`[mobile-brand] ${appName}: icon + adaptive + splash + favicon written`);
}

async function main() {
  for (const app of apps) {
    await buildForMobileApp(app);
  }
  console.log('[mobile-brand] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
