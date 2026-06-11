/**
 * RLS coverage guard — THE proof obligation for tenant isolation.
 *
 * Statically analyses the ENTIRE migration chain (drizzle/ baselines +
 * src/migrations/ deltas) and asserts that EVERY table which declares a
 * tenant-scoping column (`tenant_id` or any `*_tenant_id`, e.g.
 * `installed_by_tenant_id`) has, somewhere in the chain:
 *
 *   1. `ALTER TABLE <t> FORCE ROW LEVEL SECURITY`   (force, not just enable)
 *   2. at least one `CREATE POLICY ... ON <t>`       (a real scoping policy)
 *
 * minus a small, EXPLICIT, checked-in exemption allowlist (global/lookup
 * tables that legitimately carry a tenant column but are not tenant-isolated).
 *
 * This is the regression backstop for the cross-tenant breach migration 0331
 * closed: `users`, `organizations`, and `owner_skills` shipped with ZERO RLS.
 * The test FAILS the build if any of them — or any FUTURE tenant table — lacks
 * FORCE RLS + a policy. It runs WITHOUT a database (pure SQL parsing) so it is
 * a fast, deterministic, BLOCKING CI check; the live migration-apply CI proves
 * the policies actually function against Postgres.
 *
 * Why a static analyzer (not a live pg_class query)?
 *   - It runs in the unit-test lane with no Postgres dependency, so a missing
 *     FORCE RLS is caught on every PR, not only in the slower migration-apply
 *     job. The two are complementary: this proves the migration TEXT is
 *     correct; migration-apply proves the RESULTING schema is correct.
 *
 * Owner: Mr. Mwikila (security backstop).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..', '..');
const BASELINE_DIR = join(PKG_ROOT, 'drizzle');
const DELTA_DIR = join(PKG_ROOT, 'src', 'migrations');

/**
 * KNOWN DEBT — tables that genuinely have NO row-level security at all (no
 * ENABLE, no FORCE, no policy) despite declaring a tenant-scoping column.
 * These were the SAME high-severity breach class that migration 0331 closed
 * for users/organizations/owner_skills.
 *
 * CLOSED by migration 0333 (`0333_rls_residual_no_rls_closure.sql`) — all nine
 * now have ENABLE + FORCE + a tenant_isolation policy keyed on each table's
 * ACTUAL tenant column, plus a service_role_bypass policy and a guarded anon
 * REVOKE (mirroring 0331's shape exactly). Per-table closure:
 *   - person_links            tenant_id UUID NOT NULL — scoped by tenant_id
 *                             (NULLIF cast); the me-tenants hat-switching rail's
 *                             cross-tenant reads run under withServiceRoleContext
 *                             so the bypass policy keeps multi-hat working.
 *   - personal_memory_cells   source_tenant_id UUID NULL — nullable-UUID
 *                             predicate (IS NULL OR = NULLIF(guc)::uuid) keeps
 *                             federated/global cells visible.
 *   - org_memberships         platform_tenant_id text NOT NULL — TEXT compare.
 *   - invite_codes            platform_tenant_id text NOT NULL — TEXT compare.
 *   - cross_tenant_denials    caller_tenant_id text NOT NULL — TEXT compare
 *                             (owner reads only their own denial history;
 *                             recorder inserts cross-tenant under service-role).
 *   - daily_revival_counters  tenant_id text NULL — nullable-TEXT predicate
 *                             (NULL = platform-wide aggregate stays visible).
 *   - wave_progress           tenant_id text NULL — nullable-TEXT predicate.
 *   - learning_observations   tenant_id text NULL — nullable-TEXT predicate.
 *   - ab_experiments          tenant_id text NULL — nullable-TEXT predicate
 *                             (NULL = fleet-wide experiment stays visible).
 *
 * The test asserts the live no-RLS set EXACTLY equals this registry, so it is
 * now EMPTY: any NEW unprotected tenant table fails the build (it must get its
 * own append-only migration, never an entry here).
 */
const RLS_NO_RLS_KNOWN_DEBT: ReadonlySet<string> = new Set<string>([]);

/**
 * KNOWN DEBT — tables that DO have RLS ENABLEd + a tenant_isolation policy but
 * were missing the `FORCE` bit (so the table-OWNER role bypassed RLS; ordinary
 * roles were still scoped by the policy). This violated the CLAUDE.md
 * "RLS is FORCE-enabled" hard rule. Mostly applied by early dynamic ENABLE-loops
 * (e.g. drizzle/0005) that predate the FORCE convention.
 *
 * CLOSED by migration 0334 (`0334_rls_residual_force_sweep.sql`) — a purely
 * mechanical, idempotent `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` sweep over
 * all 57 (NO policy changes; each already carries its own tenant_isolation
 * policy). The test asserts the live enable-only set EXACTLY equals this
 * registry, so it is now EMPTY: any NEW enable-only table fails the build.
 */
const RLS_ENABLE_ONLY_KNOWN_DEBT: ReadonlySet<string> = new Set<string>([]);

/** The three tables this task closed — must have FORCE + policy, never debt. */
const RLS_BREACH_CLOSED = ['users', 'organizations', 'owner_skills'] as const;

/**
 * GLOBAL CROSS-TENANT SPINE TABLES — the bridges that are intentionally NOT
 * scoped by any `tenant_id` column because they ARE the cross-tenant graph
 * (the sub↔identity map; the phone-keyed person registry). They carry NO
 * tenant column, so the `findTenantScopedTables` scanner above is BLIND to
 * them — meaning a future migration that silently drops their FORCE RLS or
 * service-role-only policy would pass the coverage guard unnoticed. This
 * registry pins them: each MUST keep FORCE RLS + at least one policy forever
 * (and, by code-review invariant, that policy is service-role-only — the
 * static analyzer can confirm FORCE+policy-present but cannot prove the
 * policy TYPE, so the service-role-only shape stays a reviewed invariant).
 *
 * Introduced by:
 *   - migration 0345: identity_auth_principals (Supabase sub ↔ tenant_identity)
 *   - earlier      : tenant_identities (phone-keyed cross-org principal)
 */
const GLOBAL_SPINE_TABLES = [
  'identity_auth_principals',
  'tenant_identities',
] as const;

/** A tenant-scoping column is `tenant_id` or any `<prefix>_tenant_id`. */
const TENANT_COL_RE = /(?:^|\b)([a-z_]*tenant_id)\b/;

/**
 * Read every `.sql` file from baseline + delta dirs, concatenated with a
 * delimiter. Order does not matter — we look for the EXISTENCE of statements
 * across the whole chain, not their sequence.
 */
function readAllMigrationSql(): string {
  const files: string[] = [];
  for (const dir of [BASELINE_DIR, DELTA_DIR]) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- build-time constant dirs
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.sql')) files.push(join(dir, name));
    }
  }
  return files
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- enumerated above
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n;-- FILE BOUNDARY --;\n');
}

/** Normalise an identifier token: strip quotes + an optional `public.` prefix. */
function normalizeIdent(raw: string): string {
  return raw
    .trim()
    .replace(/^public\./i, '')
    .replace(/["`]/g, '')
    .toLowerCase();
}

/**
 * Find every table that declares a tenant-scoping column. We scan each
 * `CREATE TABLE [IF NOT EXISTS] <name> ( ... )` block and test its body for a
 * `*tenant_id` column declaration.
 */
function findTenantScopedTables(sql: string): ReadonlySet<string> {
  const tenantTables = new Set<string>();
  // Match the table name + the parenthesised body (non-greedy up to the first
  // `);` that closes the CREATE TABLE — sufficient for these flat DDL bodies).
  const createRe =
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+("?[a-zA-Z0-9_."]+"?)\s*\(([\s\S]*?)\)\s*;/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(sql)) !== null) {
    const tableName = normalizeIdent(m[1] ?? '');
    const body = m[2] ?? '';
    // A column line that declares a tenant key. We require it to look like a
    // COLUMN (token followed by a type), not an index name or FK reference, by
    // checking the token sits at a line/comma boundary followed by a type-ish
    // word. The simple `*tenant_id` token test below is conservative — index
    // and FK clauses inside CREATE TABLE bodies for these tables also mention
    // tenant_id, but a false-positive only ever ADDS a table to the
    // must-have-RLS set, which is the safe direction.
    if (declaresTenantColumn(body)) {
      tenantTables.add(tableName);
    }
  }
  return tenantTables;
}

/**
 * True when a CREATE TABLE body declares a `*tenant_id` COLUMN. We look for a
 * line whose first token is a `*tenant_id` identifier (optionally quoted)
 * followed by a type — this distinguishes a column declaration from an
 * `index(... tenant_id ...)` or `REFERENCES tenants(id)` mention.
 */
function declaresTenantColumn(body: string): boolean {
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim().replace(/^,/, '').trim();
    // First token of the line.
    const firstTokMatch = /^("?[a-z_]+"?)\s+\S/.exec(trimmed);
    if (!firstTokMatch) continue;
    const firstTok = normalizeIdent(firstTokMatch[1] ?? '');
    if (TENANT_COL_RE.test(firstTok)) return true;
  }
  return false;
}

/**
 * Build the set of tables that have `FORCE ROW LEVEL SECURITY` somewhere in
 * the chain. Handles BOTH the literal form
 *   `ALTER TABLE <t> FORCE ROW LEVEL SECURITY`
 * AND the dynamic DO-block form used by 0330/0331:
 *   `format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl)` driven by a
 *   `tenant_tables text[] := ARRAY['a','b']` / single-table DO block.
 *
 * For the dynamic form we cannot evaluate the plpgsql, so we extract every
 * string literal inside an `ARRAY[ ... ]` that feeds a FORCE statement, plus
 * any single-table DO block that ALTERs a literal table name. To keep this
 * robust and avoid under-counting, we ALSO collect every quoted/unquoted table
 * literal that appears in the same file as a `FORCE ROW LEVEL SECURITY` token
 * AND is named in an `ALTER TABLE ... FORCE` or an `ARRAY[...]` adjacent to one.
 */
function findForcedTables(sql: string): ReadonlySet<string> {
  const forced = new Set<string>();

  // 1. Literal `ALTER TABLE <name> FORCE ROW LEVEL SECURITY`.
  const literalRe =
    /ALTER TABLE\s+("?[a-zA-Z0-9_."]+"?)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(sql)) !== null) {
    forced.add(normalizeIdent(m[1] ?? ''));
  }

  // 2. Dynamic form: a DO block that does `format('ALTER TABLE %I FORCE ...')`
  //    over a `tenant_tables ... := ARRAY[ '<a>', '<b>', ... ]`. We scan each
  //    DO $$ ... $$ block; if it contains a FORCE + a %I ALTER, we harvest
  //    every single-quoted literal from its ARRAY[...] declarations.
  const doBlockRe = /DO\s+\$\$([\s\S]*?)\$\$/gi;
  while ((m = doBlockRe.exec(sql)) !== null) {
    const block = m[1] ?? '';
    if (!/FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(block)) continue;
    // Harvest ARRAY[...] string literals.
    const arrayRe = /ARRAY\s*\[([\s\S]*?)\]/gi;
    let a: RegExpExecArray | null;
    while ((a = arrayRe.exec(block)) !== null) {
      const inner = a[1] ?? '';
      const litRe = /'([a-zA-Z0-9_]+)'/g;
      let lit: RegExpExecArray | null;
      while ((lit = litRe.exec(inner)) !== null) {
        forced.add(normalizeIdent(lit[1] ?? ''));
      }
    }
    // Single-table dynamic blocks: `EXECUTE format('ALTER TABLE %I FORCE ...',
    // 'name')` or a direct `ALTER TABLE name FORCE` inside the DO block.
    const inBlockLiteral =
      /ALTER TABLE\s+("?[a-zA-Z0-9_."]+"?)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi;
    let b: RegExpExecArray | null;
    while ((b = inBlockLiteral.exec(block)) !== null) {
      const ident = normalizeIdent(b[1] ?? '');
      // Skip the plpgsql placeholder `%i`.
      if (ident && ident !== '%i') forced.add(ident);
    }
  }

  return forced;
}

/**
 * Tables that have `ENABLE ROW LEVEL SECURITY` (force OR plain enable) anywhere
 * in the chain — literal or dynamic ARRAY-driven. `FORCE` implies `ENABLE`, so
 * this is the superset. Used to distinguish "no RLS at all" (the true breach
 * class) from "ENABLE-only, missing FORCE" (a lesser, catalogued debt).
 */
function findEnabledTables(sql: string): ReadonlySet<string> {
  const enabled = new Set<string>();
  const literalRe =
    /ALTER TABLE\s+("?[a-zA-Z0-9_."]+"?)\s+(?:FORCE\s+|NO\s+FORCE\s+)?(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(sql)) !== null) {
    enabled.add(normalizeIdent(m[1] ?? ''));
  }
  // Dynamic DO blocks that ENABLE or FORCE over ARRAY literals.
  const doBlockRe = /DO\s+\$\$([\s\S]*?)\$\$/gi;
  while ((m = doBlockRe.exec(sql)) !== null) {
    const block = m[1] ?? '';
    if (!/(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/i.test(block)) continue;
    const arrayRe = /ARRAY\s*\[([\s\S]*?)\]/gi;
    let a: RegExpExecArray | null;
    while ((a = arrayRe.exec(block)) !== null) {
      const inner = a[1] ?? '';
      const litRe = /'([a-zA-Z0-9_]+)'/g;
      let lit: RegExpExecArray | null;
      while ((lit = litRe.exec(inner)) !== null) {
        enabled.add(normalizeIdent(lit[1] ?? ''));
      }
    }
    const inBlockLiteral =
      /ALTER TABLE\s+("?[a-zA-Z0-9_."]+"?)\s+(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi;
    let b: RegExpExecArray | null;
    while ((b = inBlockLiteral.exec(block)) !== null) {
      const ident = normalizeIdent(b[1] ?? '');
      if (ident && ident !== '%i') enabled.add(ident);
    }
  }
  return enabled;
}

/**
 * Tables that have at least one `CREATE POLICY ... ON <name>` in the chain —
 * literal or `format('CREATE POLICY ... ON %I ...', tbl)` driven by an ARRAY
 * of literals (same dynamic shape as the FORCE harvester).
 */
function findTablesWithPolicy(sql: string): ReadonlySet<string> {
  const withPolicy = new Set<string>();

  const literalRe =
    /CREATE POLICY\s+(?:IF NOT EXISTS\s+)?[a-zA-Z0-9_"]+\s+ON\s+("?[a-zA-Z0-9_."]+"?)/gi;
  let m: RegExpExecArray | null;
  while ((m = literalRe.exec(sql)) !== null) {
    withPolicy.add(normalizeIdent(m[1] ?? ''));
  }

  // Dynamic DO-block CREATE POLICY over ARRAY[...] literals.
  const doBlockRe = /DO\s+\$\$([\s\S]*?)\$\$/gi;
  while ((m = doBlockRe.exec(sql)) !== null) {
    const block = m[1] ?? '';
    if (!/CREATE POLICY/i.test(block)) continue;
    const arrayRe = /ARRAY\s*\[([\s\S]*?)\]/gi;
    let a: RegExpExecArray | null;
    while ((a = arrayRe.exec(block)) !== null) {
      const inner = a[1] ?? '';
      const litRe = /'([a-zA-Z0-9_]+)'/g;
      let lit: RegExpExecArray | null;
      while ((lit = litRe.exec(inner)) !== null) {
        withPolicy.add(normalizeIdent(lit[1] ?? ''));
      }
    }
  }

  return withPolicy;
}

describe('RLS coverage guard (every tenant table is FORCE-RLS + policied)', () => {
  const sql = readAllMigrationSql();
  const tenantTables = findTenantScopedTables(sql);
  const forced = findForcedTables(sql);
  const enabled = findEnabledTables(sql);
  const policied = findTablesWithPolicy(sql);

  // Live buckets, computed once from the migration chain.
  const liveNoRls: string[] = [];
  const liveEnableOnly: string[] = [];
  for (const t of [...tenantTables].sort()) {
    if ((RLS_BREACH_CLOSED as readonly string[]).includes(t)) continue;
    if (!enabled.has(t) && !policied.has(t)) liveNoRls.push(t);
    else if (!forced.has(t)) liveEnableOnly.push(t);
  }

  it('parses a non-trivial migration corpus', () => {
    expect(sql.length).toBeGreaterThan(10_000);
    expect(tenantTables.size).toBeGreaterThan(20);
  });

  it('the three breach tables are recognised as tenant-scoped', () => {
    // Regression anchor: if any of these stops being detected as
    // tenant-scoped (e.g. a schema rename), the coverage check below would
    // silently stop guarding it. Pin them explicitly.
    for (const t of RLS_BREACH_CLOSED) {
      expect(tenantTables.has(t)).toBe(true);
    }
  });

  // ─── THE breach-closure proof obligation ───────────────────────────────────
  it('users / organizations / owner_skills have FORCE RLS + a policy (BREACH CLOSED)', () => {
    for (const t of RLS_BREACH_CLOSED) {
      expect(
        forced.has(t),
        `${t} is missing FORCE ROW LEVEL SECURITY — migration 0331 must add it`,
      ).toBe(true);
      expect(
        policied.has(t),
        `${t} is missing a CREATE POLICY — migration 0331 must add it`,
      ).toBe(true);
    }
  });

  it('none of the three breach tables are listed as known debt', () => {
    for (const t of RLS_BREACH_CLOSED) {
      expect(RLS_NO_RLS_KNOWN_DEBT.has(t)).toBe(false);
      expect(RLS_ENABLE_ONLY_KNOWN_DEBT.has(t)).toBe(false);
    }
  });

  // ─── Global spine tables: FORCE RLS + a policy, forever (hardening X-1) ──────
  it('global cross-tenant spine tables keep FORCE RLS + a policy (service-role-only)', () => {
    for (const t of GLOBAL_SPINE_TABLES) {
      expect(
        forced.has(t),
        `${t} (global spine) is missing FORCE ROW LEVEL SECURITY — it must ` +
          `stay service-role-only; a migration dropping it is a cross-tenant ` +
          `exposure of the identity graph`,
      ).toBe(true);
      expect(
        policied.has(t),
        `${t} (global spine) is missing a CREATE POLICY — it must keep its ` +
          `service_role_bypass policy`,
      ).toBe(true);
      // These are NOT tenant-scoped debt — they carry no tenant column.
      expect(RLS_NO_RLS_KNOWN_DEBT.has(t)).toBe(false);
    }
  });

  // ─── Blocking drift guard: the no-RLS set must EXACTLY match the registry ───
  it('NO NEW table may ship without RLS (no-RLS set == known-debt registry)', () => {
    const live = new Set(liveNoRls);
    const newlyUnprotected = liveNoRls.filter((t) => !RLS_NO_RLS_KNOWN_DEBT.has(t));
    const nowFixed = [...RLS_NO_RLS_KNOWN_DEBT].filter((t) => !live.has(t));

    if (newlyUnprotected.length > 0) {
      throw new Error(
        `CROSS-TENANT BREACH RISK — NEW tenant-scoped table(s) with ZERO RLS:\n` +
          newlyUnprotected.sort().map((t) => `  ${t}`).join('\n') +
          `\n\nEach declares a *tenant_id column but has NO ENABLE/FORCE/policy. ` +
          `Add an append-only migration (mirror 0331) that ENABLEs + FORCEs RLS ` +
          `and CREATEs a tenant-isolation policy. Do NOT add it to the debt ` +
          `registry to silence this — that registry is for PRE-EXISTING debt only.`,
      );
    }
    if (nowFixed.length > 0) {
      throw new Error(
        `Good news / stale registry — these tables now HAVE RLS but are still in ` +
          `RLS_NO_RLS_KNOWN_DEBT:\n` +
          nowFixed.sort().map((t) => `  ${t}`).join('\n') +
          `\n\nRemove them from the registry so the guard keeps tracking the ` +
          `true residual surface.`,
      );
    }
    expect(newlyUnprotected).toEqual([]);
    expect(nowFixed).toEqual([]);
  });

  // ─── Blocking drift guard: enable-only set must EXACTLY match the registry ──
  it('NO NEW enable-only table may ship (enable-only set == known-debt registry)', () => {
    const live = new Set(liveEnableOnly);
    const newlyEnableOnly = liveEnableOnly.filter(
      (t) => !RLS_ENABLE_ONLY_KNOWN_DEBT.has(t),
    );
    const nowForced = [...RLS_ENABLE_ONLY_KNOWN_DEBT].filter((t) => !live.has(t));

    if (newlyEnableOnly.length > 0) {
      throw new Error(
        `FORCE-RLS hard-rule violation — NEW table(s) with ENABLE-only RLS ` +
          `(table owner bypasses isolation):\n` +
          newlyEnableOnly.sort().map((t) => `  ${t}`).join('\n') +
          `\n\nAdd \`ALTER TABLE <t> FORCE ROW LEVEL SECURITY\` in an append-only ` +
          `migration. Do NOT add to the debt registry to silence this.`,
      );
    }
    if (nowForced.length > 0) {
      throw new Error(
        `Stale registry — these tables now have FORCE RLS but remain in ` +
          `RLS_ENABLE_ONLY_KNOWN_DEBT:\n` +
          nowForced.sort().map((t) => `  ${t}`).join('\n') +
          `\n\nRemove them from the registry.`,
      );
    }
    expect(newlyEnableOnly).toEqual([]);
    expect(nowForced).toEqual([]);
  });

  it('debt registries only name real tenant-scoped tables (no stale entries)', () => {
    for (const t of [...RLS_NO_RLS_KNOWN_DEBT, ...RLS_ENABLE_ONLY_KNOWN_DEBT]) {
      expect(
        tenantTables.has(t),
        `'${t}' is in a debt registry but is not a detected tenant-scoped table — remove the stale entry`,
      ).toBe(true);
    }
  });
});
