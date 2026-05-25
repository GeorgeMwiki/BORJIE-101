/**
 * Brotli / Gzip compression helpers — wrap a Node `Buffer | string`
 * payload with the appropriate `Content-Encoding`. Picks Brotli when
 * the client advertised it in `Accept-Encoding`, falls back to gzip,
 * then identity.
 *
 * Brotli beats gzip by 15-25% on JSON/HTML/CSS/JS payloads and is
 * supported in 100% of modern browsers. Hono's built-in compress()
 * middleware does NOT support `br` natively (issue #3543 still open);
 * we provide this drop-in.
 *
 * Source: ayrshare.com/http-compression-in-node-js + dohost.us/2026/
 * brotli-for-apis. Brotli levels 0-6 are fast enough for live HTTP;
 * levels 9-11 are file-prep only.
 */

import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib';

export type EncodingChoice = 'br' | 'gzip' | 'identity';

export interface CompressedResult {
  readonly body: Uint8Array;
  readonly encoding: EncodingChoice;
}

/** Parse the Accept-Encoding header and pick the best supported codec. */
export function pickEncoding(acceptEncoding: string | undefined | null): EncodingChoice {
  if (acceptEncoding === undefined || acceptEncoding === null || acceptEncoding === '') {
    return 'identity';
  }
  const lower = acceptEncoding.toLowerCase();
  // Reject identity;q=0 only patterns
  if (/\bbr\b(?!\s*;\s*q\s*=\s*0)/.test(lower)) return 'br';
  if (/\bgzip\b(?!\s*;\s*q\s*=\s*0)/.test(lower)) return 'gzip';
  return 'identity';
}

/** Brotli quality level 4 (fast) for live HTTP. CPU vs ratio sweet spot. */
const BROTLI_QUALITY = 4;

/**
 * Compress a payload with the best codec accepted by the client.
 * Skips compression when payload is <1KB (compression CPU > savings).
 */
export function compressForClient(
  payload: string | Uint8Array,
  acceptEncoding: string | undefined | null,
): CompressedResult {
  const buf = typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
  if (buf.byteLength < 1024) {
    return { body: buf, encoding: 'identity' };
  }
  const chosen = pickEncoding(acceptEncoding);
  if (chosen === 'br') {
    const compressed = brotliCompressSync(buf, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY },
    });
    return { body: new Uint8Array(compressed), encoding: 'br' };
  }
  if (chosen === 'gzip') {
    const compressed = gzipSync(buf, { level: 6 });
    return { body: new Uint8Array(compressed), encoding: 'gzip' };
  }
  return { body: buf, encoding: 'identity' };
}

/**
 * Hono middleware variant — adds Content-Encoding when the response
 * is compressible. Structurally typed against Hono v4.
 */
export function honoCompress() {
  return async function compressMiddleware(
    c: {
      req: { header(name: string): string | undefined };
      res: Response;
      header(name: string, value: string): void;
    },
    next: () => Promise<void>,
  ): Promise<void> {
    await next();
    const contentType = c.res.headers.get('content-type') ?? '';
    if (!isCompressible(contentType)) return;
    if (c.res.headers.has('content-encoding')) return;
    const accept = c.req.header('Accept-Encoding');
    const body = await c.res.clone().arrayBuffer();
    const { body: compressed, encoding } = compressForClient(
      new Uint8Array(body),
      accept,
    );
    if (encoding === 'identity') return;
    const headers = new Headers(c.res.headers);
    headers.set('content-encoding', encoding);
    headers.set('content-length', String(compressed.byteLength));
    headers.append('vary', 'Accept-Encoding');
    // Allocate a fresh ArrayBuffer-backed view so the BodyInit shape
    // matches lib.dom.d.ts. Uint8Array<SharedArrayBuffer> would be
    // rejected; the manual copy guarantees plain ArrayBuffer backing.
    const copyBuf = new ArrayBuffer(compressed.byteLength);
    new Uint8Array(copyBuf).set(compressed);
    (c as { res: Response }).res = new Response(copyBuf, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  };
}

const COMPRESSIBLE_PREFIXES = [
  'text/',
  'application/json',
  'application/javascript',
  'application/manifest+json',
  'application/xml',
  'application/xhtml+xml',
  'image/svg+xml',
];

export function isCompressible(contentType: string): boolean {
  const lc = contentType.toLowerCase();
  return COMPRESSIBLE_PREFIXES.some((p) => lc.startsWith(p));
}
