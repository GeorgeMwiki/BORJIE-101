#!/usr/bin/env node
/**
 * build-brand-assets — rasterise the Borjie SVG brand assets into the
 * PNG + ICO formats every web app needs in its `public/` folder.
 *
 * Inputs (from `packages/design-system/src/brand/`):
 *   - borjie-favicon-16.svg
 *   - borjie-favicon-32.svg
 *   - borjie-favicon-48.svg
 *   - borjie-apple-touch-180.svg
 *   - borjie-mark.svg
 *   - borjie-og-1200x630.svg
 *
 * Outputs (per app — marketing / owner-web / admin-web):
 *   - public/favicon.ico            (multi-resolution: 16, 32, 48)
 *   - public/apple-touch-icon.png   (180 x 180)
 *   - public/icon-192.png           (PWA)
 *   - public/icon-512.png           (PWA)
 *   - public/icon-maskable-512.png  (PWA maskable)
 *   - public/og-image.png           (1200 x 630 social share)
 *
 * Idempotent. Run via `node scripts/build-brand-assets.mjs`.
 *
 * Uses `sharp` for SVG→PNG conversion. The .ico is assembled by
 * stitching 16/32/48 PNG buffers into the multi-image ICO container
 * format described in the wikipedia ICO spec.
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
const apps = ['marketing', 'owner-web', 'admin-web'];

async function svgToPng(svgPath, sizePx) {
  const buf = await fs.readFile(svgPath);
  return sharp(buf, { density: 384 })
    .resize(sizePx, sizePx, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function svgToPngExact(svgPath, width, height) {
  const buf = await fs.readFile(svgPath);
  return sharp(buf, { density: 384 })
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

/**
 * Build a Windows .ico container from one or more PNG buffers. The
 * .ico format header is 6 bytes, then a 16-byte directory entry per
 * image, then each PNG payload appended.
 */
function buildIco(pngs) {
  const sizes = pngs.map((p) => p.size);
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach((p, i) => {
    const off = i * 16;
    entries.writeUInt8(p.size === 256 ? 0 : p.size, off + 0);
    entries.writeUInt8(p.size === 256 ? 0 : p.size, off + 1);
    entries.writeUInt8(0, off + 2);
    entries.writeUInt8(0, off + 3);
    entries.writeUInt16LE(1, off + 4);
    entries.writeUInt16LE(32, off + 6);
    entries.writeUInt32LE(p.buf.length, off + 8);
    entries.writeUInt32LE(offset, off + 12);
    offset += p.buf.length;
  });

  return Buffer.concat([header, entries, ...pngs.map((p) => p.buf)]);
}

async function buildForApp(appName) {
  const publicDir = path.join(repoRoot, 'apps', appName, 'public');
  await fs.mkdir(publicDir, { recursive: true });

  const fav16 = await svgToPng(path.join(brandDir, 'borjie-favicon-16.svg'), 16);
  const fav32 = await svgToPng(path.join(brandDir, 'borjie-favicon-32.svg'), 32);
  const fav48 = await svgToPng(path.join(brandDir, 'borjie-favicon-48.svg'), 48);

  const ico = buildIco([
    { size: 16, buf: fav16 },
    { size: 32, buf: fav32 },
    { size: 48, buf: fav48 },
  ]);
  await fs.writeFile(path.join(publicDir, 'favicon.ico'), ico);

  const apple = await svgToPng(path.join(brandDir, 'borjie-apple-touch-180.svg'), 180);
  await fs.writeFile(path.join(publicDir, 'apple-touch-icon.png'), apple);

  const icon192 = await svgToPng(path.join(brandDir, 'borjie-apple-touch-180.svg'), 192);
  await fs.writeFile(path.join(publicDir, 'icon-192.png'), icon192);

  const icon512 = await svgToPng(path.join(brandDir, 'borjie-apple-touch-180.svg'), 512);
  await fs.writeFile(path.join(publicDir, 'icon-512.png'), icon512);

  const maskable = await svgToPng(path.join(brandDir, 'borjie-apple-touch-180.svg'), 512);
  await fs.writeFile(path.join(publicDir, 'icon-maskable-512.png'), maskable);

  const og = await svgToPngExact(path.join(brandDir, 'borjie-og-1200x630.svg'), 1200, 630);
  await fs.writeFile(path.join(publicDir, 'og-image.png'), og);

  console.log(`[brand-assets] ${appName}: favicon.ico + 5 PNGs written`);
}

async function main() {
  for (const app of apps) {
    await buildForApp(app);
  }
  console.log('[brand-assets] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
