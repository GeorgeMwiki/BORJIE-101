import { describe, expect, it } from 'vitest';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import {
  compressForClient,
  isCompressible,
  pickEncoding,
} from '../cache/compression.js';

describe('pickEncoding', () => {
  it('returns identity for no Accept-Encoding header', () => {
    expect(pickEncoding(undefined)).toBe('identity');
    expect(pickEncoding(null)).toBe('identity');
    expect(pickEncoding('')).toBe('identity');
  });

  it('returns br when client supports br', () => {
    expect(pickEncoding('br, gzip')).toBe('br');
    expect(pickEncoding('gzip, deflate, br')).toBe('br');
  });

  it('falls back to gzip when only gzip is supported', () => {
    expect(pickEncoding('gzip, deflate')).toBe('gzip');
  });

  it('returns identity when no supported codec advertised', () => {
    expect(pickEncoding('deflate')).toBe('identity');
  });
});

describe('compressForClient', () => {
  // Build a payload >1KB so compression kicks in
  const largePayload = JSON.stringify({ data: 'x'.repeat(2000) });

  it('skips compression for small payloads (<1KB)', () => {
    const r = compressForClient('hello', 'br, gzip');
    expect(r.encoding).toBe('identity');
  });

  it('produces a valid Brotli stream when client supports br', () => {
    const r = compressForClient(largePayload, 'br, gzip');
    expect(r.encoding).toBe('br');
    expect(r.body.byteLength).toBeLessThan(largePayload.length);
    const decoded = brotliDecompressSync(r.body).toString('utf-8');
    expect(decoded).toBe(largePayload);
  });

  it('produces a valid gzip stream when client only supports gzip', () => {
    const r = compressForClient(largePayload, 'gzip');
    expect(r.encoding).toBe('gzip');
    const decoded = gunzipSync(r.body).toString('utf-8');
    expect(decoded).toBe(largePayload);
  });

  it('returns identity when no supported codec', () => {
    const r = compressForClient(largePayload, 'deflate');
    expect(r.encoding).toBe('identity');
  });
});

describe('isCompressible', () => {
  it('accepts JSON', () => {
    expect(isCompressible('application/json')).toBe(true);
    expect(isCompressible('application/json; charset=utf-8')).toBe(true);
  });

  it('accepts text/*', () => {
    expect(isCompressible('text/html')).toBe(true);
    expect(isCompressible('text/css')).toBe(true);
  });

  it('accepts SVG', () => {
    expect(isCompressible('image/svg+xml')).toBe(true);
  });

  it('rejects binary types', () => {
    expect(isCompressible('image/png')).toBe(false);
    expect(isCompressible('application/octet-stream')).toBe(false);
  });
});
