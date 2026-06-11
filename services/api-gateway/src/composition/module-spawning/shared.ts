/**
 * module-spawning/shared.ts — shared types + tiny pure helpers for the
 * module-spawning composition wiring (Lane 3, Pass 2).
 *
 * The factory `createModuleOrchestratorDeps` (in
 * `../module-spawning-wiring.ts`) composes the four adapter families
 * (stores, approval, id-gen, executor) over these shared primitives.
 *
 * No I/O, no mutation. Pino-shape logger only.
 */

import { createHash } from 'node:crypto';
import { createDatabaseClient } from '@borjie/database';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

// `DatabaseClient` collides with a drizzle-orm/postgres-js namespace export
// at the package root, so we derive the concrete client type from the
// factory's return type (the codebase pattern — see estate-mind-wiring.ts).
export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * A monotonic clock the executor consumes to stamp the on-disk
 * audit-artifact filename. Injected so tests are deterministic and the
 * filename is never derived from a non-deterministic ambient `Date.now`
 * at the call site.
 */
export interface ModuleSpawnClock {
  /** Current wall-clock instant. */
  now(): Date;
}

/**
 * The disk writer the executor calls AFTER the DB txn commits, to
 * persist the applied migration SQL as a forensic audit artifact.
 * Injected so tests never touch the real filesystem.
 */
export interface MigrationArtifactWriter {
  /**
   * Persist `migrationSql` to `relativePath` (relative to the repo
   * `packages/database/src/migrations/tenant-modules/` root), creating
   * any missing parent directory. Throws on failure — the executor
   * catches post-commit failures and logs loudly.
   */
  write(relativePath: string, migrationSql: string): Promise<void>;
}

/** Dependencies the factory needs to build the orchestrator ports. */
export interface ModuleOrchestratorWiringDeps {
  readonly db: DatabaseClient;
  readonly logger: PinoLikeLogger;
  readonly clock: ModuleSpawnClock;
  /**
   * Optional artifact writer override (defaults to the real fs writer in
   * the factory). Tests inject a recording fake so the real filesystem is
   * never touched.
   */
  readonly artifactWriter?: MigrationArtifactWriter;
}

/**
 * Deterministic, content-addressed hash of the exact migration SQL the
 * executor will run. Format `sha256:<hex>` matches the four-eye gate's
 * `payload.specSqlHash` binding so a stale approval for different DDL can
 * never be replayed onto new SQL.
 */
export function specSqlHash(migrationSql: string): string {
  const hex = createHash('sha256').update(migrationSql, 'utf-8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * Compact, filesystem-safe ISO-8601 timestamp (UTC) for the on-disk
 * artifact filename: `2026-06-09T141502Z` style — no `:` (illegal on
 * some filesystems) and no fractional seconds.
 */
export function compactIsoTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:]/g, '');
}

/** Coerce an unknown thrown value to a non-leaking message string. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Normalise a Drizzle/`db.execute` result into a row array. Some
 * postgres.js drivers return the array directly; others wrap it in
 * `{ rows: [...] }`. Mirrors the project pattern in
 * `ai-audit-chain-repo.ts`.
 */
export function rowsOf<T>(result: unknown): ReadonlyArray<T> {
  if (Array.isArray(result)) return result as ReadonlyArray<T>;
  const rows = (result as { rows?: unknown }).rows;
  if (Array.isArray(rows)) return rows as ReadonlyArray<T>;
  return [];
}
