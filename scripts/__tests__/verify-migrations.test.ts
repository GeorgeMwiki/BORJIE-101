/**
 * verify-migrations tests — pure helper coverage.
 *
 * Closes KI-001 unit-level guarantee: the regex extractors correctly
 * surface CREATE TABLE / CREATE INDEX / CREATE TYPE statements from
 * representative Drizzle migration shapes. The Postgres-touching code
 * path (probeDatabase, runVerify) is covered by an integration test
 * gated on DATABASE_URL — not part of the default vitest run.
 */

import { describe, it, expect } from 'vitest';
import {
  extractCreateTables,
  extractCreateIndexes,
  extractCreateTypes,
  evaluateDrift,
  migrationHashFromFilename,
  normalizeIdentifier,
  parseCliArgs,
  parseMigrationSource,
  stripSqlComments,
  type ParsedMigration,
} from '../verify-migrations.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIMPLE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tenants (
    id   text PRIMARY KEY,
    name text NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tenants_name_idx ON tenants(name);
`;

const ENUM_AND_TABLE_SQL = `
  DO $$ BEGIN
    CREATE TYPE tenant_status AS ENUM ('pending', 'active', 'suspended');
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

  CREATE TABLE IF NOT EXISTS organizations (
    id text PRIMARY KEY,
    tenant_id text REFERENCES tenants(id),
    status tenant_status NOT NULL
  );
`;

const SCHEMA_QUALIFIED_SQL = `
  -- Schema-qualified table with quoted identifier
  CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    id bigserial PRIMARY KEY
  );
  CREATE UNIQUE INDEX IF NOT EXISTS audit_log_unique_id ON public.audit_log(id);
`;

const COMMENT_TRAP_SQL = `
  -- CREATE TABLE this_should_be_ignored ();
  /*
    CREATE TABLE neither_should_this ();
  */
  CREATE TABLE real_table (id int);
`;

const DYNAMIC_SQL_FILE = `
  -- This migration creates tables via EXECUTE format(...) inside a
  -- DO block — the static regex MUST NOT pick this up.
  DO $$
  DECLARE
    tbl text := 'dynamic_table';
  BEGIN
    EXECUTE format('CREATE TABLE %I (id int)', tbl);
  END $$;
`;

// ---------------------------------------------------------------------------
// stripSqlComments
// ---------------------------------------------------------------------------

describe('stripSqlComments', () => {
  it('removes line comments while preserving newlines', () => {
    const out = stripSqlComments('CREATE TABLE foo (); -- comment\nSELECT 1;');
    expect(out).toContain('CREATE TABLE foo');
    expect(out).not.toContain('comment');
    expect(out).toContain('SELECT 1');
  });

  it('removes block comments greedily', () => {
    const out = stripSqlComments('/* a\nb */ CREATE TABLE x ();');
    expect(out.trim().startsWith('CREATE TABLE x')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeIdentifier
// ---------------------------------------------------------------------------

describe('normalizeIdentifier', () => {
  it('lowercases and strips quotes', () => {
    expect(normalizeIdentifier('"Foo"')).toBe('foo');
    expect(normalizeIdentifier('`Bar`')).toBe('bar');
  });

  it('drops schema prefix', () => {
    expect(normalizeIdentifier('public.tenants')).toBe('tenants');
    expect(normalizeIdentifier('"public"."Tenants"')).toBe('tenants');
  });

  it('trims whitespace', () => {
    expect(normalizeIdentifier('  spaced  ')).toBe('spaced');
  });
});

// ---------------------------------------------------------------------------
// extractCreateTables
// ---------------------------------------------------------------------------

describe('extractCreateTables', () => {
  it('extracts plain CREATE TABLE IF NOT EXISTS', () => {
    expect(extractCreateTables(SIMPLE_TABLE_SQL)).toEqual(['tenants']);
  });

  it('extracts table inside DO-block-adjacent enum migration', () => {
    expect(extractCreateTables(ENUM_AND_TABLE_SQL)).toEqual([
      'organizations',
    ]);
  });

  it('handles schema-qualified and quoted identifiers', () => {
    expect(extractCreateTables(SCHEMA_QUALIFIED_SQL)).toEqual([
      'audit_log',
    ]);
  });

  it('ignores CREATE TABLE inside comments', () => {
    const found = extractCreateTables(COMMENT_TRAP_SQL);
    expect(found).toEqual(['real_table']);
    expect(found).not.toContain('this_should_be_ignored');
    expect(found).not.toContain('neither_should_this');
  });

  it('does NOT detect dynamic CREATE TABLE inside EXECUTE — by design', () => {
    // This is the documented limitation; tests pin the behaviour so a
    // future "improvement" doesn't silently change the contract.
    expect(extractCreateTables(DYNAMIC_SQL_FILE)).toEqual([]);
  });

  it('deduplicates repeat tables', () => {
    const sql = `
      CREATE TABLE foo (id int);
      CREATE TABLE IF NOT EXISTS foo (id int);
    `;
    expect(extractCreateTables(sql)).toEqual(['foo']);
  });
});

// ---------------------------------------------------------------------------
// extractCreateIndexes
// ---------------------------------------------------------------------------

describe('extractCreateIndexes', () => {
  it('extracts plain CREATE INDEX', () => {
    expect(extractCreateIndexes(SIMPLE_TABLE_SQL)).toEqual([
      'tenants_name_idx',
    ]);
  });

  it('extracts UNIQUE / CONCURRENTLY / IF NOT EXISTS variations', () => {
    const sql = `
      CREATE UNIQUE INDEX IF NOT EXISTS u_idx ON foo(a);
      CREATE INDEX CONCURRENTLY c_idx ON foo(b);
      CREATE INDEX IF NOT EXISTS partial_idx ON foo(c) WHERE c IS NOT NULL;
    `;
    const found = [...extractCreateIndexes(sql)].sort();
    expect(found).toEqual(['c_idx', 'partial_idx', 'u_idx']);
  });

  it('ignores INDEX-like keywords inside comments', () => {
    const sql = `-- CREATE INDEX fake_idx ON bar(x);\nCREATE TABLE x (id int);`;
    expect(extractCreateIndexes(sql)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractCreateTypes
// ---------------------------------------------------------------------------

describe('extractCreateTypes', () => {
  it('extracts CREATE TYPE inside DO blocks (Borjie idiom)', () => {
    expect(extractCreateTypes(ENUM_AND_TABLE_SQL)).toEqual([
      'tenant_status',
    ]);
  });

  it('returns empty when no CREATE TYPE present', () => {
    expect(extractCreateTypes(SIMPLE_TABLE_SQL)).toEqual([]);
  });

  it('extracts multiple CREATE TYPE statements', () => {
    const sql = `
      CREATE TYPE role AS ENUM ('a', 'b');
      CREATE TYPE status AS ENUM ('c', 'd');
    `;
    const found = [...extractCreateTypes(sql)].sort();
    expect(found).toEqual(['role', 'status']);
  });
});

// ---------------------------------------------------------------------------
// migrationHashFromFilename
// ---------------------------------------------------------------------------

describe('migrationHashFromFilename', () => {
  it('strips .sql extension', () => {
    expect(migrationHashFromFilename('0000_borjie_bootstrap.sql')).toBe(
      '0000_borjie_bootstrap',
    );
  });

  it('matches the Drizzle ledger hash format used by run-migrations.ts', () => {
    expect(migrationHashFromFilename('0076_cognitive_wiring_health.sql')).toBe(
      '0076_cognitive_wiring_health',
    );
  });
});

// ---------------------------------------------------------------------------
// parseMigrationSource
// ---------------------------------------------------------------------------

describe('parseMigrationSource', () => {
  it('produces a full ParsedMigration from raw SQL + filename', () => {
    const parsed = parseMigrationSource(
      '0003_mining_domain.sql',
      ENUM_AND_TABLE_SQL,
    );
    expect(parsed.filename).toBe('0003_mining_domain.sql');
    expect(parsed.hash).toBe('0003_mining_domain');
    expect(parsed.tables).toEqual(['organizations']);
    expect(parsed.types).toEqual(['tenant_status']);
    expect(parsed.indexes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// evaluateDrift
// ---------------------------------------------------------------------------

describe('evaluateDrift', () => {
  const baseMigration: ParsedMigration = {
    filename: '0021_compliance_exports.sql',
    hash: '0021_compliance_exports',
    tables: ['compliance_exports'],
    indexes: [],
    types: [],
  };

  it('reports MATCHED when applied + all relations present', () => {
    const findings = evaluateDrift([baseMigration], {
      appliedHashes: new Set(['0021_compliance_exports']),
      tables: new Set(['compliance_exports']),
      indexes: new Set(),
      types: new Set(),
    });
    const f = findings[0];
    expect(f).toBeDefined();
    expect(f?.status).toBe('matched');
    expect(f?.missingTables).toEqual([]);
  });

  it('reports DRIFT when applied but table missing — KI-001 case', () => {
    const findings = evaluateDrift([baseMigration], {
      appliedHashes: new Set(['0021_compliance_exports']),
      tables: new Set(), // table missing despite ledger says applied
      indexes: new Set(),
      types: new Set(),
    });
    const f = findings[0];
    expect(f).toBeDefined();
    expect(f?.status).toBe('drift');
    expect(f?.missingTables).toEqual(['compliance_exports']);
  });

  it('reports SKIPPED when migration not in ledger', () => {
    const findings = evaluateDrift([baseMigration], {
      appliedHashes: new Set(),
      tables: new Set(),
      indexes: new Set(),
      types: new Set(),
    });
    const f = findings[0];
    expect(f).toBeDefined();
    expect(f?.status).toBe('skipped');
    expect(f?.reason).toContain('not recorded');
  });

  it('reports SKIPPED when no CREATE statements extracted', () => {
    const noRelations: ParsedMigration = {
      ...baseMigration,
      tables: [],
      indexes: [],
      types: [],
    };
    const findings = evaluateDrift([noRelations], {
      appliedHashes: new Set(['0021_compliance_exports']),
      tables: new Set(),
      indexes: new Set(),
      types: new Set(),
    });
    const f = findings[0];
    expect(f).toBeDefined();
    expect(f?.status).toBe('skipped');
    expect(f?.reason).toContain('no parseable');
  });

  it('aggregates missing relations across tables / indexes / types', () => {
    const compound: ParsedMigration = {
      filename: '0000_borjie_bootstrap.sql',
      hash: '0000_borjie_bootstrap',
      tables: ['tenants', 'organizations'],
      indexes: ['tenants_email_idx'],
      types: ['tenant_status'],
    };
    const findings = evaluateDrift([compound], {
      appliedHashes: new Set(['0000_borjie_bootstrap']),
      tables: new Set(['tenants']), // organizations missing
      indexes: new Set(), // tenants_email_idx missing
      types: new Set(['tenant_status']),
    });
    const f = findings[0];
    expect(f).toBeDefined();
    expect(f?.status).toBe('drift');
    expect(f?.missingTables).toEqual(['organizations']);
    expect(f?.missingIndexes).toEqual(['tenants_email_idx']);
    expect(f?.missingTypes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  it('parses --migrations-dir into a list', () => {
    const args = parseCliArgs([
      '--migrations-dir=packages/database/drizzle',
    ]);
    expect(args.migrationsDirs).toEqual([
      'packages/database/drizzle',
    ]);
  });

  it('accepts multiple --migrations-dir occurrences', () => {
    const args = parseCliArgs([
      '--migrations-dir=a',
      '--migrations-dir=b',
    ]);
    expect(args.migrationsDirs).toEqual(['a', 'b']);
  });

  it('parses --json and --help', () => {
    const args = parseCliArgs(['--json', '--help']);
    expect(args.json).toBe(true);
    expect(args.help).toBe(true);
  });

  it('returns empty defaults when no args', () => {
    const args = parseCliArgs([]);
    expect(args.migrationsDirs).toEqual([]);
    expect(args.json).toBe(false);
    expect(args.help).toBe(false);
  });
});
