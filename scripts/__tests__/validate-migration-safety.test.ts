/**
 * validate-migration-safety tests — dynamic-SQL detector.
 *
 * Closes audit finding: "NOT NULL validator EXECUTE bypass". The static
 * SQL parser previously could not see inside PL/pgSQL `DO $$ ... $$`
 * blocks, so an unsafe `EXECUTE format('ALTER TABLE %I ALTER COLUMN
 * %I SET NOT NULL', ...)` slipped through as PASS.
 *
 * Coverage:
 *   1. Synthetic MALICIOUS migration with `DO $$ EXECUTE ... NOT NULL`
 *      and no allowlist marker — validator's pure detector returns a
 *      finding (i.e. the unit-level guarantee that the rule fires).
 *   2. Same migration WITH the `-- @safety: dynamic-not-null-reviewed`
 *      marker is detected at the SQL level but the allowlist parser
 *      reports allowlisted.
 *   3. Predicate-only migration (`WHERE col IS NOT NULL`) does NOT
 *      false-positive — partial-index creation via EXECUTE is safe.
 *   4. Migration 0167-style file (`DO $$` with EXECUTE for renames,
 *      no NOT NULL inside the block) does NOT fire — the rule is
 *      scoped to constraint NOT NULL.
 *   5. End-to-end: running the validator binary against a tmpdir
 *      containing the malicious migration exits 1 with --fail-on=fail.
 *
 * The tests run the script's pure helpers via dynamic import. The
 * binary path test shells out to `node` so we exercise the same code
 * path operators see in CI.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Import the pure helpers from the .mjs script via the file-URL form
// vitest already supports for ESM. We only consume the exported pure
// functions — main() reads CLI args and exits, so we never call it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const validator: any = await import(
  '../validate-migration-safety.mjs' as unknown as string
);

const SCRIPT_PATH = resolve(
  __dirname,
  '..',
  'validate-migration-safety.mjs',
);

// ---------------------------------------------------------------------------
// Synthetic migration fixtures
// ---------------------------------------------------------------------------

const MALICIOUS_DYNAMIC_NOT_NULL = `
-- Synthetic malicious migration — hides a NOT NULL inside a DO block
-- via EXECUTE format(...). The static ALTER TABLE parser cannot see
-- this; the dynamic detector must.

DO $$
DECLARE
  tbl text := 'invoices';
  col text := 'reviewed_by';
BEGIN
  EXECUTE format(
    'ALTER TABLE public.%I ALTER COLUMN %I SET NOT NULL',
    tbl,
    col
  );
END $$;
`;

const MALICIOUS_DYNAMIC_NOT_NULL_ALLOWLISTED = `
-- Synthetic migration intentionally adds NOT NULL via dynamic SQL.
-- Author has reviewed and added the explicit allowlist marker.
-- @safety: dynamic-not-null-reviewed
-- Justification: target table is empty at deploy time (see release-1234.md).

DO $$
DECLARE
  tbl text := 'fresh_audit_log';
BEGIN
  EXECUTE format(
    'ALTER TABLE public.%I ALTER COLUMN created_at SET NOT NULL',
    tbl
  );
END $$;
`;

const PARTIAL_INDEX_PREDICATE_ONLY = `
-- Partial-index creation in a DO block. The string "NOT NULL" only
-- appears as part of "IS NOT NULL" predicates, which is safe.

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_email_partial'
  ) THEN
    EXECUTE 'CREATE INDEX idx_users_email_partial
             ON public.users (email)
             WHERE email IS NOT NULL AND deleted_at IS NOT NULL';
  END IF;
END $$;
`;

const RENAME_ONLY_DO_BLOCK = `
-- Migration 0167 idiom — DO block does conditional column renames
-- via EXECUTE. No NOT NULL inside the DO block; the rule must not
-- fire here.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='accounts' AND column_name='balance'
  ) THEN
    EXECUTE 'ALTER TABLE public.accounts RENAME COLUMN balance TO balance_minor_units';
  END IF;
END $$;

-- A later top-level ALTER may add a NOT NULL with DEFAULT — that is
-- the static parser's job, not the dynamic detector's.
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS entry_count integer NOT NULL DEFAULT 0;
`;

// ---------------------------------------------------------------------------
// Unit-level tests on the pure detector helpers
// ---------------------------------------------------------------------------

describe('validate-migration-safety / dynamic NOT NULL detector', () => {
  it('fires on EXECUTE + constraint NOT NULL inside a DO block', () => {
    const findings = validator.findDynamicNotNullStatements(
      MALICIOUS_DYNAMIC_NOT_NULL,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('do_block_execute_not_null');
    expect(findings[0].snippet).toMatch(/EXECUTE/i);
    expect(findings[0].snippet).toMatch(/NOT NULL/i);
  });

  it('does NOT false-positive on IS NOT NULL predicate', () => {
    const findings = validator.findDynamicNotNullStatements(
      PARTIAL_INDEX_PREDICATE_ONLY,
    );
    // Partial-index WHERE col IS NOT NULL is safe — must not trip.
    expect(findings).toHaveLength(0);
  });

  it('does NOT fire on rename-only DO blocks (migration 0167 idiom)', () => {
    const findings = validator.findDynamicNotNullStatements(
      RENAME_ONLY_DO_BLOCK,
    );
    expect(findings).toHaveLength(0);
  });

  it('detects the explicit allowlist marker', () => {
    expect(
      validator.hasDynamicNotNullAllowlist(MALICIOUS_DYNAMIC_NOT_NULL),
    ).toBe(false);
    expect(
      validator.hasDynamicNotNullAllowlist(
        MALICIOUS_DYNAMIC_NOT_NULL_ALLOWLISTED,
      ),
    ).toBe(true);
  });

  it('distinguishes constraint NOT NULL from predicate IS NOT NULL', () => {
    expect(
      validator.hasConstraintShapedNotNull(
        'EXECUTE format(\'ALTER TABLE %I ALTER COLUMN x SET NOT NULL\', tbl)',
      ),
    ).toBe(true);
    expect(
      validator.hasConstraintShapedNotNull(
        "CREATE INDEX idx ON t (col) WHERE col IS NOT NULL",
      ),
    ).toBe(false);
    expect(
      validator.hasConstraintShapedNotNull(
        // Mixed — one of each; constraint must win.
        "WHERE x IS NOT NULL; ALTER COLUMN y SET NOT NULL",
      ),
    ).toBe(true);
  });

  it('findDoBlocks captures every DO $$ ... $$ block', () => {
    const blocks = validator.findDoBlocks(
      'DO $$ BEGIN SELECT 1; END $$; DO $$ BEGIN SELECT 2; END $$;',
    );
    expect(blocks).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// End-to-end — run the script binary against a tmp migrations dir
// ---------------------------------------------------------------------------

describe('validate-migration-safety / binary integration', () => {
  it('exits 1 with --fail-on=fail when malicious migration is present', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'migration-safety-'));
    await writeFile(
      join(dir, '9999_malicious_dynamic_not_null.sql'),
      MALICIOUS_DYNAMIC_NOT_NULL,
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        `--migrations-dir=${dir}`,
        '--fail-on=fail',
        '--output=json',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/DYNAMIC_UNSAFE/);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.summary.fail).toBeGreaterThanOrEqual(1);
  });

  it('exits 0 when the malicious migration declares the allowlist marker', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'migration-safety-'));
    await writeFile(
      join(dir, '9999_allowlisted_dynamic_not_null.sql'),
      MALICIOUS_DYNAMIC_NOT_NULL_ALLOWLISTED,
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        `--migrations-dir=${dir}`,
        '--fail-on=fail',
        '--output=json',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.summary.fail).toBe(0);
    expect(parsed.summary.pass).toBeGreaterThanOrEqual(1);
  });

  it('exits 0 on partial-index DO block (no false positive)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'migration-safety-'));
    await writeFile(
      join(dir, '9999_partial_index_predicate_only.sql'),
      PARTIAL_INDEX_PREDICATE_ONLY,
      'utf8',
    );

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        `--migrations-dir=${dir}`,
        '--fail-on=fail',
        '--output=json',
      ],
      { encoding: 'utf8' },
    );

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.summary.fail).toBe(0);
  });
});
