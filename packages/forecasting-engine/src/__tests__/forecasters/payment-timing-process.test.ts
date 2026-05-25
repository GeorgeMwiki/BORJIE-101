import { describe, it, expect } from 'vitest';
import {
  fitPaymentTiming,
  samplePaymentTimes,
  expectedIntervalMs,
} from '../../forecasters/stochastic/payment-timing-process.js';
import {
  fitNoShow,
  noShowRate,
  sampleNoShow,
} from '../../forecasters/stochastic/no-show-process.js';
import {
  defaultArrivalParams,
  sampleArrivalsPerDay,
  expectedArrivalsOverHorizon,
} from '../../forecasters/stochastic/maintenance-arrival-process.js';
import {
  simulateLeaseLifecycle,
} from '../../forecasters/discrete-event/lease-lifecycle-sim.js';
import {
  simulateMaintenanceQueue,
} from '../../forecasters/discrete-event/maintenance-queue-sim.js';

describe('paymentTimingProcess', () => {
  it('fits log-normal interval and samples deterministically by seed', () => {
    const dayMs = 86_400_000;
    const obs = Array.from({ length: 12 }, (_, i) => ({
      tenantId: 't1',
      tMs: i * 30 * dayMs,
    }));
    const params = fitPaymentTiming(obs);
    expect(params.tenantId).toBe('t1');
    const a = samplePaymentTimes({ params, horizonMs: 365 * dayMs, seed: 7 });
    const b = samplePaymentTimes({ params, horizonMs: 365 * dayMs, seed: 7 });
    expect(a).toEqual(b);
    // Expected interval roughly 30 days
    const expectedDays = expectedIntervalMs(params) / dayMs;
    expect(expectedDays).toBeGreaterThan(20);
    expect(expectedDays).toBeLessThan(45);
  });

  it('throws on too-few observations', () => {
    expect(() => fitPaymentTiming([{ tenantId: 't', tMs: 0 }])).toThrow();
  });
});

describe('noShowProcess', () => {
  it('updates posterior toward observed rate', () => {
    const obs = Array.from({ length: 10 }, (_, i) => ({
      vendorId: 'v1',
      noShow: i < 3,
    }));
    const p = fitNoShow(obs, 'v1');
    const rate = noShowRate(p);
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.6);
  });

  it('sample is deterministic per seed', () => {
    const obs = [{ vendorId: 'v1', noShow: false }];
    const p = fitNoShow(obs, 'v1');
    expect(sampleNoShow(p, 1)).toBe(sampleNoShow(p, 1));
  });
});

describe('maintenanceArrivalProcess', () => {
  it('produces a per-day count array', () => {
    const params = defaultArrivalParams('B', 10);
    const arr = sampleArrivalsPerDay({ params, horizonDays: 30, seed: 1 });
    expect(arr.length).toBe(30);
    const total = arr.reduce((s, x) => s + x, 0);
    expect(total).toBeGreaterThanOrEqual(0);
  });

  it('expected arrivals scale linearly in horizon', () => {
    const params = defaultArrivalParams('A', 20);
    const e7 = expectedArrivalsOverHorizon(params, 7);
    const e14 = expectedArrivalsOverHorizon(params, 14);
    expect(e14).toBeCloseTo(2 * e7, 6);
  });
});

describe('leaseLifecycleSim', () => {
  it('emits at least one lease-signed event', () => {
    const ev = simulateLeaseLifecycle({
      tenantId: 't1',
      startMs: 0,
      horizonMs: 365 * 86_400_000,
      monthlyRent: 50_000,
      paymentReliability: 0.9,
      renewalProbability: 0.7,
      leaseTermMonths: 12,
      daysToFillVacant: 30,
      seed: 42,
    });
    expect(ev.find((e) => e.kind === 'lease-signed')).toBeDefined();
    expect(ev.length).toBeGreaterThan(1);
  });
});

describe('maintenanceQueueSim', () => {
  it('returns serviced tickets + non-negative wait stats', () => {
    const result = simulateMaintenanceQueue({
      arrivalRatePerDay: 2,
      serviceRatePerDay: 3,
      vendorCount: 2,
      vendorNoShowRate: 0.1,
      horizonDays: 30,
      seed: 5,
    });
    expect(result.tickets.length).toBeGreaterThan(0);
    expect(result.meanWaitDays).toBeGreaterThanOrEqual(0);
    expect(result.p95WaitDays).toBeGreaterThanOrEqual(result.meanWaitDays);
    expect(result.serviceLevel).toBeGreaterThanOrEqual(0);
    expect(result.serviceLevel).toBeLessThanOrEqual(1);
  });
});
