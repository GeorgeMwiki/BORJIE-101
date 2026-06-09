/**
 * Refutation client — URL resolution policy, error mapping, auth header.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  createRefutationClient,
  resolveSidecarBaseUrl,
  buildSidecarHeaders,
  SidecarHttpError,
  SidecarUnavailableError,
  SidecarSchemaError,
} from '../causal-fusion/refutation-client.js';
import type { SidecarRefuteRequest } from '../types.js';

const REQ: SidecarRefuteRequest = {
  dag: { nodes: ['x', 'y'], edges: [{ from: 'x', to: 'y' }], candidateEdges: [] },
  dataRef: 'rows://[]',
  treatment: 'x',
  outcome: 'y',
  estimator: 'dowhy_linear',
};

const originalNodeEnv = process.env.NODE_ENV;
const originalUrl = process.env.DISCOVERY_SIDECAR_URL;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalUrl === undefined) delete process.env.DISCOVERY_SIDECAR_URL;
  else process.env.DISCOVERY_SIDECAR_URL = originalUrl;
});

describe('resolveSidecarBaseUrl', () => {
  it('prefers an explicit url', () => {
    expect(resolveSidecarBaseUrl('http://explicit:9000')).toBe('http://explicit:9000');
  });

  it('falls back to the env var', () => {
    delete process.env.NODE_ENV;
    process.env.DISCOVERY_SIDECAR_URL = 'http://from-env:8000';
    expect(resolveSidecarBaseUrl(undefined)).toBe('http://from-env:8000');
  });

  it('throws in production when nothing is configured (no silent localhost)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DISCOVERY_SIDECAR_URL;
    expect(() => resolveSidecarBaseUrl(undefined)).toThrow(/must be set in production/);
  });

  it('falls back to localhost outside production', () => {
    delete process.env.NODE_ENV;
    delete process.env.DISCOVERY_SIDECAR_URL;
    expect(resolveSidecarBaseUrl(undefined)).toBe('http://localhost:8000');
  });
});

describe('buildSidecarHeaders', () => {
  it('omits the auth header when no token is given', () => {
    expect(buildSidecarHeaders(undefined)).toEqual({ 'content-type': 'application/json' });
  });

  it('adds a bearer header when a token is given', () => {
    expect(buildSidecarHeaders('secret-123')['authorization']).toBe('Bearer secret-123');
  });
});

describe('createRefutationClient', () => {
  it('sends the bearer token on the request', async () => {
    let seenAuth: string | null = null;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenAuth = headers['authorization'] ?? null;
      return new Response(
        JSON.stringify({
          scores: { placebo: 0.9, bootstrap: 0.9, unobservedConfounder: 0.9 },
          diagnostics: 'ok',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const client = createRefutationClient({
      baseUrl: 'http://sidecar:8000',
      fetchImpl,
      authToken: 'tok-abc',
    });
    const res = await client.refute(REQ);
    expect(res.scores.placebo).toBe(0.9);
    expect(seenAuth).toBe('Bearer tok-abc');
  });

  it('maps a non-2xx response to SidecarHttpError', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response('boom', { status: 500 });
    const client = createRefutationClient({ baseUrl: 'http://sidecar:8000', fetchImpl });
    await expect(client.refute(REQ)).rejects.toBeInstanceOf(SidecarHttpError);
  });

  it('maps a network failure to SidecarUnavailableError', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const client = createRefutationClient({ baseUrl: 'http://sidecar:8000', fetchImpl });
    await expect(client.refute(REQ)).rejects.toBeInstanceOf(SidecarUnavailableError);
  });

  it('maps a schema-invalid body to SidecarSchemaError', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ wrong: 'shape' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const client = createRefutationClient({ baseUrl: 'http://sidecar:8000', fetchImpl });
    await expect(client.refute(REQ)).rejects.toBeInstanceOf(SidecarSchemaError);
  });
});
