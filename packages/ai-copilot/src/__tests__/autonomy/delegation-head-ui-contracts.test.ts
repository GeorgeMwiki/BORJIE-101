import { describe, it, expect } from 'vitest';
import {
  AUTONOMY_DOMAINS,
  AUTONOMY_ACTION_TYPES,
  DELEGATION_MATRIX_DIMENSIONS,
  ONBOARDING_STEPS_TOTAL,
  ExceptionInbox,
  InMemoryExceptionRepository,
} from '../../autonomy/index.js';

/**
 * Pure contract tests that mirror what the delegation matrix UI and the
 * head dashboard render. We don't mount React here (admin-portal has no
 * vitest), but we guarantee the data contracts the pages rely on stay
 * stable so a cell-click always resolves to a real domain + action type
 * and the head cards always map to something renderable.
 */
describe('delegation matrix UI contract', () => {
  it('has 11 domains × 6 action types = 66 cells (Wave 27 Part B.9 expansion)', () => {
    expect(AUTONOMY_DOMAINS).toHaveLength(DELEGATION_MATRIX_DIMENSIONS.domains);
    expect(AUTONOMY_ACTION_TYPES).toHaveLength(
      DELEGATION_MATRIX_DIMENSIONS.actionTypes,
    );
    expect(AUTONOMY_DOMAINS.length * AUTONOMY_ACTION_TYPES.length).toBe(
      DELEGATION_MATRIX_DIMENSIONS.totalCells,
    );
  });

  it('every cell click resolves to a unique (domain, action) pair', () => {
    const seen = new Set<string>();
    for (const domain of AUTONOMY_DOMAINS) {
      for (const actionType of AUTONOMY_ACTION_TYPES) {
        const key = `${domain}:${actionType}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    expect(seen.size).toBe(DELEGATION_MATRIX_DIMENSIONS.totalCells);
  });

  it('onboarding step count matches UI progress indicator', () => {
    expect(ONBOARDING_STEPS_TOTAL).toBe(7);
  });
});

describe('head dashboard card data contract', () => {
  it('exception counts roll up from the inbox', async () => {
    const repo = new InMemoryExceptionRepository();
    const inbox = new ExceptionInbox({ repository: repo });
    await inbox.addException({
      tenantId: 't',
      domain: 'finance',
      kind: 'a',
      title: 'A',
      description: 'd',
      amountMinorUnits: 20_000_000,
    });
    await inbox.addException({
      tenantId: 't',
      domain: 'maintenance',
      kind: 'b',
      title: 'B',
      description: 'd',
    });
    const items = await inbox.listOpen('t');
    const p1 = items.filter((x) => x.priority === 'P1').length;
    const p3 = items.filter((x) => x.priority === 'P3').length;
    expect(p1).toBe(1);
    expect(p3).toBe(1);
    // The head dashboard "needs attention" total is the sum of all opens.
    expect(items.length).toBe(2);
  });

  it('every priority bucket renders independently', async () => {
    const repo = new InMemoryExceptionRepository();
    const inbox = new ExceptionInbox({ repository: repo });
    await inbox.addException({
      tenantId: 't',
      domain: 'finance',
      kind: 'a',
      title: 'big',
      description: 'd',
      amountMinorUnits: 20_000_000,
    });
    await inbox.addException({
      tenantId: 't',
      domain: 'finance',
      kind: 'b',
      title: 'small',
      description: 'd',
    });
    const open = await inbox.listOpen('t');
    const buckets = { P1: 0, P2: 0, P3: 0 };
    for (const e of open) buckets[e.priority]++;
    expect(buckets.P1).toBe(1);
    expect(buckets.P3).toBe(1);
  });
});
