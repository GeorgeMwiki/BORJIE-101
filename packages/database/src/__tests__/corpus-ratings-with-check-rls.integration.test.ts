/**
 * 0310 — corpus / ratings cross-tenant data-poisoning RLS hole — REAL Postgres.
 *
 * THE HOLE this migration closes
 * ──────────────────────────────
 * `intelligence_corpus_chunks` and `ratings` each carried ONE permissive
 * policy `tenant_or_global`:
 *
 *     USING (tenant_id IS NULL
 *            OR tenant_id = current_setting('app.current_tenant_id', true))
 *
 * with NO `WITH CHECK`. Under FORCE ROW LEVEL SECURITY Postgres falls back to
 * the `USING` expression for the write-side check when `WITH CHECK` is absent,
 * and `tenant_id IS NULL` makes that predicate TRUE — so ANY tenant-scoped
 * session could INSERT (or UPDATE-to) a `tenant_id = NULL` row, writing into the
 * GLOBAL, every-tenant-readable ground-truth corpus / ratings pool. That
 * violates the "cross-tenant corpus tenant_id=NULL ground-truth safety" hard
 * rule (CLAUDE.md).
 *
 * Migration 0310 replaces the single read+write policy on each table with a
 * SELECT read policy (unchanged semantics: own + global rows are visible), an
 * INSERT/UPDATE write policy whose `WITH CHECK` requires
 * `tenant_id IS NOT NULL AND tenant_id = <GUC>` (so a tenant can only write its
 * OWN rows, never global), and a service-role bypass keyed on the
 * `app.is_service_role` GUC so the legitimate global ingest path
 * (withServiceRoleContext) still writes `tenant_id = NULL` rows. (The
 * first-boot corpus-ingest worker connects via the Supabase `service_role`
 * BYPASSRLS role, which is unaffected by RLS entirely — the bypass policy is
 * defense-in-depth for any future non-BYPASSRLS service path.)
 *
 * What this test PROVES against a throwaway non-superuser (NOBYPASSRLS) role
 * (so FORCE RLS actually binds — superusers/BYPASSRLS would silently false-pass):
 *   1. A tenant session INSERTing tenant_id=NULL is REJECTED (both tables).
 *   2. A tenant session INSERTing ANOTHER tenant's id is REJECTED.
 *   3. A tenant session INSERTing its OWN tenant_id SUCCEEDS.
 *   4. A tenant session UPDATEing its own row to tenant_id=NULL is REJECTED.
 *   5. A service-role session (app.is_service_role='true') INSERTing
 *      tenant_id=NULL global rows SUCCEEDS — the global ingest still works.
 *   6. A tenant session still READS the global (tenant_id=NULL) rows.
 *   7. The migration is idempotent (re-apply is a clean no-op).
 *
 * Skips cleanly when `initdb`/`pg_ctl` are absent (CI images without Postgres
 * tooling) — the companion static assertion below always runs.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';

import {
  postgresToolingAvailable,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from './helpers/ephemeral-postgres.js';
import { stripWrappingTransaction } from '../run-migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');
const MIG_0310 = '0310_corpus_ratings_with_check.sql';

/**
 * Minimal baseline for the two tables + the PRE-FIX holey `tenant_or_global`
 * policy (exactly what 0297 leaves behind). 0310 drops it and installs the
 * split read/write/service-role policies.
 */
const BASELINE = `
  CREATE TABLE tenants (id text PRIMARY KEY);
  INSERT INTO tenants(id) VALUES ('tenantA'), ('tenantB');

  CREATE TABLE intelligence_corpus_chunks (
    id          text PRIMARY KEY,
    tenant_id   text REFERENCES tenants(id) ON DELETE CASCADE,
    source_file text NOT NULL,
    section     text,
    text        text NOT NULL,
    ingested_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE ratings (
    id           text PRIMARY KEY,
    tenant_id    text REFERENCES tenants(id) ON DELETE CASCADE,
    subject_id   text NOT NULL,
    subject_kind text NOT NULL,
    score        smallint NOT NULL
  );

  ALTER TABLE intelligence_corpus_chunks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE intelligence_corpus_chunks FORCE  ROW LEVEL SECURITY;
  CREATE POLICY tenant_or_global ON intelligence_corpus_chunks
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true));

  ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ratings FORCE  ROW LEVEL SECURITY;
  CREATE POLICY tenant_or_global ON ratings
    USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true));
`;

async function migrationBody(file: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed in-tree migration file
  const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
  return stripWrappingTransaction(content);
}

// ---------------------------------------------------------------------------
// Static assertion — always runs, even without Postgres tooling.
// ---------------------------------------------------------------------------

describe('0310 migration static shape', () => {
  it('adds a WITH CHECK write guard on BOTH tables (no NULL/cross-tenant writes)', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0310), 'utf-8');

    // The holey single policy must be dropped on both tables.
    expect(sql).toContain(
      'DROP POLICY IF EXISTS tenant_or_global ON intelligence_corpus_chunks',
    );
    expect(sql).toContain('DROP POLICY IF EXISTS tenant_or_global ON ratings');

    // The write guard predicate must appear (tenant cannot write NULL/other).
    const guard =
      "tenant_id IS NOT NULL\n            AND tenant_id = current_setting('app.current_tenant_id', true)";
    // At least two occurrences per table (INSERT WITH CHECK + UPDATE WITH CHECK).
    const guardCount = sql.split('tenant_id IS NOT NULL').length - 1;
    expect(guardCount).toBeGreaterThanOrEqual(4);
    void guard;

    // Canonical GUC only — never the legacy app.tenant_id.
    expect(sql).toContain("current_setting('app.current_tenant_id', true)");
    expect(sql).not.toMatch(/current_setting\(\s*'app\.tenant_id'/);

    // FORCE RLS preserved + the service-role bypass for the global ingest path.
    expect(sql).toContain('FORCE  ROW LEVEL SECURITY');
    expect(sql).toContain(
      "current_setting('app.is_service_role', true) = 'true'",
    );
  });
});

// ---------------------------------------------------------------------------
// Live enforcement — real Postgres, non-superuser NOBYPASSRLS role.
// ---------------------------------------------------------------------------

const HAS_PG = postgresToolingAvailable();
const SETUP_TIMEOUT = 120_000;

describe.skipIf(!HAS_PG)(
  '0310 corpus/ratings WITH CHECK — RLS enforcement (real Postgres)',
  () => {
    let pg: EphemeralPostgres;

    beforeAll(async () => {
      pg = await startEphemeralPostgres();
      const admin = postgres(pg.adminUrl, { max: 1 });
      try {
        await admin.unsafe(BASELINE);
        // Grant the non-superuser app role DML on the two tables + read tenants.
        await admin.unsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON intelligence_corpus_chunks, ratings TO borjie_app;
           GRANT SELECT ON tenants TO borjie_app;`,
        );
        // Apply the fix.
        await admin.unsafe(await migrationBody(MIG_0310));
        // Idempotency — re-apply is a clean no-op.
        await admin.unsafe(await migrationBody(MIG_0310));
      } finally {
        await admin.end({ timeout: 5 });
      }
    }, SETUP_TIMEOUT);

    afterAll(() => {
      pg?.stop();
    });

    /** Run `body` inside a tx that binds the tenant + service-role GUCs. */
    async function asTenant<T>(
      tenantId: string,
      isService: boolean,
      body: (tx: postgres.TransactionSql) => Promise<T>,
    ): Promise<T> {
      const app = postgres(pg.appUrl, { max: 1 });
      try {
        return await app.begin(async (tx) => {
          await tx.unsafe(
            `SELECT set_config('app.current_tenant_id', '${tenantId}', true);
             SELECT set_config('app.is_service_role', '${isService}', true);`,
          );
          return body(tx);
        });
      } finally {
        await app.end({ timeout: 5 });
      }
    }

    it('REJECTS a tenant session INSERTing tenant_id=NULL into the corpus', async () => {
      await expect(
        asTenant('tenantA', false, (tx) =>
          tx.unsafe(
            `INSERT INTO intelligence_corpus_chunks(id,tenant_id,source_file,text)
               VALUES ('c-null', NULL, 'attacker.md', 'poison')`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('REJECTS a tenant session INSERTing tenant_id=NULL into ratings', async () => {
      await expect(
        asTenant('tenantA', false, (tx) =>
          tx.unsafe(
            `INSERT INTO ratings(id,tenant_id,subject_id,subject_kind,score)
               VALUES ('r-null', NULL, 'victim', 'buyer', 1)`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("REJECTS a tenant session INSERTing ANOTHER tenant's id", async () => {
      await expect(
        asTenant('tenantA', false, (tx) =>
          tx.unsafe(
            `INSERT INTO intelligence_corpus_chunks(id,tenant_id,source_file,text)
               VALUES ('c-cross', 'tenantB', 'evil.md', 'cross-tenant')`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('ALLOWS a tenant session INSERTing its OWN tenant_id', async () => {
      await asTenant('tenantA', false, async (tx) => {
        await tx.unsafe(
          `INSERT INTO intelligence_corpus_chunks(id,tenant_id,source_file,text)
             VALUES ('c-own', 'tenantA', 'own.md', 'mine')`,
        );
        await tx.unsafe(
          `INSERT INTO ratings(id,tenant_id,subject_id,subject_kind,score)
             VALUES ('r-own', 'tenantA', 's', 'buyer', 5)`,
        );
      });
      // Visible to the owning tenant.
      const rows = await asTenant('tenantA', false, (tx) =>
        tx.unsafe(
          `SELECT id FROM intelligence_corpus_chunks WHERE id = 'c-own'`,
        ),
      );
      expect(rows.length).toBe(1);
    });

    it('REJECTS a tenant session UPDATEing its own row to tenant_id=NULL', async () => {
      await expect(
        asTenant('tenantA', false, (tx) =>
          tx.unsafe(
            `UPDATE intelligence_corpus_chunks SET tenant_id = NULL WHERE id = 'c-own'`,
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('ALLOWS a service-role session to INSERT tenant_id=NULL global rows', async () => {
      await asTenant('__system__', true, async (tx) => {
        await tx.unsafe(
          `INSERT INTO intelligence_corpus_chunks(id,tenant_id,source_file,text)
             VALUES ('c-global', NULL, 'ground-truth.md', 'global')`,
        );
        await tx.unsafe(
          `INSERT INTO ratings(id,tenant_id,subject_id,subject_kind,score)
             VALUES ('r-global', NULL, 's', 'buyer', 5)`,
        );
      });
      const admin = postgres(pg.adminUrl, { max: 1 });
      try {
        const corpus = await admin.unsafe(
          `SELECT count(*)::int AS n FROM intelligence_corpus_chunks WHERE tenant_id IS NULL`,
        );
        expect((corpus[0] as { n: number }).n).toBe(1);
      } finally {
        await admin.end({ timeout: 5 });
      }
    });

    it('PRESERVES global-row read inheritance for tenant sessions', async () => {
      const rows = await asTenant('tenantA', false, (tx) =>
        tx.unsafe(
          `SELECT count(*)::int AS n FROM intelligence_corpus_chunks WHERE tenant_id IS NULL`,
        ),
      );
      // The one service-role-written global row is readable by the tenant.
      expect((rows[0] as { n: number }).n).toBe(1);
    });
  },
);
