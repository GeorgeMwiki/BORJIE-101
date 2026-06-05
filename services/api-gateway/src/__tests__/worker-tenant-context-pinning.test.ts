/**
 * `withWorkerTenantContext` connection-pinning concurrency test
 * (security-critical).
 *
 * Background workers bypass `databaseMiddleware`, so they bind RLS tenant
 * context themselves via `withWorkerTenantContext(db, tenantId, (tx) => ...)`.
 * The helper previously issued raw `BEGIN` / `SET LOCAL` / `COMMIT` as
 * SEPARATE `db.execute()` calls, which does NOT pin a connection on a pooled
 * postgres.js client — the SET LOCAL ran outside any transaction (a no-op)
 * and the tenant GUC was never applied. It now delegates to
 * `withTenantContext` (Drizzle `.transaction()` → postgres.js `.begin()`,
 * which pins one connection) and hands the pinned `tx` to the body.
 *
 * This fires many interleaved tenant-A / tenant-B worker bodies across the
 * pool against a REAL ephemeral Postgres with FORCE row-level security
 * (connecting as a NON-superuser role) and asserts the body, when it uses the
 * supplied `tx`, never observes another tenant's rows and never wrong-empties.
 * Companion to `with-tenant-context-pinning.test.ts`.
 *
 * Requires `initdb`/`pg_ctl` on PATH; skips cleanly otherwise.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  APP_ROLE,
  postgresToolingAvailable,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../test/helpers/ephemeral-postgres';
import {
  withWorkerTenantContext,
  type TenantContextDbLike,
} from '../workers/with-tenant-context';

const HAS_PG = postgresToolingAvailable();
const POOL_MAX = 20;
const CONCURRENCY = 300;
const SETUP_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 60_000;

interface ProbeResult {
  readonly tenant: string;
  readonly seen: readonly string[];
}

function asTenantRows(result: unknown): string[] {
  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return (rows as Array<Record<string, unknown>>)
    .map((r) => (typeof r.tenant_id === 'string' ? r.tenant_id : ''))
    .filter((t) => t.length > 0);
}

describe.skipIf(!HAS_PG)('withWorkerTenantContext RLS connection pinning', () => {
  let pg: EphemeralPostgres;
  let db: {
    execute: (q: unknown) => Promise<unknown>;
    $client: { end: (o?: unknown) => Promise<void> };
  };

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
    const { default: postgres } = await import('postgres');
    const admin = postgres(pg.adminUrl, { max: 1 });
    try {
      await admin.unsafe(`
        CREATE TABLE leak_probe (
          tenant_id text NOT NULL,
          secret    text NOT NULL
        );
        ALTER TABLE leak_probe ENABLE ROW LEVEL SECURITY;
        ALTER TABLE leak_probe FORCE ROW LEVEL SECURITY;
        CREATE POLICY leak_probe_tenant_isolation ON leak_probe
          USING (tenant_id = current_setting('app.current_tenant_id', true));
        GRANT SELECT, INSERT ON leak_probe TO ${APP_ROLE};
        INSERT INTO leak_probe (tenant_id, secret)
          VALUES ('tenant-A', 'secret-A'), ('tenant-B', 'secret-B');
      `);
      await admin.unsafe(
        `DO $$ BEGIN
           IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
             EXECUTE 'REVOKE ALL ON leak_probe FROM anon';
           END IF;
         END $$;`,
      );
    } finally {
      await admin.end({ timeout: 5 });
    }

    process.env.DATABASE_POOL_MAX = String(POOL_MAX);
    const { createDatabaseClient } = await import('@borjie/database');
    db = createDatabaseClient(pg.appUrl) as unknown as typeof db;
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    try {
      await db?.$client.end({ timeout: 5 });
    } catch {
      /* best-effort */
    }
    pg?.stop();
  });

  it(
    'never leaks cross-tenant rows when bodies use the supplied tx',
    async () => {
      const results: ProbeResult[] = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => {
          const tenant = i % 2 === 0 ? 'tenant-A' : 'tenant-B';
          return withWorkerTenantContext(
            db as unknown as TenantContextDbLike,
            tenant,
            async (tx) => {
              await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 6)));
              const rows = await tx.execute(sql`SELECT tenant_id FROM leak_probe`);
              return { tenant, seen: asTenantRows(rows) };
            },
          );
        }),
      );

      const leaks = results.filter((r) => r.seen.some((t) => t !== r.tenant));
      const wrongEmpty = results.filter((r) => r.seen.length === 0);

      expect(
        leaks,
        `cross-tenant leak via withWorkerTenantContext: ${leaks.length}/${CONCURRENCY} ` +
          `(e.g. ${JSON.stringify(leaks[0])})`,
      ).toHaveLength(0);
      expect(
        wrongEmpty,
        `wrong-empty: ${wrongEmpty.length}/${CONCURRENCY} saw zero rows`,
      ).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});
