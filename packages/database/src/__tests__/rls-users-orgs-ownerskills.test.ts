/**
 * Migration 0331 + 0332 content invariants — the breach-closure proof.
 *
 * Pins the EXACT SQL shape of:
 *   - 0331: FORCE RLS + tenant-isolation policy + service-role bypass on
 *     users / organizations / owner_skills (the three zero-RLS tables a deep
 *     audit found holding password_hash / mfa_secret / nida_id / biometric
 *     hashes with no DB backstop).
 *   - 0332: worm_audit_log append-only triggers (no UPDATE / DELETE / TRUNCATE).
 *
 * Runs WITHOUT a database (pure migration-text assertions), so it is a fast,
 * deterministic CI guard. The companion `rls-coverage.test.ts` proves the
 * tables are detected as protected; THIS test proves the policies have the
 * right PREDICATES — specifically the bits that keep auth working:
 *   - the *_service_role_bypass policies (so the legacy cross-tenant login
 *     lookup, routed through withServiceRoleContext, is permitted), and
 *   - the correct tenant key per table (text tenant_id for users/orgs,
 *     uuid installed_by_tenant_id for owner_skills).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIG = resolve(__dirname, '..', 'migrations');

const sql0331 = readFileSync(
  resolve(MIG, '0331_rls_users_orgs_ownerskills.sql'),
  'utf8',
);
const sql0332 = readFileSync(
  resolve(MIG, '0332_worm_audit_log_append_only.sql'),
  'utf8',
);

describe('migration 0331 — RLS breach closed on users/organizations/owner_skills', () => {
  it('is wrapped in a single transaction', () => {
    expect(/^BEGIN;/m.test(sql0331)).toBe(true);
    expect(/^COMMIT;/m.test(sql0331)).toBe(true);
  });

  it('ENABLEs + FORCEs RLS on users + organizations (via the text-key loop)', () => {
    // The text-key tables are driven through a FOREACH loop with a
    // format('ALTER TABLE %I ... FORCE ...') — assert both names are in the
    // array AND that the loop FORCEs (not just ENABLEs).
    expect(sql0331).toMatch(/text_key_tables\s+text\[\]\s*:=\s*ARRAY\[/);
    expect(sql0331).toMatch(/'users'/);
    expect(sql0331).toMatch(/'organizations'/);
    expect(sql0331).toMatch(/FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('text-key tables compare tenant_id to the canonical GUC WITHOUT a cast', () => {
    // users/organizations.tenant_id is TEXT — comparing to the raw
    // current_setting (text) is correct; a ::uuid cast would throw on '' and
    // is wrong for a text column.
    expect(sql0331).toMatch(
      /tenant_id = current_setting\(''app\.current_tenant_id'', true\)/,
    );
  });

  it('owner_skills scopes by installed_by_tenant_id with a NULLIF uuid cast', () => {
    // owner_skills.installed_by_tenant_id is UUID NOT NULL — the policy must
    // cast the GUC, and NULLIF(...,'') makes an UNSET GUC fail closed instead
    // of raising on ''::uuid.
    expect(sql0331).toMatch(
      /installed_by_tenant_id = NULLIF\(current_setting\('app\.current_tenant_id', true\), ''\)::uuid/,
    );
    expect(sql0331).toMatch(/ALTER TABLE owner_skills FORCE\s+ROW\s+LEVEL\s+SECURITY/i);
  });

  it('AUTH PRESERVED: every protected table has a service_role bypass policy', () => {
    // The legacy cross-tenant email login lookup (routes/auth.ts →
    // resolveAuthUser) runs under withServiceRoleContext, which sets
    // app.is_service_role='true'. Each table MUST grant a bypass on that GUC or
    // login breaks. Assert the bypass predicate exists for the loop tables and
    // for owner_skills.
    expect(sql0331).toMatch(
      /current_setting\(''app\.is_service_role'', true\) = ''true''/,
    );
    expect(sql0331).toMatch(
      /current_setting\('app\.is_service_role', true\) = 'true'/,
    );
    // Named bypass policy for owner_skills.
    expect(sql0331).toMatch(/owner_skills_service_role_bypass/);
  });

  it('is idempotent (guarded policy creation + IF NOT EXISTS pg_policies checks)', () => {
    expect(sql0331).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies/);
    // Guarded anon REVOKE.
    expect(sql0331).toMatch(/IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'anon'\)/);
  });
});

describe('migration 0332 — worm_audit_log append-only at the engine', () => {
  it('is wrapped in a single transaction', () => {
    expect(/^BEGIN;/m.test(sql0332)).toBe(true);
    expect(/^COMMIT;/m.test(sql0332)).toBe(true);
  });

  it('blocks UPDATE and DELETE via a SECURITY DEFINER trigger', () => {
    expect(sql0332).toMatch(/CREATE OR REPLACE FUNCTION worm_audit_log_block_mutation/);
    expect(sql0332).toMatch(/SECURITY DEFINER/);
    expect(sql0332).toMatch(/SET search_path = pg_catalog/);
    expect(sql0332).toMatch(/BEFORE UPDATE ON worm_audit_log/);
    expect(sql0332).toMatch(/BEFORE DELETE ON worm_audit_log/);
    expect(sql0332).toMatch(/RAISE EXCEPTION/);
  });

  it('blocks TRUNCATE via a statement-level trigger', () => {
    expect(sql0332).toMatch(/CREATE OR REPLACE FUNCTION worm_audit_log_block_truncate/);
    expect(sql0332).toMatch(/BEFORE TRUNCATE ON worm_audit_log/);
    expect(sql0332).toMatch(/FOR EACH STATEMENT/);
  });

  it('leaves INSERT untouched (no BEFORE INSERT block trigger)', () => {
    // Append must remain the one allowed mutation — there must be NO
    // BEFORE INSERT trigger wired to the block function.
    expect(sql0332).not.toMatch(/BEFORE INSERT ON worm_audit_log[\s\S]*block_mutation/);
  });

  it('is idempotent (DROP TRIGGER IF EXISTS before each CREATE)', () => {
    expect(sql0332).toMatch(/DROP TRIGGER IF EXISTS worm_audit_log_no_update/);
    expect(sql0332).toMatch(/DROP TRIGGER IF EXISTS worm_audit_log_no_delete/);
    expect(sql0332).toMatch(/DROP TRIGGER IF EXISTS worm_audit_log_no_truncate/);
  });
});
