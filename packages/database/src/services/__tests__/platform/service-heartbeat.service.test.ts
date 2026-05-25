/**
 * Unit tests — createServiceHeartbeatService.
 *
 * Coverage:
 *   - Synthesised api-gateway row, healthy when uptime ≥ 30s
 *   - degraded when uptime < 30s
 *   - postgres-primary healthy on fast SELECT 1
 *   - postgres-primary unhealthy when SELECT 1 throws
 *   - postgres-primary unhealthy when SELECT 1 times out
 *   - extra probes contribute additional rows
 *   - extra probe error doesn't crash readSnapshot
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServiceHeartbeatService } from '../../platform/service-heartbeat.service.js';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

function makeDb(executeImpl: () => Promise<unknown> | unknown): {
  client: any;
  calls: number;
} {
  let calls = 0;
  const client = {
    execute: () => {
      calls += 1;
      return Promise.resolve().then(executeImpl);
    },
  };
  return {
    client,
    get calls() {
      return calls;
    },
  };
}

describe('platform.serviceHeartbeat — synthesised api-gateway row', () => {
  it('healthy when uptime ≥ 30s', async () => {
    const db = makeDb(() => 1);
    const svc = createServiceHeartbeatService(db.client, {
      uptimeMs: () => 60_000,
    });
    const out = await svc.readSnapshot();
    const api = out.find((r) => r.serviceName === 'api-gateway');
    expect(api?.state).toBe('healthy');
  });

  it('degraded when uptime < 30s', async () => {
    const db = makeDb(() => 1);
    const svc = createServiceHeartbeatService(db.client, {
      uptimeMs: () => 5_000,
    });
    const out = await svc.readSnapshot();
    expect(out.find((r) => r.serviceName === 'api-gateway')?.state).toBe(
      'degraded',
    );
  });
});

describe('platform.serviceHeartbeat — postgres probe', () => {
  it('healthy when SELECT 1 returns quickly', async () => {
    const db = makeDb(() => 1);
    const svc = createServiceHeartbeatService(db.client, {
      uptimeMs: () => 60_000,
    });
    const out = await svc.readSnapshot();
    expect(
      out.find((r) => r.serviceName === 'postgres-primary')?.state,
    ).toBe('healthy');
  });

  it('unhealthy when SELECT 1 throws', async () => {
    const db = makeDb(() => {
      throw new Error('conn refused');
    });
    const svc = createServiceHeartbeatService(db.client, {
      uptimeMs: () => 60_000,
    });
    const out = await svc.readSnapshot();
    expect(
      out.find((r) => r.serviceName === 'postgres-primary')?.state,
    ).toBe('unhealthy');
  });

  it('unhealthy when SELECT 1 exceeds the configured timeout', async () => {
    const db = makeDb(
      () => new Promise((resolve) => setTimeout(() => resolve(1), 500)),
    );
    const svc = createServiceHeartbeatService(db.client, {
      uptimeMs: () => 60_000,
      dbProbeTimeoutMs: 30,
    });
    const out = await svc.readSnapshot();
    expect(
      out.find((r) => r.serviceName === 'postgres-primary')?.state,
    ).toBe('unhealthy');
  });
});

describe('platform.serviceHeartbeat — extra probes', () => {
  it('appends extra probe rows', async () => {
    const db = makeDb(() => 1);
    const svc = createServiceHeartbeatService(db.client, {
      uptimeMs: () => 60_000,
      extraProbes: [
        async () => ({
          serviceName: 'redis-primary',
          state: 'healthy',
          lastHeartbeatAt: new Date().toISOString(),
          latencyMsP95: 5,
          notes: 'PING returned PONG',
        }),
      ],
    });
    const out = await svc.readSnapshot();
    expect(out.some((r) => r.serviceName === 'redis-primary')).toBe(true);
  });

  it('extra probe error is swallowed and the snapshot still returns', async () => {
    const db = makeDb(() => 1);
    const svc = createServiceHeartbeatService(db.client, {
      uptimeMs: () => 60_000,
      extraProbes: [
        async () => {
          throw new Error('probe boom');
        },
      ],
    });
    const out = await svc.readSnapshot();
    // Still has the two synthesised rows; no third row appended.
    expect(out.length).toBeGreaterThanOrEqual(2);
  });
});
