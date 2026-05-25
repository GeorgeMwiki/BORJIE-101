/**
 * Unit tests for the metrics registry.
 *
 * We exercise the raw registry API (not the singleton) so tests are
 * hermetic. Covers counter/gauge/histogram mechanics, label-scoped
 * bucketing, snapshot shape, and percentile edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  createMetricsRegistry,
  recordBrainTurn,
  recordHeartbeatTick,
  recordBackgroundTask,
  getMetricsRegistry,
} from '../metrics-registry';

describe('MetricsRegistry', () => {
  it('counter increments and label-scopes', () => {
    const r = createMetricsRegistry();
    r.counter('http.requests', 'http total', { route: '/a' });
    r.counter('http.requests', 'http total', { route: '/a' });
    r.counter('http.requests', 'http total', { route: '/b' });
    const snap = r.snapshot();
    const aBucket = snap.counters.find((c) => c.labels.route === '/a');
    const bBucket = snap.counters.find((c) => c.labels.route === '/b');
    expect(aBucket?.value).toBe(2);
    expect(bBucket?.value).toBe(1);
  });

  it('gauge overwrites the previous value', () => {
    const r = createMetricsRegistry();
    r.gauge('active_users', 'active', 10);
    r.gauge('active_users', 'active', 7);
    const snap = r.snapshot();
    expect(snap.gauges[0].value).toBe(7);
  });

  it('histogram tracks count, sum, min, max, and percentiles', () => {
    const r = createMetricsRegistry();
    for (let i = 1; i <= 100; i++) r.observe('latency', 'ms', i);
    const snap = r.snapshot();
    const h = snap.histograms[0];
    expect(h.count).toBe(100);
    expect(h.sum).toBe(5050);
    expect(h.min).toBe(1);
    expect(h.max).toBe(100);
    // p50 should be near 50, p95 near 95, p99 near 99.
    expect(h.p50).toBeGreaterThanOrEqual(49);
    expect(h.p50).toBeLessThanOrEqual(51);
    expect(h.p95).toBeGreaterThanOrEqual(94);
    expect(h.p99).toBeGreaterThanOrEqual(98);
  });

  it('snapshot includes uptime and timestamp', () => {
    const r = createMetricsRegistry();
    const snap = r.snapshot();
    expect(snap.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(typeof snap.collectedAt).toBe('string');
    expect(() => new Date(snap.collectedAt)).not.toThrow();
  });

  it('reset clears all buckets', () => {
    const r = createMetricsRegistry();
    r.counter('x', 'd');
    r.gauge('y', 'd', 1);
    r.observe('z', 'd', 100);
    r.reset();
    const snap = r.snapshot();
    expect(snap.counters.length).toBe(0);
    expect(snap.gauges.length).toBe(0);
    expect(snap.histograms.length).toBe(0);
  });

  it('recordBrainTurn emits the expected counter + histogram bundle', () => {
    const registry = getMetricsRegistry();
    registry.reset();
    recordBrainTurn({
      persona: 'owner-advisor',
      tenantId: 'ten-A',
      latencyMs: 420,
      inputTokens: 100,
      outputTokens: 250,
      costUsdMicro: 500,
      ok: true,
    });
    const snap = registry.snapshot();
    expect(snap.counters.some((c) => c.name === 'brain.turn.total' && c.value === 1)).toBe(true);
    expect(snap.counters.some((c) => c.name === 'brain.turn.error.total')).toBe(false);
    expect(snap.histograms.some((h) => h.name === 'brain.turn.latency_ms')).toBe(true);
  });

  it('recordHeartbeatTick writes a last-tick gauge and active-persona gauge', () => {
    const registry = getMetricsRegistry();
    registry.reset();
    recordHeartbeatTick({ personaCount: 3, lastTickAgoMs: 1200, juniorSleepCount: 2 });
    const snap = registry.snapshot();
    expect(
      snap.gauges.find((g) => g.name === 'heartbeat.active_personas')?.value,
    ).toBe(3);
    expect(
      snap.gauges.find((g) => g.name === 'heartbeat.last_tick_ago_ms')?.value,
    ).toBe(1200);
  });

  it('recordBackgroundTask differentiates success vs failure counts', () => {
    const registry = getMetricsRegistry();
    registry.reset();
    recordBackgroundTask({ kind: 'portfolio_health_scan', tenantId: 't', ok: true, durationMs: 1000 });
    recordBackgroundTask({ kind: 'portfolio_health_scan', tenantId: 't', ok: false, durationMs: 500 });
    const snap = registry.snapshot();
    expect(snap.counters.find((c) => c.name === 'bg.task.success.total')?.value).toBe(1);
    expect(snap.counters.find((c) => c.name === 'bg.task.failure.total')?.value).toBe(1);
  });
});
