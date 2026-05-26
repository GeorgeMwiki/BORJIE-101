import { describe, it, expect } from 'vitest';
import { budgetGate } from '../gates/budget-gate.js';

describe('budget-gate', () => {
  it('passes when all three axes have headroom', () => {
    const r = budgetGate({
      usdCents: { remaining: 500, incremental: 40 },
      wallClockMs: { remaining: 60_000, incremental: 1_500 },
      toolInvocations: { remaining: 30, incremental: 1 },
    });
    expect(r.pass).toBe(true);
    expect(r.signal.signal).toBe('budget');
  });

  it('fails when the USD axis would dip below zero', () => {
    const r = budgetGate({
      usdCents: { remaining: 10, incremental: 50 },
    });
    expect(r.pass).toBe(false);
    const failed = (r.signal.evidence as { failedAxes: string[] }).failedAxes;
    expect(failed).toContain('usdCents');
  });

  it('fails when the wall-clock axis would dip below zero', () => {
    const r = budgetGate({
      wallClockMs: { remaining: 100, incremental: 5_000 },
    });
    expect(r.pass).toBe(false);
    const failed = (r.signal.evidence as { failedAxes: string[] }).failedAxes;
    expect(failed).toContain('wallClockMs');
  });

  it('passes when only one axis is configured and it has headroom', () => {
    const r = budgetGate({
      toolInvocations: { remaining: 5, incremental: 1 },
    });
    expect(r.pass).toBe(true);
  });
});
