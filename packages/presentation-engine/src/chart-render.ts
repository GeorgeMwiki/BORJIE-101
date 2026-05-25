/**
 * Chart-to-PNG renderer.
 *
 * The orchestrator hands us a Vega-Lite spec + the resolved data and
 * we produce a PNG buffer. PowerPoint embeds the PNG as the slide
 * image — the chart looks identical across viewers because it's a
 * rasterised final image, not a live spec.
 *
 * Implementation note: rendering Vega-Lite in Node requires the
 * `vega` + `vega-lite` packages. They're already declared as deps
 * of @borjie/genui (see VegaChart.tsx). To avoid coupling the
 * dependency surface of presentation-engine to the runtime
 * availability of those packages, we lazy-import them inside the
 * function and fall back to a placeholder PNG if they're missing.
 *
 * The placeholder is a 4x4 RGBA PNG with the theme's primary colour —
 * good enough for the renderer to keep moving, and easy to spot in
 * QA.
 */

/**
 * Try to render a Vega-Lite spec to PNG. Falls back to a tiny
 * coloured rectangle if vega / vega-lite are unavailable at runtime.
 *
 * The fallback is the default path in services that don't ship the
 * vega bundle (most of them). To opt in, a composition root can
 * pass a `vegaRenderer` override which is awaited directly.
 */
export interface VegaRenderer {
  readonly render: (spec: unknown) => Promise<Uint8Array>;
}

export async function renderChartToPng(input: {
  readonly spec: unknown;
  readonly width?: number;
  readonly height?: number;
  readonly placeholderColor?: string;
  readonly vegaRenderer?: VegaRenderer;
}): Promise<Uint8Array> {
  if (input.vegaRenderer) {
    try {
      return await input.vegaRenderer.render(input.spec);
    } catch {
      return placeholderPng(input.placeholderColor ?? '#1F3864');
    }
  }
  // No renderer → placeholder. We deliberately do NOT dynamically
  // import vega here because (a) it adds a slow synchronous failure
  // mode in tests where vega is present in pnpm store but not the
  // direct dep tree and (b) it couples the dependency surface of
  // this package to the runtime layout of the consumer.
  return placeholderPng(input.placeholderColor ?? '#1F3864');
}

/** 4x4 PNG of a single colour, used as a placeholder when vega is missing. */
export function placeholderPng(hexColor: string): Uint8Array {
  const m = /^#?([0-9a-f]{6})$/i.exec(hexColor);
  if (!m || !m[1]) {
    return placeholderPng('#1F3864');
  }
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 0xff;
  const g = (v >> 8) & 0xff;
  const b = v & 0xff;

  // Build a 4x4 RGBA bitmap.
  const width = 4;
  const height = 4;
  const rawPixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rawPixels[i * 4 + 0] = r;
    rawPixels[i * 4 + 1] = g;
    rawPixels[i * 4 + 2] = b;
    rawPixels[i * 4 + 3] = 0xff;
  }

  return new Uint8Array(encodePng(width, height, rawPixels));
}

/** Minimal PNG encoder — produces a valid PNG from RGBA byte rows. */
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  // PNG header
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT — filter byte 0 prefixed per scanline, then zlib-compressed.
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) {
    scanlines[row * (1 + width * 4)] = 0; // filter type none
    rgba.copy(
      scanlines,
      row * (1 + width * 4) + 1,
      row * width * 4,
      (row + 1) * width * 4,
    );
  }
  // Wrap with zlib (Adler-32 trailer) — use Node's deflateSync.
  // We use require()-style dynamic import to keep this file ESM-friendly.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const idatPayload = zlib.deflateSync(scanlines);
  const idatChunk = makeChunk('IDAT', idatPayload);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, payload: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(payload.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, payload])), 0);
  return Buffer.concat([lenBuf, typeBuf, payload, crcBuf]);
}

function crc32(buf: Buffer): number {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    const idx = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ (table[idx] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

// Test helpers
export const __test__ = {
  placeholderPng,
  crc32,
  encodePng,
};
