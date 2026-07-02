/**
 * 0372 — affective_profiles durable store — REAL Postgres.
 *
 * WHAT THIS PROVES
 * ────────────────
 * The kernel's affective accumulator (theory-of-mind.ts) used to live only in a
 * process-local in-memory Map — lost on restart, not shared across replicas.
 * 0372 gives it a durable, tenant-isolated backing table. This test proves,
 * against a NOBYPASSRLS app role so FORCE RLS actually binds:
 *   1. affective_profiles ISOLATES — tenant A never sees tenant B's profile.
 *   2. The WITH CHECK blocks a tenant A session writing tenant B rows.
 *   3. A service-role session (app.is_service_role='true') CAN upsert
 *      cross-tenant (the multi-replica hydrate/write-through path).
 *   4. The upsert round-trips a real [0,1] profile back for the OWN tenant.
 *
 * Skips cleanly when initdb/pg_ctl are absent — the static assertions run.
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
const MIG_0372 = '0372_affective_profiles.sql';

async function migrationBody(file: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed in-tree migration file
  const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
  return stripWrappingTransaction(content);
}

// ---------------------------------------------------------------------------
// Static assertions — always run, even without Postgres tooling.
// ---------------------------------------------------------------------------

describe('0372 migration static shape', () => {
  it('creates affective_profiles with FORCE RLS + both policies', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0372), 'utf-8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS affective_profiles');
    expect(sql).toContain('FORCE  ROW LEVEL SECURITY');
    expect(sql).toContain('app.current_tenant_id');
    expect(sql).toContain("current_setting('app.is_service_role', true) = 'true'");
    expect(sql).toContain('affective_profiles_tenant_isolation');
    expect(sql).toContain('affective_profiles_service_role_bypass');
  });

  it('keys the PK on (tenant_id, user_id, dimension) and clamps value [0,1]', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0372), 'utf-8');
    expect(sql).toContain('PRIMARY KEY (tenant_id, user_id, dimension)');
    expect(sql).toContain('value >= 0 AND value <= 1');
  });

  it('never fabricates values — no random generation in the DDL', async () => {
    const sql = await readFile(join(MIGRATIONS_DIR, MIG_0372), 'utf-8');
    expect(sql).not.toMatch(/random\(\)/i);
    expect(sql).not.toMatch(/Math\.random/i);
  });
});

// ---------------------------------------------------------------------------
// Live RLS — real Postgres, non-superuser NOBYPASSRLS app role.
// ---------------------------------------------------------------------------

const HAS_PG = postgresToolingAvailable();
const SETUP_TIMEOUT = 120_000;
const DIMENSIONS = ['frustration', 'comprehension', 'anxiety', 'trust', 'urgency'];

describe.skipIf(!HAS_PG)(
  '0372 affective_profiles — RLS isolation (real Postgres)',
  () => {
    let pg: EphemeralPostgres;
    const TA = 'tenant-A';
    const TB = 'tenant-B';

    beforeAll(async () => {
      pg = await startEphemeralPostgres();
      const admin = postgres(pg.adminUrl, { max: 1 });
      try {
        await admin.unsafe(await migrationBody(MIG_0372));
        // Idempotency — re-apply is a clean no-op.
        await admin.unsafe(await migrationBody(MIG_0372));

        await admin.unsafe(
          `GRANT SELECT, INSERT, UPDATE, DELETE ON affective_profiles TO borjie_app;`,
        );

        // Seed both tenants' profiles via the admin (owner) connection, which
        // is exempt from RLS (mirrors the service-role write path).
        for (const t of [TA, TB]) {
          for (const dim of DIMENSIONS) {
            await admin.unsafe(
              `INSERT INTO affective_profiles
                 (tenant_id, user_id, dimension, value, turns, expires_at)
               VALUES ('${t}', 'u1', '${dim}', 0.5, 3, NOW() + INTERVAL '24 hours')`,
            );
          }
        }
      } finally {
        await admin.end({ timeout: 5 });
      }
    }, SETUP_TIMEOUT);

    afterAll(() => {
      pg?.stop();
    });

    async function asSession<T>(
      tenantId: string,
      isService: boolean,
      body: (tx: postgres.TransactionSql) => Promise<T>,
    ): Promise<T> {
      const app = postgres(pg.appUrl, { max: 1 });
      try {
        return (await app.begin(async (tx) => {
          await tx.unsafe(
            `SELECT set_config('app.current_tenant_id', '${tenantId}', true);
             SELECT set_config('app.is_service_role', '${isService}', true);`,
          );
          return body(tx);
        })) as T;
      } finally {
        await app.end({ timeout: 5 });
      }
    }

    it('isolates tenant A from tenant B rows', async () => {
      const leak = await asSession(TA, false, (tx) =>
        tx.unsafe(
          `SELECT COUNT(*)::int AS n FROM affective_profiles WHERE tenant_id <> '${TA}'`,
        ),
      );
      expect(Number((leak[0] as unknown as { n: unknown }).n)).toBe(0);
    });

    it('reads tenant A OWN profile (all five dimensions, real values)', async () => {
      const rows = await asSession(TA, false, (tx) =>
        tx.unsafe(
          `SELECT dimension, value::numeric AS v FROM affective_profiles
            WHERE tenant_id = '${TA}' AND user_id = 'u1'`,
        ),
      );
      expect(rows.length).toBe(DIMENSIONS.length);
      for (const r of rows as unknown as Array<{ v: unknown }>) {
        const v = Number(r.v);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it('REJECTS a non-service tenant A session WRITING a tenant B row', async () => {
      await expect(
        asSession(TA, false, (tx) =>
          tx.unsafe(
            `INSERT INTO affective_profiles
               (tenant_id, user_id, dimension, value, turns, expires_at)
             VALUES ('${TB}', 'rogue', 'trust', 0.9, 1, NOW() + INTERVAL '24 hours')`,
          ),
        ),
      ).rejects.toThrow();
    });

    it('ALLOWS a service-role session to UPSERT cross-tenant (write-through path)', async () => {
      await asSession(TA, true, (tx) =>
        tx.unsafe(
          `INSERT INTO affective_profiles
             (tenant_id, user_id, dimension, value, turns, expires_at)
           VALUES ('${TB}', 'u2', 'frustration', 0.42, 5, NOW() + INTERVAL '24 hours')
           ON CONFLICT (tenant_id, user_id, dimension)
           DO UPDATE SET value = EXCLUDED.value, turns = EXCLUDED.turns,
                         expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
        ),
      );
      const rows = await asSession(TB, false, (tx) =>
        tx.unsafe(
          `SELECT value::numeric AS v FROM affective_profiles
            WHERE tenant_id = '${TB}' AND user_id = 'u2' AND dimension = 'frustration' LIMIT 1`,
        ),
      );
      expect(Number((rows[0] as unknown as { v: unknown })?.v)).toBeCloseTo(0.42, 2);
    });
  },
);
