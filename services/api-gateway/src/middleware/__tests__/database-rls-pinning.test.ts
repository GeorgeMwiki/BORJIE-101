/**
 * RLS connection-pinning concurrency test (security-critical).
 *
 * Reproduces — and then guards against — the cross-tenant RLS leak that
 * arises when the tenant GUC is bound with session scope
 * (`set_config('app.current_tenant_id', t, false)`) on a *pooled* Drizzle/
 * postgres.js client and the route's reads run as a SEPARATE statement.
 * postgres.js checks out a connection per statement, so under concurrent
 * multi-tenant load the GUC-set and the read can land on different
 * connections: request B can read on a connection whose GUC was last set
 * to tenant A → RLS returns A's rows to B.
 *
 * The test drives the REAL `databaseMiddleware` through a Hono app against
 * a REAL ephemeral Postgres with FORCE row-level security, connecting as a
 * NON-superuser role (superusers bypass RLS — see the harness). It fires
 * many interleaved tenant-A / tenant-B requests across the connection pool
 * and asserts:
 *   - ZERO cross-tenant rows (no request ever sees another tenant's data);
 *   - ZERO wrong-empty reads (every request sees its own row).
 *
 * Against the unfixed session-scoped middleware this FAILS (the leak
 * reproduces). Against the connection-pinned (`reserve()`) middleware it
 * passes deterministically — the reserved connection is held exclusively
 * for the request, so the GUC cannot be clobbered between set and read.
 *
 * Requires `initdb`/`pg_ctl` on PATH; skips cleanly otherwise so the wider
 * `vitest run` stays green on images without Postgres tooling.
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  APP_ROLE,
  postgresToolingAvailable,
  startEphemeralPostgres,
  type EphemeralPostgres,
} from '../../../test/helpers/ephemeral-postgres';

const HAS_PG = postgresToolingAvailable();

// Pool size mirrors the production default (DATABASE_POOL_MAX=20). The
// per-request JS gap below widens the cross-connection window so the leak
// reproduces deterministically against the unfixed middleware.
const POOL_MAX = 20;
// Interleaved request count — high enough that, on the unfixed path, the
// pool is guaranteed to hand a stale-GUC connection to some reader.
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

describe.skipIf(!HAS_PG)('databaseMiddleware RLS connection pinning', () => {
  let pg: EphemeralPostgres;
  // The Drizzle client under test — a pooled postgres.js client connected
  // as the NON-superuser app role so FORCE RLS is actually enforced.
  let appDb: { execute: (q: unknown) => Promise<unknown>; $client: { end: (o?: unknown) => Promise<void> } };
  let app: Hono;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();

    // Schema + seed via the superuser; grant the app role least-privilege.
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
      // anon is a Supabase construct — guard so this also runs on vanilla PG.
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

    // Build the Drizzle client the middleware will pin. Mirror prod pool.
    process.env.DATABASE_POOL_MAX = String(POOL_MAX);
    const { createDatabaseClient } = await import('@borjie/database');
    appDb = createDatabaseClient(pg.appUrl) as unknown as typeof appDb;

    // Import the REAL middleware (after env is settled).
    const { databaseMiddleware } = await import('../database');

    app = new Hono();
    // Fake auth + pre-inject the base pooled client (the middleware honours
    // a pre-injected `db`, so we don't need a live DATABASE_URL at import).
    app.use('*', async (c, next) => {
      c.set('auth', { tenantId: c.req.header('x-test-tenant') } as never);
      c.set('db', appDb as never);
      c.set('repos', null as never);
      await next();
    });
    app.use('*', databaseMiddleware);
    app.get('/probe', async (c) => {
      const db = c.get('db') as unknown as { execute: (q: unknown) => Promise<unknown> };
      // Widen the window between the GUC bind (in middleware) and this read
      // so the pool can hand back a connection bound to another tenant on
      // the unfixed path. Harmless on the fixed (reserved) path.
      await new Promise((r) => setTimeout(r, 1 + Math.floor(Math.random() * 8)));
      const rows = await db.execute(sql`SELECT tenant_id FROM leak_probe`);
      return c.json({ tenant: c.req.header('x-test-tenant'), seen: asTenantRows(rows) });
    });
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    try {
      await appDb?.$client.end({ timeout: 5 });
    } catch {
      /* best-effort */
    }
    pg?.stop();
  });

  it(
    'never leaks cross-tenant rows under interleaved concurrent load',
    async () => {
      const responses = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) => {
          const tenant = i % 2 === 0 ? 'tenant-A' : 'tenant-B';
          return app
            .request('/probe', { headers: { 'x-test-tenant': tenant } })
            .then((r) => r.json() as Promise<ProbeResult>);
        }),
      );

      const leaks = responses.filter((r) => r.seen.some((t) => t !== r.tenant));
      const wrongEmpty = responses.filter((r) => r.seen.length === 0);

      // Security invariant: no request may ever observe another tenant's row.
      expect(
        leaks,
        `cross-tenant leak: ${leaks.length}/${CONCURRENCY} requests saw foreign rows ` +
          `(e.g. ${JSON.stringify(leaks[0])})`,
      ).toHaveLength(0);
      // Liveness invariant: every request sees its own row (the GUC is never
      // lost or clobbered to a third value).
      expect(
        wrongEmpty,
        `wrong-empty: ${wrongEmpty.length}/${CONCURRENCY} requests saw zero rows`,
      ).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});
