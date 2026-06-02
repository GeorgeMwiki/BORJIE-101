/**
 * Mining-vocabulary migrations + INT-4 baseline-order — REAL Postgres.
 *
 * Validates, against a throwaway Postgres cluster:
 *
 *   INT-4 (baseline-first):
 *     - `src/migrations/0082_misc_pre_launch_tables.sql` applied STANDALONE
 *       onto an empty DB fails with `relation "incidents" does not exist`
 *       (the gap symptom), because `incidents` is created in the BASELINE
 *       (`drizzle/0003`), not in `src/migrations/`.
 *     - With the `incidents` baseline applied FIRST, 0082 applies cleanly —
 *       the exact ordering the canonical runner now guarantees by applying
 *       `drizzle/` before `src/migrations/`.
 *
 *   0180 (AwarenessTier `kernel_tier` enum rename):
 *     - lease→offtake, unit→pit, block→zone, property→site; tenant/portfolio/
 *       org/industry preserved; existing `kernel_provenance.tier` rows are
 *       relabelled in place.
 *
 *   0181 (enum-value + persona-id reconciliation):
 *     - a legacy enum label (e.g. 'leasing') is renamed in place (rows follow);
 *     - `*_persona_id` text columns are rewritten old→new across the schema;
 *     - 'estate-manager' is preserved; the migration is idempotent on re-run.
 *
 * Skips cleanly when `initdb`/`pg_ctl` are absent (CI images without Postgres
 * tooling) so the wider suite stays green there.
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

const MIG_0082 = '0082_misc_pre_launch_tables.sql';
const MIG_0180 = '0180_kernel_tier_mining_values.sql';
const MIG_0181 = '0181_enum_persona_mining_reconcile.sql';

/** Minimal `incidents`/`csr_plans` baseline — the two tables 0082 ALTERs. */
const INCIDENTS_BASELINE = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE TABLE incidents (
    id text PRIMARY KEY,
    tenant_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'open'
  );
  CREATE TABLE csr_plans (
    id text PRIMARY KEY,
    tenant_id uuid NOT NULL,
    budget_tzs numeric(18,2),
    spent_tzs numeric(18,2) NOT NULL DEFAULT 0
  );
`;

async function migrationBody(file: string): Promise<string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed in-tree migration files
  const content = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
  return stripWrappingTransaction(content);
}

const HAS_PG = postgresToolingAvailable();
const SETUP_TIMEOUT = 120_000;

describe.skipIf(!HAS_PG)('mining-vocab migrations + INT-4 baseline order (real Postgres)', () => {
  let pg: EphemeralPostgres;

  beforeAll(async () => {
    pg = await startEphemeralPostgres();
  }, SETUP_TIMEOUT);

  afterAll(() => {
    pg?.stop();
  });

  // ---------------------------------------------------------------------------
  // INT-4 — baseline-first ordering
  // ---------------------------------------------------------------------------

  it('0082 STANDALONE on an empty DB fails: relation "incidents" does not exist', async () => {
    const raw = postgres(pg.adminUrl, { max: 1 });
    try {
      await raw.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      const body = await migrationBody(MIG_0082);
      await expect(raw.unsafe(body)).rejects.toThrow(/relation "incidents" does not exist/i);
    } finally {
      await raw.end({ timeout: 5 });
    }
  });

  it('0082 applies cleanly once the incidents BASELINE is applied first', async () => {
    const raw = postgres(pg.adminUrl, { max: 1 });
    try {
      // Isolate in a fresh schema so the failed standalone run above cannot
      // interfere (each connects to the same DB).
      await raw.unsafe('DROP TABLE IF EXISTS incidents CASCADE');
      await raw.unsafe('DROP TABLE IF EXISTS csr_plans CASCADE');
      await raw.unsafe(INCIDENTS_BASELINE);

      const body = await migrationBody(MIG_0082);
      await raw.unsafe(body); // must not throw

      const cols = await raw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'incidents'
      `;
      const names = cols.map((c) => c.column_name);
      expect(names).toEqual(expect.arrayContaining(['closed_at', 'closed_by_user_id', 'closure_reason']));
    } finally {
      await raw.end({ timeout: 5 });
    }
  });

  // ---------------------------------------------------------------------------
  // 0180 — kernel_tier (AwarenessTier) enum rename
  // ---------------------------------------------------------------------------

  it('0180 renames kernel_tier labels to mining values and relabels existing rows', async () => {
    const raw = postgres(pg.adminUrl, { max: 1 });
    try {
      await raw.unsafe(`
        CREATE TYPE kernel_tier AS ENUM
          ('tenant','lease','unit','block','property','portfolio','org','industry');
        CREATE TABLE kernel_provenance (thought_id text PRIMARY KEY, tier kernel_tier NOT NULL);
        INSERT INTO kernel_provenance VALUES
          ('t1','lease'),('t2','unit'),('t3','block'),('t4','property'),('t5','tenant');
      `);

      await raw.unsafe(await migrationBody(MIG_0180));

      const labels = await raw<{ enum_range: string }[]>`SELECT enum_range(NULL::kernel_tier)::text AS enum_range`;
      // tenant + offtake/pit/zone/site + portfolio/org/industry, none of the old four.
      expect(labels[0]!.enum_range).toBe('{tenant,offtake,pit,zone,site,portfolio,org,industry}');

      const rows = await raw<{ thought_id: string; tier: string }[]>`
        SELECT thought_id, tier::text AS tier FROM kernel_provenance ORDER BY thought_id
      `;
      expect(rows.map((r) => r.tier)).toEqual(['offtake', 'pit', 'zone', 'site', 'tenant']);

      // Re-run is a clean no-op.
      await raw.unsafe(await migrationBody(MIG_0180));
    } finally {
      await raw.unsafe('DROP TABLE IF EXISTS kernel_provenance CASCADE');
      await raw.unsafe('DROP TYPE IF EXISTS kernel_tier');
      await raw.end({ timeout: 5 });
    }
  });

  // ---------------------------------------------------------------------------
  // 0181 — enum-value + persona-id reconciliation
  // ---------------------------------------------------------------------------

  it('0181 renames a legacy enum label in place and rewrites persona-id columns', async () => {
    const raw = postgres(pg.adminUrl, { max: 1 });
    try {
      await raw.unsafe(`
        CREATE TYPE legacy_charge_kind AS ENUM
          ('rent_collection','service_charge','leasing','tenant_welfare','eviction','other');
        CREATE TABLE legacy_charges (id int, kind legacy_charge_kind);
        INSERT INTO legacy_charges VALUES (1,'leasing'),(2,'eviction'),(3,'other');

        CREATE TABLE core_memory_blocks (id int, persona_id text);
        INSERT INTO core_memory_blocks VALUES
          (1,'tenant-resident'),(2,'landlord'),(3,'estate-manager'),(4,'property-manager');

        CREATE TABLE handoff_packets (id int, source_persona_id text, target_persona_id text);
        INSERT INTO handoff_packets VALUES (1,'caretaker','leasing-officer');

        CREATE TABLE persona_registry (id text PRIMARY KEY, display_name text);
        INSERT INTO persona_registry VALUES ('landlord','L'),('estate-manager','E');
      `);

      await raw.unsafe(await migrationBody(MIG_0181));

      // §1 enum label renamed in place; dependent rows follow.
      const labels = await raw<{ enum_range: string }[]>`SELECT enum_range(NULL::legacy_charge_kind)::text AS enum_range`;
      expect(labels[0]!.enum_range).toContain('offtake');
      expect(labels[0]!.enum_range).toContain('licence_suspension');
      expect(labels[0]!.enum_range).not.toContain('leasing');
      const charges = await raw<{ id: number; kind: string }[]>`
        SELECT id, kind::text AS kind FROM legacy_charges ORDER BY id
      `;
      expect(charges.map((c) => c.kind)).toEqual(['offtake', 'licence_suspension', 'other']);

      // §2 persona-id columns rewritten; estate-manager preserved.
      const cmb = await raw<{ id: number; persona_id: string }[]>`
        SELECT id, persona_id FROM core_memory_blocks ORDER BY id
      `;
      expect(cmb.map((r) => r.persona_id)).toEqual([
        'counterparty-resident', 'owner', 'estate-manager', 'site-manager',
      ]);
      const hp = await raw<{ source_persona_id: string; target_persona_id: string }[]>`
        SELECT source_persona_id, target_persona_id FROM handoff_packets
      `;
      expect(hp[0]!.source_persona_id).toBe('site-supervisor');
      expect(hp[0]!.target_persona_id).toBe('offtake-officer');

      // §3 persona_registry.id rewritten; estate-manager preserved.
      const reg = await raw<{ id: string }[]>`SELECT id FROM persona_registry ORDER BY id`;
      expect(reg.map((r) => r.id).sort()).toEqual(['estate-manager', 'owner']);

      // Idempotent re-run.
      await raw.unsafe(await migrationBody(MIG_0181));
      const cmb2 = await raw<{ persona_id: string }[]>`
        SELECT persona_id FROM core_memory_blocks ORDER BY id
      `;
      expect(cmb2.map((r) => r.persona_id)).toEqual([
        'counterparty-resident', 'owner', 'estate-manager', 'site-manager',
      ]);
    } finally {
      await raw.unsafe('DROP TABLE IF EXISTS legacy_charges CASCADE');
      await raw.unsafe('DROP TYPE IF EXISTS legacy_charge_kind');
      await raw.unsafe('DROP TABLE IF EXISTS core_memory_blocks CASCADE');
      await raw.unsafe('DROP TABLE IF EXISTS handoff_packets CASCADE');
      await raw.unsafe('DROP TABLE IF EXISTS persona_registry CASCADE');
      await raw.end({ timeout: 5 });
    }
  });
});
