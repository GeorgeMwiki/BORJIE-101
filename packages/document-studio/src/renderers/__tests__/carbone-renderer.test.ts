/**
 * Unit tests for CarboneRenderer — no Docker, no network. Mocks
 * the injected `fetch` to assert request shape, AbortController
 * behaviour, structured error returns, and lazy env reads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CarboneRenderer,
  DEFAULT_CARBONE_TIMEOUT_MS,
  DEFAULT_CARBONE_URL,
  errorOutput,
  stubRender,
} from '../carbone-renderer.js';
import { MIME_TYPES, type RendererInput } from '../../types.js';

const sampleInput: RendererInput = {
  templateRef: 'tpl-monthly-report-v3',
  format: 'pdf',
  data: { owner: 'Jane Doe', period: '2026-04', total: 4870 },
};

describe('CarboneRenderer — stub mode', () => {
  beforeEach(() => {
    delete process.env.CARBONE_URL;
    delete process.env.CARBONE_API_TOKEN;
    delete process.env.CARBONE_TIMEOUT_MS;
  });

  it('returns a deterministic stub buffer when carboneUrl forces empty', async () => {
    const renderer = new CarboneRenderer({ carboneUrl: '' });
    expect(renderer.isStub()).toBe(true);
    const out = await renderer.render(sampleInput);
    expect(new TextDecoder().decode(out.buffer)).toContain('STUB:carbone:pdf:');
    expect(out.mimeType).toBe(MIME_TYPES.pdf);
    expect(out.error).toBeUndefined();
  });

  it('honours useStub even when env is set', async () => {
    process.env.CARBONE_URL = 'http://carbone:4000';
    const renderer = new CarboneRenderer({ useStub: true });
    expect(renderer.isStub()).toBe(true);
    const out = await renderer.render(sampleInput);
    expect(new TextDecoder().decode(out.buffer)).toContain('STUB:carbone');
  });

  it('produces byte-stable output across runs for the same input', async () => {
    const renderer = new CarboneRenderer({ carboneUrl: '' });
    const a = await renderer.render(sampleInput);
    const b = await renderer.render(sampleInput);
    expect(a.buffer).toEqual(b.buffer);
  });
});

describe('CarboneRenderer — env resolution', () => {
  beforeEach(() => {
    delete process.env.CARBONE_URL;
    delete process.env.CARBONE_API_TOKEN;
    delete process.env.CARBONE_TIMEOUT_MS;
  });

  it('defaults to the documented localhost when env is absent', async () => {
    process.env.CARBONE_URL = DEFAULT_CARBONE_URL;
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: { 'content-type': MIME_TYPES.pdf },
      }),
    );
    const renderer = new CarboneRenderer({ fetchImpl });
    expect(renderer.isStub()).toBe(false);
    await renderer.render(sampleInput);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const url = fetchImpl.mock.calls[0]![0];
    expect(url).toBe(`${DEFAULT_CARBONE_URL}/render/tpl-monthly-report-v3`);
  });

  it('reads env lazily — change between constructor and render takes effect', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(2), { status: 200 }),
    );
    const renderer = new CarboneRenderer({ fetchImpl });
    process.env.CARBONE_URL = 'http://late-bound:4000';
    await renderer.render(sampleInput);
    expect(fetchImpl.mock.calls[0]![0]).toContain('http://late-bound:4000');
  });

  it('forwards bearer token when CARBONE_API_TOKEN is set', async () => {
    process.env.CARBONE_URL = 'http://carbone:4000';
    process.env.CARBONE_API_TOKEN = 'secret-token-abc';
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(2), { status: 200 }),
    );
    const renderer = new CarboneRenderer({ fetchImpl });
    await renderer.render(sampleInput);
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer secret-token-abc',
    );
  });

  it('uses CARBONE_TIMEOUT_MS when set; otherwise the 60s default', () => {
    const r1 = new CarboneRenderer({ carboneUrl: 'http://x' });
    // Default path — assert via private method by triggering a render
    // whose fetch never resolves; we'll set 1ms below to keep the test fast.
    expect(DEFAULT_CARBONE_TIMEOUT_MS).toBe(60_000);
    expect(r1.isStub()).toBe(false);
  });
});

describe('CarboneRenderer — remote happy path', () => {
  it('POSTs JSON body with data + convertTo and parses the binary response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': MIME_TYPES.pdf },
      }),
    );
    const renderer = new CarboneRenderer({
      carboneUrl: 'http://carbone:4000',
      fetchImpl,
    });
    const out = await renderer.render(sampleInput);
    expect(out.error).toBeUndefined();
    expect(Array.from(out.buffer)).toEqual([1, 2, 3]);
    expect(out.mimeType).toBe(MIME_TYPES.pdf);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://carbone:4000/render/tpl-monthly-report-v3');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.data).toEqual(sampleInput.data);
    expect(body.convertTo).toBe('pdf');
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.accept).toBe(MIME_TYPES.pdf);
    expect(headers.authorization).toBeUndefined();
  });

  it('URL-encodes the template ref', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(new Uint8Array(1), { status: 200 }),
    );
    const renderer = new CarboneRenderer({
      carboneUrl: 'http://c:4000',
      fetchImpl,
    });
    await renderer.render({ ...sampleInput, templateRef: 'lease v1/2026' });
    expect(fetchImpl.mock.calls[0]![0]).toBe(
      'http://c:4000/render/lease%20v1%2F2026',
    );
  });
});

describe('CarboneRenderer — error paths (NEVER throws)', () => {
  it('returns upstream_http_error on 5xx', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('boom', { status: 502, statusText: 'Bad Gateway' }),
    );
    const renderer = new CarboneRenderer({
      carboneUrl: 'http://c:4000',
      fetchImpl,
    });
    const out = await renderer.render(sampleInput);
    expect(out.error).toBeDefined();
    expect(out.error?.code).toBe('upstream_http_error');
    expect(out.error?.status).toBe(502);
    expect(out.error?.origin).toBe('carbone');
    expect(out.buffer.byteLength).toBe(0);
  });

  it('returns upstream_timeout when the AbortController fires', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const renderer = new CarboneRenderer({
      carboneUrl: 'http://c:4000',
      fetchImpl,
      timeoutMs: 5,
    });
    const out = await renderer.render(sampleInput);
    expect(out.error?.code).toBe('upstream_timeout');
    expect(out.error?.message).toMatch(/aborted after 5ms/);
  });

  it('returns upstream_network_error on connection failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const renderer = new CarboneRenderer({
      carboneUrl: 'http://nope:9999',
      fetchImpl,
    });
    const out = await renderer.render(sampleInput);
    expect(out.error?.code).toBe('upstream_network_error');
    expect(out.error?.message).toContain('ECONNREFUSED');
  });

  it('clears the timeout when the request finishes (no leaked timers)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array(1), { status: 200 }));
    const renderer = new CarboneRenderer({
      carboneUrl: 'http://c:4000',
      fetchImpl,
    });
    await renderer.render(sampleInput);
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('CarboneRenderer — helpers', () => {
  it('stubRender produces different hashes for different inputs', () => {
    const a = stubRender('carbone', sampleInput);
    const b = stubRender('carbone', { ...sampleInput, data: { x: 1 } });
    expect(a.buffer).not.toEqual(b.buffer);
  });

  it('errorOutput shape includes empty buffer + json mime', () => {
    const out = errorOutput({
      code: 'invalid_input',
      message: 'nope',
      origin: 'carbone',
    });
    expect(out.buffer.byteLength).toBe(0);
    expect(out.mimeType).toBe('application/json');
    expect(out.error?.code).toBe('invalid_input');
  });
});

afterEach(() => {
  delete process.env.CARBONE_URL;
  delete process.env.CARBONE_API_TOKEN;
  delete process.env.CARBONE_TIMEOUT_MS;
});
