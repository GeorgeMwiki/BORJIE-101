import { describe, it, expect } from 'vitest';
import { validateGeneratedDdl } from '../ddl-allowlist-validator.js';
import {
  TENANT,
  ns,
  buildAcceptedDdl,
  buildEntityTable,
  buildIndexes,
} from './fakes.js';
import { buildCanonicalRlsBlock } from '../rls-force-injector.js';

function v(sql: string, tenantId = TENANT) {
  return validateGeneratedDdl({ tenantId, migrationSql: sql });
}

describe('validateGeneratedDdl — ACCEPT path', () => {
  it('accepts a real compiler-shaped migration transformed to tenant_mod_ prefix', () => {
    const r = v(buildAcceptedDdl('assay'));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.createdTables).toContain(ns('assay'));
  });

  it('accepts multiple spawned tables in one migration', () => {
    const t1 = ns('assay');
    const t2 = ns('shipment');
    const sql = [
      buildEntityTable('assay'),
      buildEntityTable('shipment'),
      buildIndexes('assay'),
      buildCanonicalRlsBlock(TENANT, [t1, t2]),
    ].join('\n\n');
    const r = v(sql);
    expect(r.ok).toBe(true);
    expect(r.createdTables).toEqual(expect.arrayContaining([t1, t2]));
  });
});

describe('validateGeneratedDdl — HARD REJECT classes', () => {
  const accepted = () => buildAcceptedDdl('assay');

  it('rejects DROP', () => {
    const r = v(`${accepted()}\n\nDROP TABLE ${ns('assay')};`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/DROP/);
  });

  it('rejects ALTER of a core table', () => {
    const r = v(`${accepted()}\n\nALTER TABLE tenants ADD COLUMN x text;`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ALTER/);
  });

  it('rejects ALTER of any table (even namespaced) outside the canonical RLS block', () => {
    const r = v(`${accepted()}\n\nALTER TABLE ${ns('assay')} ADD COLUMN sneaky text;`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/ALTER/);
  });

  it('rejects TRUNCATE', () => {
    const r = v(`${accepted()}\n\nTRUNCATE ${ns('assay')};`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/TRUNCATE/);
  });

  it('rejects GRANT', () => {
    const r = v(`${accepted()}\n\nGRANT ALL ON ${ns('assay')} TO public;`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/GRANT/);
  });

  it('rejects a stray REVOKE outside the canonical RLS block', () => {
    const r = v(`${accepted()}\n\nREVOKE ALL ON tenants FROM authenticated;`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/REVOKE/);
  });

  it('rejects COPY', () => {
    const r = v(`${accepted()}\n\nCOPY ${ns('assay')} FROM '/etc/passwd';`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/COPY/);
  });

  it('rejects CREATE FUNCTION', () => {
    const r = v(
      `${accepted()}\n\nCREATE FUNCTION evil() RETURNS void AS $f$ BEGIN END $f$ LANGUAGE plpgsql;`,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/FUNCTION/);
  });

  it('rejects CREATE TRIGGER', () => {
    const r = v(
      `${accepted()}\n\nCREATE TRIGGER t AFTER INSERT ON ${ns('assay')} EXECUTE FUNCTION f();`,
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/TRIGGER/);
  });

  it('rejects CREATE EXTENSION', () => {
    const r = v(`${accepted()}\n\nCREATE EXTENSION IF NOT EXISTS pg_cron;`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/EXTENSION/);
  });

  it('rejects multi-statement smuggling via an extra DROP after a valid CREATE', () => {
    // Two statements in one blob; the second is forbidden.
    const sql = `${buildEntityTable('assay')}\nDROP TABLE tenants;\n${buildCanonicalRlsBlock(
      TENANT,
      [ns('assay')],
    )}`;
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/DROP/);
  });

  it('rejects a CREATE TABLE that references/targets a core table name', () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS tenants (`,
      '  id TEXT PRIMARY KEY,',
      '  tenant_id TEXT NOT NULL,',
      '  module_id TEXT NOT NULL,',
      "  lifecycle_state TEXT NOT NULL DEFAULT 'active'",
      ');',
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/core table/i);
  });

  it('rejects a non-namespaced (no tenant_mod_ prefix) table', () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS random_table (`,
      '  id TEXT PRIMARY KEY,',
      '  tenant_id TEXT NOT NULL',
      ');',
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/outside the tenant namespace/i);
  });

  it("rejects a foreign tenant's namespace prefix", () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS tenant_mod_other_tenant_assay (`,
      '  id TEXT PRIMARY KEY',
      ');',
    ].join('\n');
    const r = v(sql); // validated for TENANT=acme_mining
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/outside the tenant namespace/i);
  });

  it('rejects a disallowed column type (e.g. SERIAL / regclass / arrays)', () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS ${ns('assay')} (`,
      '  id TEXT PRIMARY KEY,',
      '  evil regclass',
      ');',
      buildCanonicalRlsBlock(TENANT, [ns('assay')]),
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/disallowed column type/i);
  });

  it('rejects an arbitrary author DEFAULT expression (now()-injection style)', () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS ${ns('assay')} (`,
      '  id TEXT PRIMARY KEY,',
      "  created_window TIMESTAMPTZ DEFAULT (now() - interval '7 days')",
      ');',
      buildCanonicalRlsBlock(TENANT, [ns('assay')]),
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/DEFAULT/i);
  });

  it('rejects a comment-smuggled DROP that tries to look like a statement', () => {
    // The DROP is inside a block comment; tokenizer strips it. But if an
    // attacker terminates the comment to expose a real DROP, it's caught
    // as a real statement.
    const sql = `${buildEntityTable('assay')}\n/* harmless */ DROP TABLE tenants;\n${buildCanonicalRlsBlock(
      TENANT,
      [ns('assay')],
    )}`;
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/DROP/);
  });

  it('rejects a string-literal-smuggled SQL inside a column DEFAULT', () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS ${ns('assay')} (`,
      '  id TEXT PRIMARY KEY,',
      "  note TEXT DEFAULT ''; DROP TABLE tenants; --'",
      ');',
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
  });

  it('rejects a leading-digit / non-slug table name', () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS tenant_mod_${TENANT}_9bad (`,
      '  id TEXT PRIMARY KEY',
      ');',
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/outside the tenant namespace/i);
  });

  it('rejects a quoted identifier with a smuggled semicolon in the name', () => {
    const sql = `CREATE TABLE "${ns('assay')}; DROP TABLE tenants" (id TEXT PRIMARY KEY);`;
    const r = v(sql);
    expect(r.ok).toBe(false);
  });

  it('rejects a disallowed REFERENCES to a core table on an author column', () => {
    const sql = [
      `CREATE TABLE IF NOT EXISTS ${ns('assay')} (`,
      '  id TEXT PRIMARY KEY,',
      '  owner_id TEXT REFERENCES users(id)',
      ');',
      buildCanonicalRlsBlock(TENANT, [ns('assay')]),
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/disallowed REFERENCES/i);
  });

  it('rejects an unterminated comment (smuggling signal)', () => {
    const r = v(`${buildEntityTable('assay')}\n/* unterminated`);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/unterminated/i);
  });

  it('rejects a CREATE INDEX on a non-namespaced table', () => {
    const sql = [
      buildEntityTable('assay'),
      'CREATE INDEX i ON tenants (id);',
      buildCanonicalRlsBlock(TENANT, [ns('assay')]),
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/core table|outside the tenant namespace/i);
  });

  it('rejects a non-slug tenantId outright', () => {
    const r = v(buildEntityTable('assay'), '9-evil; DROP');
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/slug-shaped/i);
  });

  it('rejects when a created table has NO RLS block (HARD RULE 2)', () => {
    const sql = `${buildEntityTable('assay')}\n${buildIndexes('assay')}`;
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/RLS|ROW LEVEL SECURITY|FORCE/i);
  });

  it('rejects a DO block that smuggles a DROP TABLE inside its body', () => {
    const evilDo = [
      'DO $x$',
      'BEGIN',
      `  EXECUTE 'ALTER TABLE public.${ns('assay')} ENABLE ROW LEVEL SECURITY';`,
      '  DROP TABLE tenants;',
      'END',
      '$x$;',
    ].join('\n');
    const sql = `${buildEntityTable('assay')}\n${evilDo}`;
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/DROP TABLE inside DO|RLS|FORCE/i);
  });

  it('rejects RLS faked via a comment instead of real CREATE POLICY statements', () => {
    const sql = [
      buildEntityTable('assay'),
      '-- ENABLE ROW LEVEL SECURITY FORCE ROW LEVEL SECURITY CREATE POLICY tenant_isolation service_role_bypass',
    ].join('\n');
    expect(v(sql).ok).toBe(false);
  });

  it('rejects a DO body that ALTERs a hard-coded core table (non-parameterised)', () => {
    const sql = [
      buildEntityTable('assay'),
      `DO $x$ BEGIN EXECUTE 'ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY'; END $x$;`,
    ].join('\n');
    expect(v(sql).ok).toBe(false);
  });

  it('rejects a dollar-tag-mismatch smuggle (inner $b$ does not close outer $a$)', () => {
    const sql = `${buildEntityTable('assay')}\nDO $a$ SELECT 1 $b$; DROP TABLE tenants; $a$;`;
    expect(v(sql).ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// DDL-ESCAPE mustFix — POSITIVE-ALLOWLIST for the DO block (FIX 1) +
// strict CREATE INDEX grammar (FIX 2). The validator no longer judges a
// DO block by a denylist scan of its body: the ONLY accepted DO block
// must be BYTE-IDENTICAL to the freshly-built canonical RLS block. This
// closes the `DO $evil$ … EXECUTE format(…CREATE ROLE … SUPERUSER…) $evil$`
// arbitrary-DDL/DCL escape a denylist would miss, and rejects every
// functional/expression index.
// ─────────────────────────────────────────────────────────────────────
describe('validateGeneratedDdl — DO-block positive allowlist (FIX 1)', () => {
  it('(a) REJECTS a SECOND DO block (EXECUTE format CREATE ROLE … SUPERUSER) appended after the canonical block', () => {
    const t = ns('assay');
    const evilSecondDo =
      'DO $x$ BEGIN EXECUTE format($f$CREATE ROLE hacker SUPERUSER$f$); END $x$;';
    const sql = [
      buildEntityTable('assay'),
      buildIndexes('assay'),
      buildCanonicalRlsBlock(TENANT, [t]),
      evilSecondDo,
    ].join('\n\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    // Caught either by the >1-DO-block rule or the secondary CREATE ROLE
    // denylist — both are walls; the migration must never apply.
    expect(r.errors.join(' ')).toMatch(
      /at most one canonical RLS DO block|CREATE ROLE|byte-identical/i,
    );
  });

  it('(a2) REJECTS a SECOND RLS-ish DO block with NO banned keyword (proves the COUNT rule, not the denylist, is the wall)', () => {
    const t = ns('assay');
    // Two byte-identical canonical blocks: neither trips any denylist, so
    // only the "exactly one DO block" rule can reject this.
    const sql = [
      buildEntityTable('assay'),
      buildCanonicalRlsBlock(TENANT, [t]),
      buildCanonicalRlsBlock(TENANT, [t]),
    ].join('\n\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/at most one canonical RLS DO block/i);
  });

  it('(b) REJECTS a DO block whose body differs by ONE byte from the canonical', () => {
    const t = ns('assay');
    const canonical = buildCanonicalRlsBlock(TENANT, [t]);
    // Flip a single byte INSIDE the DO body — the `CREATE POLICY
    // tenant_isolation` statement (which lives inside the dollar-quoted
    // body, not the stripped comment header). Structurally plausible, but
    // no longer byte-identical to what the guard itself would build.
    const oneByteOff = canonical.replace(
      'CREATE POLICY tenant_isolation',
      'CREATE POLICY tenant_isolatiom',
    );
    expect(oneByteOff).not.toBe(canonical);
    const sql = [buildEntityTable('assay'), oneByteOff].join('\n\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(
      /byte-identical to the canonical guard block|tenant_isolation/i,
    );
  });

  it('(e) REJECTS two DO blocks even if BOTH look RLS-ish', () => {
    const a = ns('assay');
    const b = ns('shipment');
    const sql = [
      buildEntityTable('assay'),
      buildEntityTable('shipment'),
      // Two separate (RLS-ish) canonical blocks instead of one combined.
      buildCanonicalRlsBlock(TENANT, [a]),
      buildCanonicalRlsBlock(TENANT, [b]),
    ].join('\n\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/at most one canonical RLS DO block/i);
  });

  it('REJECTS created tables with ZERO DO blocks (no RLS)', () => {
    const sql = [buildEntityTable('assay'), buildIndexes('assay')].join('\n\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(
      /without the canonical FORCE-RLS DO block|RLS is mandatory|ROW LEVEL SECURITY/i,
    );
  });

  it('(d) ACCEPTS the REAL compiler+RLS output (canonical block byte-matches)', () => {
    const r = v(buildAcceptedDdl('assay'));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.createdTables).toContain(ns('assay'));
  });
});

describe('validateGeneratedDdl — strict CREATE INDEX grammar (FIX 2)', () => {
  const t = ns('assay');
  function withIndex(indexStmt: string): string {
    return [
      buildEntityTable('assay'),
      indexStmt,
      buildCanonicalRlsBlock(TENANT, [t]),
    ].join('\n\n');
  }

  it('(c) REJECTS a functional index (lower(name))', () => {
    const r = v(withIndex(`CREATE INDEX i ON ${t} (lower(name));`));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/bare column identifier|expression/i);
  });

  it('(c) REJECTS an expression index (pg_sleep(1))', () => {
    const r = v(withIndex(`CREATE INDEX i ON ${t} (pg_sleep(1));`));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/bare column identifier|expression/i);
  });

  it('REJECTS an operator-class / COLLATE tail', () => {
    const r = v(
      withIndex(`CREATE INDEX i ON ${t} (sample_ref COLLATE "C");`),
    );
    expect(r.ok).toBe(false);
  });

  it('REJECTS a disallowed access method (USING spgist)', () => {
    const r = v(withIndex(`CREATE INDEX i ON ${t} USING spgist (tenant_id);`));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/disallowed access method/i);
  });

  it('REJECTS a non-conservative partial predicate (WHERE grade_pct > 0)', () => {
    const r = v(
      withIndex(
        `CREATE INDEX i ON ${t} (tenant_id) WHERE grade_pct > 0;`,
      ),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/partial predicate/i);
  });

  it("ACCEPTS the compiler's `(tenant_id) WHERE deleted_at IS NULL` index", () => {
    const sql = withIndex(
      `CREATE INDEX IF NOT EXISTS ${t}_tenant_idx ON ${t} (tenant_id) WHERE deleted_at IS NULL;`,
    );
    const r = v(sql);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("ACCEPTS the compiler's `(module_id, tenant_id) WHERE deleted_at IS NULL` index", () => {
    const sql = withIndex(
      `CREATE INDEX IF NOT EXISTS ${t}_module_idx ON ${t} (module_id, tenant_id) WHERE deleted_at IS NULL;`,
    );
    const r = v(sql);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('ACCEPTS a bare single-column field index `(grade_pct)`', () => {
    const sql = withIndex(`CREATE INDEX IF NOT EXISTS ${t}_grade_idx ON ${t} (grade_pct);`);
    const r = v(sql);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('ACCEPTS an explicit USING btree column-list index', () => {
    const sql = withIndex(
      `CREATE INDEX IF NOT EXISTS ${t}_btree_idx ON ${t} USING btree (sample_ref);`,
    );
    const r = v(sql);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// FIX 3 — defence-in-depth DENYLIST inside any DO body. FIX 1's
// byte-compare already makes an author DO body impossible, but the
// hardened denylist is the SECONDARY net catching DCL / cluster-wide /
// role / system / policy-destroying statements an attacker reaches for
// inside a `DO $evil$ … EXECUTE format(…) $evil$` escape.
// ─────────────────────────────────────────────────────────────────────
describe('validateGeneratedDdl — hardened DO denylist (FIX 3, secondary net)', () => {
  const t = ns('assay');
  function withDo(doBlock: string): string {
    return [buildEntityTable('assay'), doBlock].join('\n');
  }
  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    [
      'CREATE ROLE',
      `DO $x$ BEGIN EXECUTE 'ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY'; CREATE ROLE evil; END $x$;`,
      /CREATE ROLE/i,
    ],
    [
      'ALTER SYSTEM',
      `DO $x$ BEGIN ALTER SYSTEM SET shared_buffers='1GB'; END $x$;`,
      /ALTER SYSTEM/i,
    ],
    ['REINDEX', `DO $x$ BEGIN REINDEX TABLE public.${t}; END $x$;`, /REINDEX/i],
    ['CLUSTER', `DO $x$ BEGIN CLUSTER public.${t}; END $x$;`, /CLUSTER/i],
    ['DROP INDEX', `DO $x$ BEGIN DROP INDEX foo; END $x$;`, /DROP INDEX/i],
    [
      'DROP DATABASE',
      `DO $x$ BEGIN DROP DATABASE postgres; END $x$;`,
      /DROP DATABASE/i,
    ],
    [
      'SECURITY LABEL',
      `DO $x$ BEGIN SECURITY LABEL FOR selinux ON TABLE public.${t} IS 'x'; END $x$;`,
      /SECURITY LABEL/i,
    ],
    [
      'REASSIGN OWNED',
      `DO $x$ BEGIN REASSIGN OWNED BY app TO evil; END $x$;`,
      /REASSIGN OWNED/i,
    ],
    [
      'ALTER … OWNER',
      `DO $x$ BEGIN ALTER TABLE public.${t} OWNER TO evil; END $x$;`,
      /ALTER … OWNER|ALTER TABLE/i,
    ],
    [
      'non-parameterised DROP POLICY',
      `DO $x$ BEGIN DROP POLICY p ON public.tenants; END $x$;`,
      /non-parameterised DROP POLICY|non-namespaced\/core table/i,
    ],
  ];
  for (const [label, doBlock, pattern] of cases) {
    it(`REJECTS ${label} inside a DO body`, () => {
      const r = v(withDo(doBlock));
      expect(r.ok).toBe(false);
      expect(r.errors.join(' ')).toMatch(pattern);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Postgres 63-byte identifier wall (Pass 2). Postgres silently truncates
// any identifier over NAMEDATALEN-1 (63 bytes), which would let two
// distinct logical tables collide. The validator rejects an over-length
// table OR index name at apply-time (defence in depth).
// ─────────────────────────────────────────────────────────────────────
describe('validateGeneratedDdl — 63-byte identifier wall', () => {
  // prefix `tenant_mod_acme_mining_` is 23 bytes.
  const prefixBytes = `tenant_mod_${TENANT}_`.length;

  function slugOfTableByteLength(total: number): string {
    return 'a'.repeat(total - prefixBytes);
  }

  it('ACCEPTS a 63-byte tenant_mod_ table name', () => {
    const slug = slugOfTableByteLength(63);
    const table = ns(slug);
    expect(table.length).toBe(63);
    const sql = [
      `CREATE TABLE IF NOT EXISTS ${table} (`,
      '  id TEXT PRIMARY KEY,',
      '  tenant_id TEXT NOT NULL',
      ');',
      buildCanonicalRlsBlock(TENANT, [table]),
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(true);
    expect(r.createdTables).toContain(table);
  });

  it('REJECTS a 64-byte tenant_mod_ table name (silent-truncation hazard)', () => {
    const slug = slugOfTableByteLength(64);
    const table = ns(slug);
    expect(table.length).toBe(64);
    const sql = [
      `CREATE TABLE IF NOT EXISTS ${table} (`,
      '  id TEXT PRIMARY KEY,',
      '  tenant_id TEXT NOT NULL',
      ');',
      buildCanonicalRlsBlock(TENANT, [table]),
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/63-byte limit/);
  });

  it('REJECTS a 64-byte index name on a valid table', () => {
    const table = ns('assay');
    const idxName = 'i'.repeat(64);
    const sql = [
      buildEntityTable('assay'),
      `CREATE INDEX IF NOT EXISTS ${idxName} ON ${table} (id);`,
      buildCanonicalRlsBlock(TENANT, [table]),
    ].join('\n');
    const r = v(sql);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/63-byte limit/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// FIX 1 — CHECK / GENERATED column + table-constraint escape closure.
// These previously passed UNVALIDATED (extractTypeFragment cut at
// CHECK/GENERATED but never inspected the expression), letting a hostile
// spec smuggle a subquery into a core table, a stored generated column
// reading core, or an arbitrary function call into write-time SQL.
// ─────────────────────────────────────────────────────────────────────
describe('validateGeneratedDdl — CHECK / GENERATED expression wall (FIX 1)', () => {
  function tableWith(colLines: string[]): string {
    const table = ns('assay');
    return [
      `CREATE TABLE IF NOT EXISTS ${table} (`,
      '  id TEXT PRIMARY KEY,',
      '  tenant_id TEXT NOT NULL,',
      ...colLines,
      ');',
      buildCanonicalRlsBlock(TENANT, [table]),
    ].join('\n');
  }

  it('REJECTS a column-level CHECK with a subquery into a CORE table', () => {
    const r = v(tableWith(['  x TEXT CHECK (x IN (SELECT id FROM tenants))']));
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/CHECK\/GENERATED|forbidden CHECK/i);
  });

  it('REJECTS a stored GENERATED column reading a CORE table', () => {
    const r = v(
      tableWith([
        '  g TEXT GENERATED ALWAYS AS ((SELECT id FROM tenants LIMIT 1)) STORED',
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/CHECK\/GENERATED|forbidden CHECK/i);
  });

  it('REJECTS a column-level CHECK calling an arbitrary function (pg_read_file)', () => {
    const r = v(
      tableWith([
        "  x TEXT CHECK (length(x) < pg_read_file('/etc/passwd')::int)",
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/CHECK\/GENERATED|forbidden CHECK/i);
  });

  it('REJECTS a GENERATED … AS IDENTITY column', () => {
    const r = v(
      tableWith(['  seq BIGINT GENERATED ALWAYS AS IDENTITY']),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/CHECK\/GENERATED|forbidden CHECK/i);
  });

  it('REJECTS a table-level CONSTRAINT … CHECK item', () => {
    const r = v(
      tableWith([
        '  x TEXT,',
        '  CONSTRAINT x_into_core CHECK (x IN (SELECT id FROM tenants))',
      ]),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/CONSTRAINT|CHECK\/GENERATED|table-level/i);
  });

  it('REJECTS a bare table-level CHECK item', () => {
    const r = v(
      tableWith(['  x TEXT,', '  CHECK (x IN (SELECT id FROM tenants))']),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/CHECK\/GENERATED|table-level|CHECK/i);
  });

  it('does NOT falsely match a CHECK keyword hidden in a string-literal DEFAULT', () => {
    // The author column itself is illegal (author DEFAULT forbidden), but
    // the rejection must be the DEFAULT wall — NOT a phantom CHECK match —
    // proving the keyword scan runs on the placeholder-normalised stream.
    const r = v(
      tableWith(["  note TEXT DEFAULT 'CHECK (this is just text)'"]),
    );
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/DEFAULT/i);
    expect(r.errors.join(' ')).not.toMatch(/forbidden CHECK\/GENERATED/i);
  });

  it('ACCEPTS a legal column WITHOUT check/generated (no false-positive regression)', () => {
    const r = v(
      tableWith([
        '  grade_pct NUMERIC(18, 4),',
        '  sample_ref VARCHAR(120),',
        '  assayed BOOLEAN,',
        '  metadata JSONB',
      ]),
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.createdTables).toContain(ns('assay'));
  });

  it('ACCEPTS columns whose NAMES merely start with check/generated (word-boundary safety)', () => {
    const r = v(
      tableWith(['  checksum TEXT,', '  generated_at TIMESTAMPTZ']),
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });
});
