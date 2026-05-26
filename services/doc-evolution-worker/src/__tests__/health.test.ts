/**
 * health.test — readiness / liveness snapshot evaluator.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateHealth,
  livenessBody,
  readinessBody,
} from '../routes/health.js';

describe('evaluateHealth', () => {
  it('returns degraded when no aggregation has run yet', () => {
    const snap = evaluateHealth({
      getLastAggregationAt: () => null,
      getTier2QueuePolling: () => true,
      now: () => new Date('2026-05-26T03:30:00Z'),
      staleness_threshold_ms: 86400000,
    });
    expect(snap.status).toBe('degraded');
    expect(snap.staleness_ms).toBeNull();
    expect(snap.tier2_queue_polling).toBe(true);
  });

  it('returns ok when last aggregation was recent', () => {
    const snap = evaluateHealth({
      getLastAggregationAt: () => '2026-05-26T03:00:00Z',
      getTier2QueuePolling: () => false,
      now: () => new Date('2026-05-26T03:30:00Z'),
      staleness_threshold_ms: 60 * 60 * 1000,
    });
    expect(snap.status).toBe('ok');
    expect(snap.staleness_ms).toBe(30 * 60 * 1000);
  });

  it('returns degraded when stale', () => {
    const snap = evaluateHealth({
      getLastAggregationAt: () => '2026-05-24T03:00:00Z',
      getTier2QueuePolling: () => false,
      now: () => new Date('2026-05-26T03:30:00Z'),
      staleness_threshold_ms: 60 * 60 * 1000,
    });
    expect(snap.status).toBe('degraded');
  });

  it('returns down when the last_aggregation_at is unparsable', () => {
    const snap = evaluateHealth({
      getLastAggregationAt: () => 'never',
      getTier2QueuePolling: () => false,
      now: () => new Date('2026-05-26T03:30:00Z'),
      staleness_threshold_ms: 60 * 60 * 1000,
    });
    expect(snap.status).toBe('down');
  });

  it('liveness body is the canonical OK shape', () => {
    expect(livenessBody()).toEqual({ status: 'ok' });
  });

  it('readiness body echoes the snapshot', () => {
    const snap = evaluateHealth({
      getLastAggregationAt: () => '2026-05-26T03:00:00Z',
      getTier2QueuePolling: () => true,
      now: () => new Date('2026-05-26T03:30:00Z'),
      staleness_threshold_ms: 60 * 60 * 1000,
    });
    expect(readinessBody(snap)).toBe(snap);
  });
});
