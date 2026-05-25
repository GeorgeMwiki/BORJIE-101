/**
 * deep-health tests — probe scheduling, timeout, overall rollup, admin
 * gate and 15s cache behaviour.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runDeepHealth,
  computeOverall,
  createDeepHealthHandler,
  postgresProbe,
  redisProbe,
  anthropicProbe,
  openaiProbe,
  elevenLabsProbe,
  gepgProbe,
  type ProbeDefinition,
  type ProbeResult,
} from '../deep-health';

function makeProbe(
  name: string,
  result: 'ok' | 'throw' | 'slow',
  opts: { optional?: boolean; timeoutMs?: number } = {},
): ProbeDefinition {
  return {
    name,
    optional: opts.optional,
    timeoutMs: opts.timeoutMs ?? 100,
    run: async () => {
      if (result === 'throw') throw new Error(`${name} exploded`);
      if (result === 'slow') await new Promise((r) => setTimeout(r, 500));
    },
  };
}

describe('deep-health.runDeepHealth', () => {
  it('marks every probe healthy when all resolve', async () => {
    const payload = await runDeepHealth({
      version: 'test',
      probes: [makeProbe('a', 'ok'), makeProbe('b', 'ok')],
    });
    expect(payload.overall).toBe('healthy');
    expect(payload.upstreams.a?.status).toBe('healthy');
    expect(payload.upstreams.b?.status).toBe('healthy');
    expect(payload.upstreams.a?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('rolls up to unhealthy when a mandatory probe fails', async () => {
    const payload = await runDeepHealth({
      version: 'test',
      probes: [makeProbe('a', 'ok'), makeProbe('b', 'throw')],
    });
    expect(payload.overall).toBe('unhealthy');
    expect(payload.upstreams.b?.status).toBe('unhealthy');
    expect(payload.upstreams.b?.error).toMatch(/exploded/);
  });

  it('failed optional probe only degrades overall', async () => {
    const payload = await runDeepHealth({
      version: 'test',
      probes: [
        makeProbe('a', 'ok'),
        makeProbe('optional-x', 'throw', { optional: true }),
      ],
    });
    expect(payload.overall).toBe('degraded');
    expect(payload.upstreams['optional-x']?.status).toBe('degraded');
  });

  it('enforces per-probe timeout', async () => {
    const payload = await runDeepHealth({
      version: 'test',
      probes: [makeProbe('slow', 'slow', { timeoutMs: 50 })],
    });
    expect(payload.upstreams.slow?.status).toBe('unhealthy');
    expect(payload.upstreams.slow?.error).toMatch(/timed out/);
  });

  it('marks probes as skipped when skipIf returns true', async () => {
    const payload = await runDeepHealth({
      version: 'test',
      probes: [{
        name: 'gated',
        skipIf: () => true,
        run: async () => { throw new Error('should not run'); },
      }],
    });
    expect(payload.upstreams.gated?.status).toBe('skipped');
  });
});

describe('deep-health.computeOverall', () => {
  it('healthy when all ok or skipped', () => {
    const results: ProbeResult[] = [
      { name: 'a', status: 'healthy', latencyMs: 1, lastChecked: '' },
      { name: 'b', status: 'skipped', latencyMs: 0, lastChecked: '' },
    ];
    expect(computeOverall(results)).toBe('healthy');
  });

  it('degraded if any probe degraded', () => {
    expect(computeOverall([
      { name: 'a', status: 'healthy', latencyMs: 1, lastChecked: '' },
      { name: 'b', status: 'degraded', latencyMs: 1, lastChecked: '' },
    ])).toBe('degraded');
  });

  it('unhealthy wins over degraded', () => {
    expect(computeOverall([
      { name: 'a', status: 'degraded', latencyMs: 1, lastChecked: '' },
      { name: 'b', status: 'unhealthy', latencyMs: 1, lastChecked: '' },
    ])).toBe('unhealthy');
  });
});

describe('deep-health handler', () => {
  const fakeReq = (roleHeader?: string) => ({
    header: (h: string) => h === 'x-user-role' ? roleHeader ?? '' : '',
  }) as unknown as Parameters<ReturnType<typeof createDeepHealthHandler>>[0];

  const fakeRes = () => {
    let code: number | undefined;
    const headers: Record<string, string> = {};
    let body: unknown;
    const resObj = {
      status: (c: number) => { code = c; return resObj; },
      json: (b: unknown) => { body = b; return resObj; },
      setHeader: (k: string, v: string) => { headers[k] = v; return resObj; },
      get code() { return code; },
      get headers() { return headers; },
      get body() { return body as Record<string, unknown>; },
    };
    return resObj;
  };

  it('refuses non-admin in production', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const handler = createDeepHealthHandler({
        version: 'test',
        probes: [],
        requireAdmin: (req) => req.header('x-user-role') === 'TENANT_ADMIN',
      });
      const req = fakeReq('USER');
      let code = 0;
      let body: unknown;
      const res = {
        status(c: number) { code = c; return this; },
        json(b: unknown) { body = b; return this; },
        setHeader() { return this; },
      } as unknown as Parameters<typeof handler>[1];
      await handler(req as unknown as Parameters<typeof handler>[0], res);
      expect(code).toBe(403);
      expect(body).toMatchObject({ error: expect.stringMatching(/admin/i) });
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('returns 200 + payload for admin + healthy probes', async () => {
    const handler = createDeepHealthHandler({
      version: 'v1',
      probes: [makeProbe('db', 'ok')],
      requireAdmin: () => true,
    });
    let code = 0;
    let body: Record<string, unknown> = {};
    const res = {
      status(c: number) { code = c; return this; },
      json(b: unknown) { body = b as Record<string, unknown>; return this; },
      setHeader() { return this; },
    } as unknown as Parameters<typeof handler>[1];
    await handler({ header: () => '' } as unknown as Parameters<typeof handler>[0], res);
    expect(code).toBe(200);
    expect(body.overall).toBe('healthy');
  });

  it('caches results within cacheMs window', async () => {
    let runs = 0;
    const handler = createDeepHealthHandler({
      version: 'v1',
      cacheMs: 10_000,
      probes: [{
        name: 'counter',
        run: async () => { runs += 1; },
      }],
      requireAdmin: () => true,
    });
    const mkRes = () => {
      const headers: Record<string, string> = {};
      return {
        headers,
        status() { return this; },
        json() { return this; },
        setHeader(k: string, v: string) { headers[k] = v; return this; },
      } as unknown as Parameters<typeof handler>[1] & { headers: Record<string, string> };
    };
    const r1 = mkRes();
    await handler({ header: () => '' } as unknown as Parameters<typeof handler>[0], r1);
    const r2 = mkRes();
    await handler({ header: () => '' } as unknown as Parameters<typeof handler>[0], r2);
    expect(runs).toBe(1);
    expect((r2 as unknown as { headers: Record<string, string> }).headers['X-Deep-Health-Cache']).toBe('hit');
  });
});

describe('built-in probe factories', () => {
  it('postgresProbe wraps a query callable', async () => {
    const query = vi.fn(async () => 1);
    const probe = postgresProbe(query);
    await probe.run();
    expect(query).toHaveBeenCalledTimes(1);
    expect(probe.name).toBe('postgres');
  });

  it('redisProbe wraps a ping callable', async () => {
    const ping = vi.fn(async () => 'PONG');
    const probe = redisProbe(ping);
    await probe.run();
    expect(ping).toHaveBeenCalled();
    expect(probe.name).toBe('redis');
  });

  it('anthropicProbe is skipped when no key', () => {
    const probe = anthropicProbe(undefined);
    expect(probe.skipIf?.()).toBe(true);
  });

  it('openaiProbe is skipped when no key', () => {
    expect(openaiProbe(undefined).skipIf?.()).toBe(true);
  });

  it('elevenLabsProbe is skipped when no key', () => {
    expect(elevenLabsProbe(undefined).skipIf?.()).toBe(true);
  });

  it('gepgProbe is skipped when no url', () => {
    expect(gepgProbe(undefined).skipIf?.()).toBe(true);
  });

  it('anthropicProbe is NOT skipped when key present', () => {
    expect(anthropicProbe('sk-ant-test').skipIf?.()).toBe(false);
  });
});
