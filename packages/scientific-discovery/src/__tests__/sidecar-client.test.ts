/**
 * createSidecarClient — composed client + health() behaviour.
 */
import { describe, it, expect } from 'vitest';
import { createSidecarClient } from '../sidecar/sidecar-client.js';
import {
  SidecarHttpError,
  SidecarUnavailableError,
} from '../causal-fusion/refutation-client.js';

describe('createSidecarClient.health', () => {
  it('GETs {baseUrl}/health and parses ok+version', async () => {
    let seenUrl = '';
    let seenMethod = '';
    const fetchImpl: typeof fetch = async (url, init) => {
      seenUrl = String(url);
      seenMethod = init?.method ?? '';
      return new Response(
        JSON.stringify({ ok: true, version: '0.1.0', service: 'sidecar', checks: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const client = createSidecarClient({ baseUrl: 'http://sidecar:8000', fetchImpl });
    const health = await client.health();
    expect(health).toEqual({ ok: true, version: '0.1.0' });
    expect(seenUrl).toBe('http://sidecar:8000/health');
    expect(seenMethod).toBe('GET');
  });

  it('maps a 503 health response to SidecarHttpError', async () => {
    const fetchImpl: typeof fetch = async () => new Response('down', { status: 503 });
    const client = createSidecarClient({ baseUrl: 'http://sidecar:8000', fetchImpl });
    await expect(client.health()).rejects.toBeInstanceOf(SidecarHttpError);
  });

  it('maps a network failure to SidecarUnavailableError', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const client = createSidecarClient({ baseUrl: 'http://sidecar:8000', fetchImpl });
    await expect(client.health()).rejects.toBeInstanceOf(SidecarUnavailableError);
  });

  it('returns a frozen (immutable) client', () => {
    const client = createSidecarClient({ baseUrl: 'http://sidecar:8000' });
    expect(Object.isFrozen(client)).toBe(true);
  });
});
