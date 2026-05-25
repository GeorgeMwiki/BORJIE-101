import { describe, expect, it } from 'vitest';
import { BiasDriftMonitor } from '../bias-drift-monitor.js';

function feed(monitor: BiasDriftMonitor, group: string, prediction: 0 | 1, n: number): void {
  for (let i = 0; i < n; i++) {
    monitor.observe({ group, prediction });
  }
}

describe('BiasDriftMonitor', () => {
  it('returns null when baseline + current windows too small', () => {
    const m = new BiasDriftMonitor({ baselineWindowSize: 50, currentWindowSize: 50, batchSize: 10 });
    feed(m, 'A', 1, 5);
    feed(m, 'B', 0, 5);
    expect(m.check()).toBeNull();
  });

  it('does not alert when baseline + current have matching disparity', () => {
    const m = new BiasDriftMonitor({
      baselineWindowSize: 50,
      currentWindowSize: 50,
      batchSize: 10,
      alertThreshold: 0.01,
    });
    // Baseline: 50/50 across A/B with same selection rate.
    for (let i = 0; i < 50; i++) {
      m.observe({ group: i % 2 === 0 ? 'A' : 'B', prediction: i % 4 === 0 ? 1 : 0 });
    }
    // Current: same pattern.
    for (let i = 0; i < 50; i++) {
      m.observe({ group: i % 2 === 0 ? 'A' : 'B', prediction: i % 4 === 0 ? 1 : 0 });
    }
    const alert = m.check();
    // Could be null or a non-violating alert; either acceptable.
    if (alert) {
      expect(alert.pValue).toBeGreaterThan(0.01);
    }
  });

  it('alerts when current window has much larger disparity than baseline', () => {
    const m = new BiasDriftMonitor({
      baselineWindowSize: 100,
      currentWindowSize: 100,
      batchSize: 10,
      alertThreshold: 0.05,
    });
    // Baseline: A and B both ~50% selection -> low disparity per batch.
    for (let i = 0; i < 100; i++) {
      m.observe({ group: i % 2 === 0 ? 'A' : 'B', prediction: i % 2 === 0 ? 1 : 0 });
    }
    // Current: A 100% selected, B 0% — huge disparity per batch.
    for (let i = 0; i < 100; i++) {
      m.observe({ group: i % 2 === 0 ? 'A' : 'B', prediction: i % 2 === 0 ? 1 : 0 });
    }
    // Tweak the current window so it has biased pattern.
    m.reset();
    for (let i = 0; i < 100; i++) {
      m.observe({ group: i % 2 === 0 ? 'A' : 'B', prediction: i % 4 === 0 ? 1 : 0 });
    }
    for (let i = 0; i < 100; i++) {
      m.observe({ group: i % 2 === 0 ? 'A' : 'B', prediction: i % 2 === 0 ? 1 : 0 });
    }
    const alert = m.check();
    expect(alert).not.toBeNull();
    if (alert) {
      expect(alert.pValue).toBeLessThan(0.05);
      expect(alert.currentScore).toBeGreaterThan(alert.baselineScore);
      expect(alert.metric).toBe('demographic_parity');
    }
  });

  it('rejects invalid batchSize', () => {
    expect(() => new BiasDriftMonitor({ batchSize: 1 })).toThrow();
  });

  it('resetBaseline rotates current into baseline', () => {
    const m = new BiasDriftMonitor({ baselineWindowSize: 10, currentWindowSize: 10, batchSize: 5 });
    for (let i = 0; i < 10; i++) m.observe({ group: 'A', prediction: 1 });
    for (let i = 0; i < 5; i++) m.observe({ group: 'B', prediction: 0 });
    expect(m.baselineSize()).toBe(10);
    expect(m.currentSize()).toBe(5);
    m.resetBaseline();
    expect(m.baselineSize()).toBe(5);
    expect(m.currentSize()).toBe(0);
  });
});
