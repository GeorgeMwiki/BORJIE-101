import { describe, it, expect } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig', () => {
  it('returns degraded mode when DATABASE_URL is absent', () => {
    const cfg = loadConfig({});
    expect(cfg.degraded).toBe(true);
    expect(cfg.databaseUrl).toBeNull();
  });
  it('exits degraded mode when DATABASE_URL is set', () => {
    const cfg = loadConfig({ DATABASE_URL: 'postgres://localhost/x' });
    expect(cfg.degraded).toBe(false);
  });
  it('reads detector interval + stale heartbeat overrides', () => {
    const cfg = loadConfig({
      WAVE_RESILIENCE_DETECTOR_INTERVAL_MS: '30000',
      WAVE_RESILIENCE_STALE_HEARTBEAT_MS: '120000',
    });
    expect(cfg.detectorIntervalMs).toBe(30000);
    expect(cfg.staleHeartbeatMs).toBe(120000);
  });
  it('clamps max attempts to a positive integer', () => {
    const cfg = loadConfig({
      WAVE_RESILIENCE_MAX_ATTEMPTS: '0',
    });
    expect(cfg.maxAttempts).toBeGreaterThanOrEqual(1);
  });
  it('falls back to defaults on garbage values', () => {
    const cfg = loadConfig({ PORT: 'banana' });
    expect(cfg.port).toBe(4090);
  });
});
