import { describe, it, expect } from 'vitest';
import {
  canonicalTenantTablePrefix,
  isTenantNamespacedTable,
  isCoreTable,
  isPlainIdentifier,
  assertTenantIdShape,
  exceedsPgIdentifierLimit,
  pgIdentifierLimitError,
  PG_IDENTIFIER_MAX_BYTES,
} from '../identifier-policy.js';
import {
  isSafeColumnType,
  isSafeDefault,
} from '../column-type-allowlist.js';
import { TENANT, ns } from './fakes.js';

describe('identifier-policy', () => {
  it('builds the canonical prefix', () => {
    expect(canonicalTenantTablePrefix(TENANT)).toBe(`tenant_mod_${TENANT}_`);
  });

  it('accepts a well-formed namespaced table', () => {
    expect(isTenantNamespacedTable(ns('assay'), TENANT)).toBe(true);
    expect(isTenantNamespacedTable(`public.${ns('assay')}`, TENANT)).toBe(true);
  });

  it('rejects a foreign tenant namespace', () => {
    expect(isTenantNamespacedTable('tenant_mod_other_assay', TENANT)).toBe(false);
  });

  it('rejects a leading-digit slug', () => {
    expect(isTenantNamespacedTable(`tenant_mod_${TENANT}_9bad`, TENANT)).toBe(false);
  });

  it('rejects a quoted/mixed-case identifier', () => {
    expect(isPlainIdentifier(`"${ns('Assay')}"`)).toBe(false);
    expect(isPlainIdentifier(`${ns('assay')}; DROP`)).toBe(false);
    expect(isPlainIdentifier('Other.Schema.tbl')).toBe(false);
  });

  it('flags core tables', () => {
    expect(isCoreTable('tenants')).toBe(true);
    expect(isCoreTable('public.sovereign_approvals')).toBe(true);
    expect(isCoreTable(ns('assay'))).toBe(false);
  });

  it('asserts tenantId slug shape', () => {
    expect(() => assertTenantIdShape(TENANT)).not.toThrow();
    expect(() => assertTenantIdShape('9bad')).toThrow();
    expect(() => assertTenantIdShape('has space')).toThrow();
  });

  it('flags identifiers over the Postgres 63-byte limit (bare name, schema stripped)', () => {
    expect(PG_IDENTIFIER_MAX_BYTES).toBe(63);
    expect(exceedsPgIdentifierLimit('a'.repeat(63))).toBe(false);
    expect(exceedsPgIdentifierLimit('a'.repeat(64))).toBe(true);
    // The `public.` qualifier is not part of the stored identifier.
    expect(exceedsPgIdentifierLimit(`public.${'a'.repeat(63)}`)).toBe(false);
    expect(exceedsPgIdentifierLimit(`public.${'a'.repeat(64)}`)).toBe(true);
  });

  it('returns a structured limit error string or null', () => {
    expect(pgIdentifierLimitError('a'.repeat(63), 'table name')).toBeNull();
    const err = pgIdentifierLimitError('a'.repeat(64), 'table name');
    expect(err).toMatch(/63-byte limit \(table name\)/);
  });
});

describe('column-type-allowlist', () => {
  it('accepts every safe base type', () => {
    for (const t of ['TEXT', 'INTEGER', 'BIGINT', 'BOOLEAN', 'TIMESTAMPTZ', 'DATE', 'UUID', 'JSONB']) {
      expect(isSafeColumnType(t).ok).toBe(true);
    }
  });

  it('accepts parameterised varchar/numeric within bounds', () => {
    expect(isSafeColumnType('VARCHAR(120)').ok).toBe(true);
    expect(isSafeColumnType('NUMERIC(18, 4)').ok).toBe(true);
    expect(isSafeColumnType('NUMERIC').ok).toBe(true);
  });

  it('rejects disallowed types', () => {
    for (const t of ['SERIAL', 'regclass', 'int[]', 'money', 'json', 'bytea', 'oid', 'cidr']) {
      expect(isSafeColumnType(t).ok).toBe(false);
    }
  });

  it('rejects malformed parameterised types', () => {
    expect(isSafeColumnType('VARCHAR(').ok).toBe(false);
    expect(isSafeColumnType('NUMERIC(a, b)').ok).toBe(false);
    expect(isSafeColumnType('VARCHAR(1, 2)').ok).toBe(false);
  });

  it('accepts only the closed SYSTEM_DEFAULTS on system columns', () => {
    expect(isSafeDefault('NOW()', true).ok).toBe(true);
    expect(isSafeDefault("'active'", true).ok).toBe(true);
    expect(isSafeDefault('NULL', true).ok).toBe(true);
    expect(isSafeDefault("now() - interval '1 day'", true).ok).toBe(false);
    expect(isSafeDefault('gen_random_uuid()', true).ok).toBe(false);
  });

  it('rejects ALL author-supplied defaults', () => {
    expect(isSafeDefault('NOW()', false).ok).toBe(false);
    expect(isSafeDefault("'active'", false).ok).toBe(false);
    expect(isSafeDefault('NULL', false).ok).toBe(false);
  });
});
