/**
 * Erasure-cascade tests — strategies, legal-hold priority,
 * determinism, and the canned rule set.
 */

import { describe, expect, it } from 'vitest';

import {
  anonymizeValue,
  buildErasureCascade,
  cannedErasureRules,
  pseudonymizeValue,
  strategyPriority,
  strongerStrategy,
  tombstoneRow,
} from '../erasure-cascade/index.js';
import type { DSARRecord, ErasureCascadeSpec } from '../types.js';

describe('strategies: anonymize', () => {
  it('returns the same hash for the same (tenant, column, value)', () => {
    const a = anonymizeValue('t_1', 'email', 'alice@example.com');
    const b = anonymizeValue('t_1', 'email', 'alice@example.com');
    expect(a).toBe(b);
    expect(a).toMatch(/^anon::/);
  });

  it('returns a different hash for a different tenant (no cross-tenant collisions)', () => {
    const a = anonymizeValue('t_1', 'email', 'alice@example.com');
    const b = anonymizeValue('t_2', 'email', 'alice@example.com');
    expect(a).not.toBe(b);
  });
});

describe('strategies: pseudonymize', () => {
  it('emits a token prefixed with tenant + column', () => {
    let i = 0;
    const rand = () => `r${++i}`;
    const tok = pseudonymizeValue('t_1', 'email', rand);
    expect(tok).toBe('pseud::t_1::email::r1');
  });
});

describe('strategies: tombstoneRow', () => {
  it('returns the fixed shape with erased_at timestamp', () => {
    const row = tombstoneRow(new Date('2026-01-01T00:00:00.000Z'));
    expect(row.__tombstoned__).toBe(true);
    expect(row.erased_at).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('strategies: priority + collapse', () => {
  it('legal_hold > hard_delete > pseudonymize > anonymize > tombstone', () => {
    expect(strategyPriority('legal_hold')).toBeGreaterThan(strategyPriority('hard_delete'));
    expect(strategyPriority('hard_delete')).toBeGreaterThan(strategyPriority('pseudonymize'));
    expect(strategyPriority('pseudonymize')).toBeGreaterThan(strategyPriority('anonymize'));
    expect(strategyPriority('anonymize')).toBeGreaterThan(strategyPriority('tombstone'));
  });

  it('strongerStrategy collapses correctly', () => {
    expect(strongerStrategy('anonymize', 'hard_delete')).toBe('hard_delete');
    expect(strongerStrategy('legal_hold', 'hard_delete')).toBe('legal_hold');
    expect(strongerStrategy('tombstone', 'pseudonymize')).toBe('pseudonymize');
  });
});

describe('cascade runner: empty cascade', () => {
  it('returns an empty manifest with zero counts', async () => {
    const runner = buildErasureCascade();
    const report = await runner.run({
      cascadeId: 'c1',
      subjectId: 's',
      cascade: { tenantId: 't_1', rules: [] },
      records: [],
    });
    expect(report.actions).toEqual([]);
    expect(report.summary.hardDeleted).toBe(0);
    expect(report.summary.legalHold).toBe(0);
  });
});

describe('cascade runner: no rule for table = held (fail-closed)', () => {
  it('emits a legal_hold with `no_rule_declared_for_table` reason', async () => {
    const runner = buildErasureCascade();
    const records: DSARRecord[] = [
      {
        table: 'undeclared_table',
        primaryKey: 'r_1',
        columns: { foo: 'bar' },
        piiFields: ['foo'],
      },
    ];
    const cascade: ErasureCascadeSpec = { tenantId: 't_1', rules: [] };
    const report = await runner.run({
      cascadeId: 'c1',
      subjectId: 's',
      cascade,
      records,
    });
    expect(report.actions).toHaveLength(1);
    expect(report.actions[0]?.strategy).toBe('legal_hold');
    expect(report.actions[0]?.heldBecause).toBe('no_rule_declared_for_table');
  });
});

describe('cascade runner: legal-hold priority', () => {
  it('legal_hold wins over a competing hard_delete on the same table', async () => {
    const runner = buildErasureCascade();
    const cascade: ErasureCascadeSpec = {
      tenantId: 't_1',
      rules: [
        {
          table: 'payments',
          strategy: 'hard_delete',
          piiColumns: ['payer_name'],
        },
        {
          table: 'payments',
          strategy: 'legal_hold',
          piiColumns: ['payer_name'],
          retentionReason: 'TZ Income Tax Act § 80',
        },
      ],
    };
    const records: DSARRecord[] = [
      {
        table: 'payments',
        primaryKey: 'p_1',
        columns: { amount: 1000, payer_name: 'X' },
        piiFields: ['payer_name'],
      },
    ];
    const report = await runner.run({
      cascadeId: 'c1',
      subjectId: 's',
      cascade,
      records,
    });
    expect(report.actions[0]?.strategy).toBe('legal_hold');
    expect(report.actions[0]?.heldBecause).toMatch(/Tax Act/);
  });
});

describe('cascade runner: deterministic', () => {
  it('same inputs ⇒ identical manifest twice (replay safety)', async () => {
    const runner = buildErasureCascade();
    const cascade: ErasureCascadeSpec = {
      tenantId: 't_1',
      rules: cannedErasureRules(new Date('2026-01-01T00:00:00.000Z')),
    };
    const records: DSARRecord[] = [
      {
        table: 'users',
        primaryKey: 'u_1',
        columns: { email: 'a@x' },
        piiFields: ['email'],
      },
    ];
    const at = new Date('2026-01-01T00:00:00.000Z');
    const a = await runner.run({
      cascadeId: 'c1',
      subjectId: 's',
      cascade,
      records,
      now: () => at,
    });
    const b = await runner.run({
      cascadeId: 'c1',
      subjectId: 's',
      cascade,
      records,
      now: () => at,
    });
    expect(a).toEqual(b);
  });
});

describe('cannedErasureRules: 8 well-known tables present', () => {
  it('includes every table the spec requires', () => {
    const rules = cannedErasureRules();
    const tables = new Set(rules.map((r) => r.table));
    expect(tables.has('users')).toBe(true);
    expect(tables.has('leases')).toBe(true);
    expect(tables.has('payments')).toBe(true);
    expect(tables.has('communications')).toBe(true);
    expect(tables.has('document_uploads')).toBe(true);
    expect(tables.has('field_captures')).toBe(true);
    expect(tables.has('parcel_metadata_layers')).toBe(true);
    expect(tables.has('kernel_action_audit')).toBe(true);
    expect(rules.length).toBe(8);
  });

  it('payments has legal_hold + 7-year retention reason', () => {
    const rules = cannedErasureRules();
    const payments = rules.find((r) => r.table === 'payments');
    expect(payments?.strategy).toBe('legal_hold');
    expect(payments?.retentionReason).toMatch(/Income Tax Act/);
    expect(payments?.retentionUntil).toBeDefined();
  });
});
