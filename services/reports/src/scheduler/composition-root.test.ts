import { describe, expect, it } from 'vitest';
import { loadSchedulerConfig, buildWorkerDeps, buildNoopDeps } from './composition-root';

describe('loadSchedulerConfig', () => {
  it('defaults SCHEDULER_DEGRADED_MODE to warn', () => {
    const cfg = loadSchedulerConfig({});
    expect(cfg.SCHEDULER_DEGRADED_MODE).toBe('warn');
  });

  it('accepts env vars', () => {
    const cfg = loadSchedulerConfig({
      DATABASE_URL: 'postgres://x',
      NEO4J_URL: 'bolt://n',
      ANTHROPIC_API_KEY: 'sk-ant-x',
    });
    expect(cfg.DATABASE_URL).toBe('postgres://x');
  });
});

describe('buildWorkerDeps', () => {
  it('reports degraded status when env vars missing', () => {
    const cfg = loadSchedulerConfig({});
    const { health } = buildWorkerDeps(cfg);
    expect(health.status).toBe('degraded');
    expect(health.missing).toContain('DATABASE_URL');
    expect(health.shimmed.length).toBeGreaterThan(0);
  });

  it('reports healthy when all required env set', () => {
    const cfg = loadSchedulerConfig({
      DATABASE_URL: 'postgres://x',
      NOTIFICATIONS_SERVICE_URL: 'http://notif',
      ANTHROPIC_API_KEY: 'sk-ant-x',
    });
    const { health } = buildWorkerDeps(cfg);
    expect(health.status).toBe('healthy');
    expect(health.shimmed.length).toBe(0);
  });

  it('shimmed workers are safe no-ops that do not throw', async () => {
    const cfg = loadSchedulerConfig({});
    const { deps } = buildWorkerDeps(cfg);
    await expect(deps.runRenewalSweep()).resolves.toBeUndefined();
    await expect(deps.runSlaWorker()).resolves.toBeUndefined();
  });
});

describe('buildNoopDeps', () => {
  it('produces 7 no-op handlers', async () => {
    const deps = buildNoopDeps();
    expect(Object.keys(deps)).toHaveLength(7);
    for (const fn of Object.values(deps)) {
      await expect(fn()).resolves.toBeUndefined();
    }
  });
});
