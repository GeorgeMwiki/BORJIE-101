/**
 * Unit tests for TypstRenderer — no Docker, no real `typst` binary.
 * Verifies stub fallback, spawn-mode argument shape, server-mode
 * fallback, and structured error returns for missing binary +
 * non-zero exits + abort.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TYPST_BINARY,
  DEFAULT_TYPST_TIMEOUT_MS,
  TypstRenderer,
  type TypstSpawnFn,
} from '../typst-renderer.js';
import { type RendererInput } from '../../types.js';

const baseInput: RendererInput = {
  templateRef: '/tpl/eviction-notice-ke.typ',
  format: 'pdf',
  data: { tenant: 'Aisha M', unit: '4B', amount: 87500 },
};

const okSpawn: TypstSpawnFn = async () => ({
  stdout: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
  stderr: '',
  exitCode: 0,
});

describe('TypstRenderer — stub mode', () => {
  beforeEach(() => {
    delete process.env.TYPST_BINARY;
    delete process.env.TYPST_SERVER_URL;
    delete process.env.TYPST_TIMEOUT_MS;
  });

  it('falls back to stub when no binary + no server configured', async () => {
    const renderer = new TypstRenderer({ typstBinary: '', typstServerUrl: '' });
    expect(renderer.isStub()).toBe(true);
    const out = await renderer.render(baseInput);
    expect(new TextDecoder().decode(out.buffer)).toContain('STUB:typst:pdf:');
  });

  it('useStub overrides env', async () => {
    process.env.TYPST_BINARY = 'typst';
    const renderer = new TypstRenderer({ useStub: true });
    expect(renderer.isStub()).toBe(true);
    const out = await renderer.render(baseInput);
    expect(new TextDecoder().decode(out.buffer)).toContain('STUB:typst');
  });
});

describe('TypstRenderer — env resolution', () => {
  beforeEach(() => {
    delete process.env.TYPST_BINARY;
    delete process.env.TYPST_SERVER_URL;
    delete process.env.TYPST_TIMEOUT_MS;
  });

  it('prefers binary over server when both are set', async () => {
    process.env.TYPST_BINARY = '/usr/local/bin/typst';
    process.env.TYPST_SERVER_URL = 'http://typst:8001';
    const spawn = vi.fn(okSpawn);
    const renderer = new TypstRenderer({ spawn });
    await renderer.render(baseInput);
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]![0]).toBe('/usr/local/bin/typst');
  });

  it('uses default binary name "typst" when env unset but binary mode forced', async () => {
    process.env.TYPST_BINARY = DEFAULT_TYPST_BINARY;
    const spawn = vi.fn(okSpawn);
    const renderer = new TypstRenderer({ spawn });
    await renderer.render(baseInput);
    expect(spawn.mock.calls[0]![0]).toBe('typst');
  });

  it('falls through to server when only TYPST_SERVER_URL is set', async () => {
    process.env.TYPST_BINARY = '';
    process.env.TYPST_SERVER_URL = 'http://typst:8001';
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));
    const renderer = new TypstRenderer({ fetchImpl });
    const out = await renderer.render(baseInput);
    expect(out.error).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://typst:8001/compile');
  });

  it('default timeout is 60s', () => {
    expect(DEFAULT_TYPST_TIMEOUT_MS).toBe(60_000);
  });
});

describe('TypstRenderer — spawn path', () => {
  beforeEach(() => {
    delete process.env.TYPST_BINARY;
    delete process.env.TYPST_SERVER_URL;
  });

  it('builds the correct argv: compile <ref> - --input data=<json>', async () => {
    const spawn = vi.fn(okSpawn);
    const renderer = new TypstRenderer({
      typstBinary: 'typst',
      spawn,
      tempDir: '/tmp/test-render',
    });
    await renderer.render(baseInput);
    const [bin, args, opts] = spawn.mock.calls[0]!;
    expect(bin).toBe('typst');
    expect(args).toEqual([
      'compile',
      '/tpl/eviction-notice-ke.typ',
      '-',
      '--input',
      `data=${JSON.stringify(baseInput.data)}`,
    ]);
    expect(opts).toEqual({ cwd: '/tmp/test-render', timeoutMs: 60_000 });
  });

  it('returns PDF buffer from stdout on exit 0', async () => {
    const spawn = vi.fn(okSpawn);
    const renderer = new TypstRenderer({ typstBinary: 'typst', spawn });
    const out = await renderer.render(baseInput);
    expect(out.error).toBeUndefined();
    expect(out.mimeType).toBe('application/pdf');
    expect(Array.from(out.buffer)).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it('returns binary_failed on non-zero exit', async () => {
    const spawn = vi.fn<TypstSpawnFn>(async () => ({
      stdout: new Uint8Array(0),
      stderr: 'error: template syntax error\n',
      exitCode: 1,
    }));
    const renderer = new TypstRenderer({ typstBinary: 'typst', spawn });
    const out = await renderer.render(baseInput);
    expect(out.error?.code).toBe('binary_failed');
    expect(out.error?.message).toContain('exited 1');
    expect(out.error?.message).toContain('syntax error');
  });

  it('returns binary_not_found when spawn throws ENOENT', async () => {
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    const spawn = vi.fn<TypstSpawnFn>(async () => {
      throw enoent;
    });
    const renderer = new TypstRenderer({ typstBinary: 'typst', spawn });
    const out = await renderer.render(baseInput);
    expect(out.error?.code).toBe('binary_not_found');
    expect(out.error?.message).toContain('typst');
  });

  it('rejects non-PDF formats with unsupported_format', async () => {
    const renderer = new TypstRenderer({ typstBinary: 'typst' });
    const out = await renderer.render({ ...baseInput, format: 'docx' });
    expect(out.error?.code).toBe('unsupported_format');
  });
});

describe('TypstRenderer — server path', () => {
  it('POSTs source + inputs to /compile and reads binary response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(new Uint8Array([9, 9]), { status: 200 }));
    const renderer = new TypstRenderer({
      typstBinary: '',
      typstServerUrl: 'http://typst:8001',
      fetchImpl,
    });
    const out = await renderer.render(baseInput);
    expect(out.error).toBeUndefined();
    expect(Array.from(out.buffer)).toEqual([9, 9]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://typst:8001/compile');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.source).toBe(baseInput.templateRef);
    expect(body.inputs).toEqual({ data: baseInput.data });
  });

  it('returns upstream_http_error on 5xx from server', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('err', { status: 503 }));
    const renderer = new TypstRenderer({
      typstBinary: '',
      typstServerUrl: 'http://typst:8001',
      fetchImpl,
    });
    const out = await renderer.render(baseInput);
    expect(out.error?.code).toBe('upstream_http_error');
    expect(out.error?.status).toBe(503);
  });

  it('returns upstream_timeout when abort fires', async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const renderer = new TypstRenderer({
      typstBinary: '',
      typstServerUrl: 'http://typst:8001',
      fetchImpl,
      timeoutMs: 1,
    });
    const out = await renderer.render(baseInput);
    expect(out.error?.code).toBe('upstream_timeout');
  });
});

afterEach(() => {
  delete process.env.TYPST_BINARY;
  delete process.env.TYPST_SERVER_URL;
  delete process.env.TYPST_TIMEOUT_MS;
});
