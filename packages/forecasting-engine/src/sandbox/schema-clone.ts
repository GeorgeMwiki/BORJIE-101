/**
 * SchemaClone — Postgres pattern for spawning an ephemeral schema
 * that mirrors the public production schema.
 *
 * This module *documents* the SQL contract and exposes a tiny
 * planner. It does NOT execute against a real database — that
 * happens in a downstream adapter that has a pg client wired up.
 * Keeping the SQL strings here lets the package be tested without
 * Docker / Postgres in unit-test runs.
 */

export interface SchemaClonePlan {
  readonly runId: string;
  readonly schemaName: string;
  readonly ttlMs: number;
  readonly createdAtMs: number;
  readonly statements: ReadonlyArray<string>;
  readonly dropStatement: string;
}

const SAFE_RUN_ID = /^[a-z0-9_-]+$/;

export function planSchemaClone(opts: {
  runId: string;
  ttlMs?: number;
  nowMs?: number;
  sourceSchema?: string;
}): SchemaClonePlan {
  if (!SAFE_RUN_ID.test(opts.runId)) {
    throw new Error(
      `Invalid runId for schema clone: ${opts.runId}. ` +
        `Allowed characters: a-z, 0-9, _, -.`,
    );
  }
  const schemaName = `sandbox_${opts.runId}`;
  const source = opts.sourceSchema ?? 'public';
  const ttl = opts.ttlMs ?? 60 * 60 * 1000; // 1 hour default
  const now = opts.nowMs ?? Date.now();

  // pg_dump-style schema-only clone via SQL. Execution is deferred
  // to the adapter; the strings are returned for inspection / logging.
  const statements: ReadonlyArray<string> = [
    `CREATE SCHEMA "${schemaName}";`,
    `-- Copy structure of ${source} into ${schemaName}; the adapter`,
    `-- iterates information_schema.tables and re-creates each table`,
    `-- with INCLUDING ALL, then runs INSERT ... SELECT for seeded`,
    `-- rows. See packages/forecasting-engine/README.md for the full`,
    `-- contract.`,
    `COMMENT ON SCHEMA "${schemaName}" IS 'forecasting-engine sandbox; ` +
      `runId=${opts.runId}; ttlMs=${ttl}';`,
  ];

  return {
    runId: opts.runId,
    schemaName,
    ttlMs: ttl,
    createdAtMs: now,
    statements,
    dropStatement: `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`,
  };
}
