/**
 * Per-operation tenant-context pinning concurrency test (security-critical).
 *
 * Sites #2-#4 of the RLS connection-pinning hardening (brain thread store,
 * calendar connection store, proactive scheduler, calendar-sync worker) do
 * NOT pin a connection for the whole request/tick — they interleave DB work
 * with long external calls (LLM, OAuth refresh, Calendar API). Instead each
 * discrete DB operation is wrapped in `withTenantContext(db, tenantId, fn)`,
 * which opens a short transaction and binds the tenant GUC with `SET LOCAL`
 * — so the bind and the read run on ONE connection (postgres.js `.begin()`
 * reserves it for the transaction) and the external call happens strictly
 * BETWEEN such transactions, never holding a pooled connection across it.
 *
 * This test proves the `withTenantContext` mechanism is leak-free under
 * interleaved concurrent multi-tenant load on a REAL Postgres with FORCE
 * row-level security, connecting as a NON-superuser role (superusers bypass
 * RLS). It fires many interleaved tenant-A / tenant-B operations across the
 * connection pool — each a `withTenantContext` read — and asserts zero
 * cross-tenant rows and zero wrong-empty reads.
 *
 * Companion to `middleware/__tests__/database-rls-pinning.test.ts`, which
 * covers the request-scoped reserved-connection path (site #1).
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

describe.skipIf(!HAS_PG)('withTenantContext per-operation RLS pinning', () => {
  let pg: EphemeralPostgres;
  let db: {
    execute: (q: unknown) => Promise<unknown>;
    $client: { end: (o?: unknown) => Promise<void> };
  };
  let withTenantContext: <T>(
    db: unknown,
    tenantId: string,
    fn: (tx: unknown) => Promise<T>,
  ) => Promise<T>;

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
    const mod = await import('@borjie/database');
    db = mod.createDatabaseClient(pg.appUrl) as unknown as typeof db;
    withTenantContext = mod.withTenantContext as unknown as typeof withTenantContext;
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
    'never leaks cross-tenant rows across interleaved concurrent transactions',
    async () => {
      const results: ProbeResult[] = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => {
          const tenant = i % 2 === 0 ? 'tenant-A' : 'tenant-B';
          return withTenantContext(db, tenant, async (tx) => {
            const txDb = tx as { execute: (q: unknown) => Promise<unknown> };
            // Widen the window: yield between the GUC bind (done inside
            // withTenantContext) and this read. On the BUGGY session-scoped
            // pattern this is where the pool hands back a stale-GUC
            // connection; the SET LOCAL transaction makes it impossible here.
            await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 6)));
            const rows = await txDb.execute(sql`SELECT tenant_id FROM leak_probe`);
            return { tenant, seen: asTenantRows(rows) };
          });
        }),
      );

      const leaks = results.filter((r) => r.seen.some((t) => t !== r.tenant));
      const wrongEmpty = results.filter((r) => r.seen.length === 0);

      expect(
        leaks,
        `cross-tenant leak via withTenantContext: ${leaks.length}/${CONCURRENCY} ` +
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
