import { describe, it, expect } from 'vitest';

import {
  createInMemoryCapabilityRepository,
  createInMemoryInvocationRepository,
  createInMemoryMeasurementRepository,
  createInMemoryOutcomeRepository,
} from '@borjie/capability-catalogue';

import { main } from '../index.js';

const pickPort = (() => {
  // Use ephemeral ports per test to avoid collision when vitest runs in
  // parallel files.
  let next = 51_500;
  return () => {
    next += 1;
    return next;
  };
})();

describe('worker main()', () => {
  it('starts health server + responds to GET /health', async () => {
    const handle = await main({
      config: {
        DATABASE_URL: 'postgres://localhost/test',
        PORT: pickPort(),
        NODE_ENV: 'test',
        CAPABILITY_MEASUREMENT_TICK_MS: 60_000,
      },
      deps: {
        listTenants: async () => [],
        capabilityRepo: createInMemoryCapabilityRepository({ rows: [] }),
        invocationRepo: createInMemoryInvocationRepository(),
        outcomeRepo: createInMemoryOutcomeRepository(),
        measurementRepo: createInMemoryMeasurementRepository(),
        now: () => new Date(),
      },
    });

    expect(handle.server).not.toBeNull();
    const port = handle.config.PORT;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');

    await handle.stop();
  });

  it('runs tickOnce() against injected deps without crashing', async () => {
    const handle = await main({
      config: {
        DATABASE_URL: 'postgres://localhost/test',
        PORT: pickPort(),
        NODE_ENV: 'test',
        CAPABILITY_MEASUREMENT_TICK_MS: 60_000,
      },
      deps: {
        listTenants: async () => ['tenant-A'],
        capabilityRepo: createInMemoryCapabilityRepository({ rows: [] }),
        invocationRepo: createInMemoryInvocationRepository(),
        outcomeRepo: createInMemoryOutcomeRepository(),
        measurementRepo: createInMemoryMeasurementRepository(),
        now: () => new Date(),
      },
    });

    const report = await handle.tickOnce();
    expect(report.tenantsSwept).toBe(1);
    expect(report.capabilitiesSwept).toBe(0);
    expect(report.measurementsPersisted).toBe(0);

    await handle.stop();
  });

  it('returns a degraded handle when DATABASE_URL is unset and no deps injected', async () => {
    const handle = await main({
      config: {
        PORT: pickPort(),
        NODE_ENV: 'test',
      },
    });
    expect(handle.server).toBeNull();
    const report = await handle.tickOnce();
    expect(report.tenantsSwept).toBe(0);
    expect(report.measurementsPersisted).toBe(0);
    await handle.stop();
  });

  it('stop() is idempotent — calling twice does not throw', async () => {
    const handle = await main({
      config: {
        DATABASE_URL: 'postgres://localhost/test',
        PORT: pickPort(),
        NODE_ENV: 'test',
        CAPABILITY_MEASUREMENT_TICK_MS: 60_000,
      },
      deps: {
        listTenants: async () => [],
        capabilityRepo: createInMemoryCapabilityRepository({ rows: [] }),
        invocationRepo: createInMemoryInvocationRepository(),
        outcomeRepo: createInMemoryOutcomeRepository(),
        measurementRepo: createInMemoryMeasurementRepository(),
        now: () => new Date(),
      },
    });
    await handle.stop();
    // Second stop should resolve cleanly.
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
