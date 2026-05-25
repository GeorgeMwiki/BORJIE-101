/**
 * validate-migration-safety — dangerous-pattern detectors.
 *
 * Covers the three new linters added to support the migration-apply CI
 * gate (.github/workflows/migration-apply-check.yml):
 *
 *   1. findUnguardedDrops          — DROP without IF EXISTS
 *   2. findTruncateStatements      — TRUNCATE in forward-only migration
 *   3. findBlockingIndexCreates    — CREATE INDEX (no CONCURRENTLY) on
 *                                    a known-large table
 *
 * All three are pure functions that operate on a pre-stripped SQL
 * string; the existing NOT NULL pass is unchanged and covered by a
 * sibling test (validate-migration-safety.test.ts in the wave-K
 * worktree). These tests run via the script's ESM module surface.
 */

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validator: any = await import(
  '../validate-migration-safety.mjs' as unknown as string
);

const LARGE_TABLES = new Set(['transactions', 'invoices', 'audit_chain']);

describe('findUnguardedDrops', () => {
  it('flags DROP TABLE without IF EXISTS', () => {
    const sql = 'DROP TABLE legacy_audit;';
    const findings = validator.findUnguardedDrops(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('unguarded_drop');
    expect(findings[0].target).toBe('legacy_audit');
  });

  it('does NOT flag DROP TABLE IF EXISTS', () => {
    const sql = 'DROP TABLE IF EXISTS legacy_audit;';
    const findings = validator.findUnguardedDrops(sql);
    expect(findings).toHaveLength(0);
  });

  it('flags DROP COLUMN without IF EXISTS', () => {
    const sql = 'ALTER TABLE foo DROP COLUMN bar;';
    const findings = validator.findUnguardedDrops(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0].verb).toContain('drop column');
  });

  it('does NOT flag DROP COLUMN IF EXISTS', () => {
    const sql = 'ALTER TABLE foo DROP COLUMN IF EXISTS bar;';
    const findings = validator.findUnguardedDrops(sql);
    expect(findings).toHaveLength(0);
  });

  it('flags DROP INDEX without IF EXISTS', () => {
    const sql = 'DROP INDEX legacy_idx;';
    const findings = validator.findUnguardedDrops(sql);
    expect(findings).toHaveLength(1);
  });

  it('handles multiple statements in one file', () => {
    const sql = `
      DROP TABLE IF EXISTS safe_table;
      DROP TABLE unsafe_table;
      ALTER TABLE foo DROP COLUMN unsafe_col;
    `;
    const findings = validator.findUnguardedDrops(sql);
    expect(findings).toHaveLength(2);
    const targets = findings.map((f: { target: string }) => f.target).sort();
    expect(targets).toEqual(['unsafe_col', 'unsafe_table']);
  });

  it('is case-insensitive', () => {
    const sql = 'drop table foo;';
    const findings = validator.findUnguardedDrops(sql);
    expect(findings).toHaveLength(1);
  });
});

describe('findTruncateStatements', () => {
  it('flags TRUNCATE TABLE', () => {
    const sql = 'TRUNCATE TABLE audit_log;';
    const findings = validator.findTruncateStatements(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('truncate');
    expect(findings[0].target).toBe('audit_log');
  });

  it('flags bare TRUNCATE without TABLE keyword', () => {
    const sql = 'TRUNCATE audit_log;';
    const findings = validator.findTruncateStatements(sql);
    expect(findings).toHaveLength(1);
  });

  it('flags TRUNCATE with CASCADE', () => {
    const sql = 'TRUNCATE TABLE audit_log CASCADE;';
    const findings = validator.findTruncateStatements(sql);
    expect(findings).toHaveLength(1);
  });

  it('flags TRUNCATE with RESTART IDENTITY', () => {
    const sql = 'TRUNCATE TABLE audit_log RESTART IDENTITY;';
    const findings = validator.findTruncateStatements(sql);
    expect(findings).toHaveLength(1);
  });

  it('does not flag CREATE TABLE that happens to contain the word truncate', () => {
    const sql = `
      CREATE TABLE foo (
        id TEXT PRIMARY KEY,
        notes TEXT
      );
      COMMENT ON TABLE foo IS 'do not truncate this table';
    `;
    const findings = validator.findTruncateStatements(sql);
    expect(findings).toHaveLength(0);
  });
});

describe('findBlockingIndexCreates', () => {
  it('flags CREATE INDEX on a large table without CONCURRENTLY', () => {
    const sql = 'CREATE INDEX idx_tx ON transactions (created_at);';
    const findings = validator.findBlockingIndexCreates(sql, LARGE_TABLES, sql);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('blocking_index');
    expect(findings[0].table).toBe('transactions');
    expect(findings[0].allowlisted).toBe(false);
  });

  it('does NOT flag CONCURRENTLY index on large table', () => {
    const sql = 'CREATE INDEX CONCURRENTLY idx_tx ON transactions (created_at);';
    const findings = validator.findBlockingIndexCreates(sql, LARGE_TABLES, sql);
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag CREATE INDEX on a small table without CONCURRENTLY', () => {
    const sql = 'CREATE INDEX idx_settings ON settings (key);';
    const findings = validator.findBlockingIndexCreates(sql, LARGE_TABLES, sql);
    expect(findings).toHaveLength(0);
  });

  it('flags CREATE UNIQUE INDEX on a large table', () => {
    const sql = 'CREATE UNIQUE INDEX uniq_inv ON invoices (id, number);';
    const findings = validator.findBlockingIndexCreates(sql, LARGE_TABLES, sql);
    expect(findings).toHaveLength(1);
    expect(findings[0].table).toBe('invoices');
  });

  it('honors @safety: blocking-index-reviewed allowlist marker', () => {
    const sql = 'CREATE INDEX idx_tx ON transactions (created_at);';
    const raw =
      '-- @safety: blocking-index-reviewed\n' +
      '-- Justification: bootstrap, table is empty.\n' +
      sql;
    const findings = validator.findBlockingIndexCreates(sql, LARGE_TABLES, raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].allowlisted).toBe(true);
  });

  it('handles IF NOT EXISTS guard cleanly', () => {
    const sql =
      'CREATE INDEX IF NOT EXISTS idx_tx ON transactions (created_at);';
    const findings = validator.findBlockingIndexCreates(sql, LARGE_TABLES, sql);
    expect(findings).toHaveLength(1);
  });
});
