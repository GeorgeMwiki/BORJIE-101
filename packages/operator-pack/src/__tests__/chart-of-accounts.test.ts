import { describe, it, expect } from 'vitest';
import { OPERATOR_CHART_OF_ACCOUNTS } from '../index.js';
import { operatorBusinessOntology } from '../ontology.js';

describe('operator chart-of-accounts (derived from the REA ontology)', () => {
  it('materializes exactly one controlling account per ontology resource', () => {
    const resourceKeys = operatorBusinessOntology.resources
      .map((r) => r.key)
      .sort();
    const coaResourceKeys = OPERATOR_CHART_OF_ACCOUNTS.map((a) => a.resourceKey).sort();
    expect(coaResourceKeys).toEqual(resourceKeys);
  });

  it('has unique account codes', () => {
    const codes = OPERATOR_CHART_OF_ACCOUNTS.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('ranges every code by class (asset 1xxx, liability 2xxx, … expense 5xxx)', () => {
    const firstDigit: Record<string, string> = {
      asset: '1',
      liability: '2',
      equity: '3',
      revenue: '4',
      expense: '5',
      operational: '9',
    };
    for (const a of OPERATOR_CHART_OF_ACCOUNTS) {
      expect(a.code[0]).toBe(firstDigit[a.accountClass]);
      expect(a.code).toMatch(/^\d{4}$/);
    }
  });
});
