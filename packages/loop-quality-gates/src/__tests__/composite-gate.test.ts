import { describe, it, expect } from 'vitest';
import { compositeGate } from '../composite/composite-gate.js';
import { groundednessGate } from '../gates/groundedness-gate.js';
import { brandGate } from '../gates/brand-gate.js';
import { budgetGate } from '../gates/budget-gate.js';
import { QualityGateError } from '../types.js';

describe('composite-gate', () => {
  it('passes only when every gate passes (AND-combine)', async () => {
    const grounded = groundednessGate({
      claims: [{ id: 'k1', text: 'royalty 3%', citationIds: ['c1'] }],
      citationIndex: new Map([['c1', { url: 'https://tra.go.tz' }]]),
    });
    const brand = brandGate({
      userFacingText: 'Mr. Mwikila here.',
      renderedSurface: '',
    });
    const budget = budgetGate({
      usdCents: { remaining: 100, incremental: 10 },
    });
    const r = await compositeGate({
      invocations: [
        { name: 'groundedness', result: grounded },
        { name: 'brand', result: brand },
        { name: 'budget', result: budget },
      ],
    });
    expect(r.pass).toBe(true);
    expect(r.signals.length).toBe(3);
    expect(r.failedGates.length).toBe(0);
  });

  it('fails when any one gate fails and collects all failed-gate names', async () => {
    const grounded = groundednessGate({
      claims: [{ id: 'k1', text: 'x', citationIds: [] }],
      citationIndex: new Map(),
    });
    const brand = brandGate({
      userFacingText: 'Mr. Mwikila here.',
      renderedSurface: '',
    });
    const budget = budgetGate({
      usdCents: { remaining: 5, incremental: 10 },
    });
    const r = await compositeGate({
      invocations: [
        { name: 'groundedness', result: grounded },
        { name: 'brand', result: brand },
        { name: 'budget', result: budget },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.failedGates).toContain('groundedness');
    expect(r.failedGates).toContain('budget');
    expect(r.failedGates).not.toContain('brand');
    // All three signals are still emitted, even passing ones.
    expect(r.signals.length).toBe(3);
  });

  it('rejects an empty invocations list as INVALID_INPUT', async () => {
    await expect(compositeGate({ invocations: [] })).rejects.toBeInstanceOf(
      QualityGateError,
    );
  });
});
