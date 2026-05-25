/**
 * MigrationRun entity — tracks the lifecycle of a bulk-onboarding run
 * from upload through commit.
 */

export type MigrationRunStatus =
  | 'uploaded'
  | 'extracted'
  | 'diffed'
  | 'approved'
  | 'committing'
  | 'committed'
  | 'failed';

export interface MigrationRunCounts {
  readonly properties: number;
  readonly units: number;
  readonly tenants: number;
  readonly employees: number;
  readonly departments: number;
  readonly teams: number;
}

export interface MigrationRun {
  readonly id: string;
  readonly tenantId: string;
  readonly createdBy: string;
  readonly status: MigrationRunStatus;
  readonly uploadFilename: string | null;
  readonly uploadMimeType: string | null;
  readonly uploadSizeBytes: number | null;
  readonly extractionSummary: MigrationRunCounts | null;
  readonly diffSummary: {
    readonly toAdd: MigrationRunCounts;
    readonly toUpdate?: Partial<MigrationRunCounts>;
    readonly toSkip: number;
  } | null;
  readonly committedSummary: MigrationRunCounts | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly approvedAt: string | null;
  readonly committedAt: string | null;
  /** Full bundle JSON — persisted so approve→commit is deterministic. */
  readonly bundle: Record<string, unknown> | null;
}

export interface MigrationCommittedEvent {
  readonly type: 'migration.committed';
  readonly tenantId: string;
  readonly runId: string;
  readonly counts: MigrationRunCounts;
  readonly committedAt: string;
  readonly actorId: string;
}
