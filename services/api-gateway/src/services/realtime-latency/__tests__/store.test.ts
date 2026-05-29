import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordLatency,
  getStats,
  __resetLatencyStoreForTests,
} from '../store.js';

describe('realtime-latency/store', () => {
  beforeEach(() => {
    __resetLatencyStoreForTests();
  });

  it('returns zero stats when no samples recorded', () => {
    const stats = getStats('tenant-a');
    expect(stats.count).toBe(0);
    expect(stats.p50).toBe(0);
    expect(stats.p95).toBe(0);
    expect(stats.p99).toBe(0);
    expect(stats.avg).toBe(0);
  });

  it('aggregates samples into percentiles', () => {
    for (let i = 1; i <= 100; i += 1) {
      recordLatency('tenant-a', i);
    }
    const stats = getStats('tenant-a');
    expect(stats.count).toBe(100);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
    expect(stats.p50).toBeGreaterThanOrEqual(49);
    expect(stats.p50).toBeLessThanOrEqual(51);
    expect(stats.p95).toBeGreaterThanOrEqual(94);
    expect(stats.p95).toBeLessThanOrEqual(96);
    expect(stats.p99).toBeGreaterThanOrEqual(98);
    expect(stats.p99).toBeLessThanOrEqual(100);
    expect(stats.avg).toBe(51); // (1+100)/2 rounded
  });

  it('isolates tenants — tenant-a samples never leak to tenant-b', () => {
    recordLatency('tenant-a', 100);
    recordLatency('tenant-a', 200);
    recordLatency('tenant-b', 500);

    const a = getStats('tenant-a');
    const b = getStats('tenant-b');

    expect(a.count).toBe(2);
    expect(a.max).toBe(200);
    expect(b.count).toBe(1);
    expect(b.max).toBe(500);
  });

  it('discards samples outside the sane window', () => {
    recordLatency('tenant-a', -1);
    recordLatency('tenant-a', 60_001);
    recordLatency('tenant-a', Number.POSITIVE_INFINITY);
    recordLatency('tenant-a', Number.NaN);
    recordLatency('tenant-a', 100);

    const stats = getStats('tenant-a');
    expect(stats.count).toBe(1);
    expect(stats.max).toBe(100);
  });

  it('caps tenant ring at MAX_PER_TENANT', () => {
    for (let i = 0; i < 2_000; i += 1) {
      recordLatency('tenant-a', 50);
    }
    const stats = getStats('tenant-a');
    expect(stats.count).toBe(1_000);
  });
});
