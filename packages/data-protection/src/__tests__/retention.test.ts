/**
 * Retention tests — verify legal-hold exception, within-window retain,
 * and age-exceeded purge.
 */

import { describe, expect, it } from 'vitest';

import {
  decideRetention,
  planRetentionBatch,
  type RetentionCandidate,
  type RetentionPolicy,
} from '../retention/retention-runner.js';

const POLICY: RetentionPolicy = Object.freeze({
  tenantId: 't1',
  class: 'pii',
  retentionDays: 365,
  exceptionCategories: ['litigation_hold', 'fraud_investigation'],
});

const fresh: RetentionCandidate = Object.freeze({
  tenantId: 't1',
  class: 'pii',
  entityKind: 'user',
  entityId: 'u_1',
  createdAt: new Date('2026-04-01T00:00:00Z'),
  categories: [],
});

const old: RetentionCandidate = Object.freeze({
  tenantId: 't1',
  class: 'pii',
  entityKind: 'user',
  entityId: 'u_2',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  categories: [],
});

const onHold: RetentionCandidate = Object.freeze({
  tenantId: 't1',
  class: 'pii',
  entityKind: 'user',
  entityId: 'u_3',
  createdAt: new Date('2023-01-01T00:00:00Z'),
  categories: ['litigation_hold'],
});

describe('retention/retention-runner', () => {
  it('retains a row whose age is within the window', () => {
    const d = decideRetention({
      policy: POLICY,
      candidate: fresh,
      now: new Date('2026-05-26T00:00:00Z'),
    });
    expect(d.action).toBe('retain');
    expect(d.reason).toMatch(/within_window/);
  });

  it('purges a row whose age exceeds the window', () => {
    const d = decideRetention({
      policy: POLICY,
      candidate: old,
      now: new Date('2026-05-26T00:00:00Z'),
    });
    expect(d.action).toBe('purge');
    expect(d.reason).toMatch(/age_exceeded/);
  });

  it('retains a row that has an exception category (legal hold)', () => {
    const d = decideRetention({
      policy: POLICY,
      candidate: onHold,
      now: new Date('2026-05-26T00:00:00Z'),
    });
    expect(d.action).toBe('retain');
    expect(d.reason).toMatch(/litigation_hold/);
  });

  it('refuses to decide on a tenant / class mismatch', () => {
    expect(() =>
      decideRetention({
        policy: { ...POLICY, tenantId: 'other' },
        candidate: fresh,
        now: new Date(),
      }),
    ).toThrow(/Policy is for tenant other/);
  });

  it('defaults to retain when no policy exists for the (tenant,class)', () => {
    const decisions = planRetentionBatch({
      policies: [],
      candidates: [fresh],
      now: new Date('2026-05-26T00:00:00Z'),
    });
    expect(decisions[0]?.action).toBe('retain');
    expect(decisions[0]?.reason).toBe('no_policy:default_retain');
  });

  it('plans a batch correctly with mixed candidates', () => {
    const decisions = planRetentionBatch({
      policies: [POLICY],
      candidates: [fresh, old, onHold],
      now: new Date('2026-05-26T00:00:00Z'),
    });
    expect(decisions).toHaveLength(3);
    expect(decisions[0]?.action).toBe('retain');
    expect(decisions[1]?.action).toBe('purge');
    expect(decisions[2]?.action).toBe('retain');
  });
});
