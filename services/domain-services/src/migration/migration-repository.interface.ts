/**
 * IMigrationRepository — boundary between the migration service and
 * whatever persistence layer (Drizzle/Postgres in Phase 2) actually
 * writes the bundle.
 */

import type {
  MigrationRun,
  MigrationRunStatus,
  MigrationRunCounts,
} from './migration-run.js';

export interface MigrationBundle {
  readonly properties: ReadonlyArray<Record<string, unknown>>;
  readonly units: ReadonlyArray<Record<string, unknown>>;
  readonly tenants: ReadonlyArray<Record<string, unknown>>;
  readonly employees: ReadonlyArray<Record<string, unknown>>;
  readonly departments: ReadonlyArray<Record<string, unknown>>;
  readonly teams: ReadonlyArray<Record<string, unknown>>;
}

export interface RunInTransactionResult {
  readonly counts: MigrationRunCounts;
  /** Per-row skip reasons, keyed by entity kind. */
  readonly skipped: Record<string, string[]>;
}

export interface IMigrationRepository {
  createRun(input: {
    tenantId: string;
    createdBy: string;
    uploadFilename: string | null;
    uploadMimeType: string | null;
    uploadSizeBytes: number | null;
  }): Promise<MigrationRun>;

  findRun(runId: string, tenantId: string): Promise<MigrationRun | null>;

  updateStatus(
    runId: string,
    tenantId: string,
    status: MigrationRunStatus,
    patch?: Partial<MigrationRun>
  ): Promise<MigrationRun>;

  /**
   * Commit the bundle atomically. Implementations MUST:
   *  - Run inside a single transaction scoped to `tenantId`.
   *  - Use ON CONFLICT DO NOTHING on natural keys (property.name,
   *    unit.(propertyName,label), employee.employeeCode, etc.).
   *  - Return per-kind counts of rows actually inserted + skip reasons.
   */
  runInTransaction(
    tenantId: string,
    runId: string,
    bundle: MigrationBundle
  ): Promise<RunInTransactionResult>;
}
