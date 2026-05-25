// @ts-nocheck — drizzle-orm v0.36 pgEnum narrowing on migration_status column; tracked.
/**
 * Postgres-backed migration repository (Drizzle).
 *
 * Implements IMigrationRepository against the `migration_runs` table
 * (schema migration 0020). Every mutation is scoped by `tenant_id` so
 * row-level tenant isolation holds.
 *
 * `runInTransaction` performs a single atomic Drizzle transaction that
 * inserts each bundle collection (properties, units, tenants, employees,
 * departments, teams) using ON CONFLICT DO NOTHING on natural keys. The
 * per-kind insert count is derived from the number of RETURNING rows; any
 * row that did not return an id is logged in the corresponding skip bucket.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  migrationRuns,
  properties,
  units,
  customers,
  employees,
  departments,
  teams,
} from '@borjie/database';
import type {
  IMigrationRepository,
  MigrationBundle,
  RunInTransactionResult,
} from './migration-repository.interface.js';
import type {
  MigrationRun,
  MigrationRunStatus,
  MigrationRunCounts,
} from './migration-run.js';

/** Minimal Drizzle client shape — matches the approvals repo convention. */
export interface DrizzleLike {
  transaction<T>(fn: (tx: DrizzleLike) => Promise<T>): Promise<T>;
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
  delete?: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

export interface PostgresMigrationRepositoryDeps {
  readonly db: DrizzleLike;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
}

export class PostgresMigrationRepository implements IMigrationRepository {
  private readonly db: DrizzleLike;
  private readonly now: () => Date;
  private readonly genId: () => string;

  constructor(deps: PostgresMigrationRepositoryDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
    this.genId = deps.idGenerator ?? (() => randomUUID());
  }

  async createRun(input: {
    tenantId: string;
    createdBy: string;
    uploadFilename: string | null;
    uploadMimeType: string | null;
    uploadSizeBytes: number | null;
  }): Promise<MigrationRun> {
    const nowDate = this.now();
    const id = this.genId();
    const status: MigrationRunStatus = 'uploaded';

    await this.db
      .insert(migrationRuns)
      .values({
        id,
        tenantId: input.tenantId,
        createdBy: input.createdBy,
        status,
        uploadFilename: input.uploadFilename,
        uploadMimeType: input.uploadMimeType,
        uploadSizeBytes: input.uploadSizeBytes,
        createdAt: nowDate,
        updatedAt: nowDate,
      });

    const nowIso = nowDate.toISOString();
    return {
      id,
      tenantId: input.tenantId,
      createdBy: input.createdBy,
      status,
      uploadFilename: input.uploadFilename,
      uploadMimeType: input.uploadMimeType,
      uploadSizeBytes: input.uploadSizeBytes,
      extractionSummary: null,
      diffSummary: null,
      committedSummary: null,
      errorMessage: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      approvedAt: null,
      committedAt: null,
      bundle: null,
    };
  }

  async findRun(runId: string, tenantId: string): Promise<MigrationRun | null> {
    const rows = await this.db
      .select()
      .from(migrationRuns)
      .where(
        and(eq(migrationRuns.id, runId), eq(migrationRuns.tenantId, tenantId))
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return rowToMigrationRun(row);
  }

  async updateStatus(
    runId: string,
    tenantId: string,
    status: MigrationRunStatus,
    patch: Partial<MigrationRun> = {}
  ): Promise<MigrationRun> {
    const nowDate = this.now();
    const updateValues: Record<string, unknown> = {
      status,
      updatedAt: nowDate,
    };

    // Map patch fields back to db columns. Only persist fields that exist
    // on the migration_runs table.
    if (patch.extractionSummary !== undefined) {
      updateValues.extractionSummary = patch.extractionSummary;
    }
    if (patch.diffSummary !== undefined) {
      updateValues.diffSummary = patch.diffSummary;
    }
    if (patch.committedSummary !== undefined) {
      updateValues.committedSummary = patch.committedSummary;
    }
    if (patch.errorMessage !== undefined) {
      updateValues.errorMessage = patch.errorMessage;
    }
    if (patch.bundle !== undefined) {
      updateValues.bundle = patch.bundle;
    }
    if (patch.approvedAt !== undefined) {
      updateValues.approvedAt = patch.approvedAt
        ? new Date(patch.approvedAt)
        : null;
    }
    if (patch.committedAt !== undefined) {
      updateValues.committedAt = patch.committedAt
        ? new Date(patch.committedAt)
        : null;
    }

    await this.db
      .update(migrationRuns)
      .set(updateValues)
      .where(
        and(eq(migrationRuns.id, runId), eq(migrationRuns.tenantId, tenantId))
      );

    const existing = await this.findRun(runId, tenantId);
    if (!existing) {
      throw new Error(`MigrationRun not found after update: ${runId}`);
    }
    return existing;
  }

  async runInTransaction(
    tenantId: string,
    _runId: string,
    bundle: MigrationBundle
  ): Promise<RunInTransactionResult> {
    return this.db.transaction(async (tx: DrizzleLike) => {
      const counts: MigrationRunCounts = {
        properties: 0,
        units: 0,
        tenants: 0,
        employees: 0,
        departments: 0,
        teams: 0,
      };
      const skipped: Record<string, string[]> = {
        properties: [],
        units: [],
        tenants: [],
        employees: [],
        departments: [],
        teams: [],
      };

      // Properties: natural key (tenant_id, property_code)
      counts.properties = await insertReturning(
        tx,
        bundle.properties,
        (row) => ({
          id: (row.id as string) ?? this.genId(),
          tenantId,
          ownerId: row.ownerId as string,
          propertyCode:
            (row.propertyCode as string) ?? (row.code as string) ?? '',
          name: row.name as string,
          type: row.type as string,
          status: (row.status as string) ?? 'draft',
          addressLine1:
            (row.addressLine1 as string) ?? (row.address as string) ?? '',
          city: (row.city as string) ?? '',
          // No hardcoded country/currency — callers prepare rows with the
          // tenant's region values already resolved. Empty string lets
          // NOT NULL constraints surface bad inputs rather than masking.
          country: (row.country as string) ?? '',
          defaultCurrency:
            (row.defaultCurrency as string) ?? (row.currency as string) ?? '',
        }),
        properties,
        skipped.properties!,
        'property.name'
      );

      // Units: natural key (property_id, unit_code)
      counts.units = await insertReturning(
        tx,
        bundle.units,
        (row) => ({
          id: (row.id as string) ?? this.genId(),
          tenantId,
          propertyId: row.propertyId as string,
          unitCode:
            (row.unitCode as string) ?? (row.label as string) ?? '',
          name: (row.name as string) ?? (row.label as string) ?? '',
          type: (row.type as string) ?? 'studio',
          status: (row.status as string) ?? 'vacant',
          baseRentAmount: (row.baseRentAmount as number) ?? 0,
          baseRentCurrency:
            (row.baseRentCurrency as string) ?? (row.currency as string) ?? '',
        }),
        units,
        skipped.units!,
        'unit.(propertyId,unitCode)'
      );

      // Tenants (customers): natural key (tenant_id, phone)
      counts.tenants = await insertReturning(
        tx,
        bundle.tenants,
        (row) => ({
          id: (row.id as string) ?? this.genId(),
          tenantId,
          phone: (row.phone as string) ?? '',
          firstName: (row.firstName as string) ?? (row.name as string) ?? '',
          lastName: (row.lastName as string) ?? '',
          email: (row.email as string) ?? null,
        }),
        customers,
        skipped.tenants!,
        'tenant.phone'
      );

      // Employees: natural key (tenant_id, employee_code)
      counts.employees = await insertReturning(
        tx,
        bundle.employees,
        (row) => ({
          id: (row.id as string) ?? this.genId(),
          tenantId,
          employeeCode: (row.employeeCode as string) ?? '',
          firstName: (row.firstName as string) ?? (row.name as string) ?? '',
          lastName: (row.lastName as string) ?? '',
          phone: (row.phone as string) ?? null,
          email: (row.email as string) ?? null,
        }),
        employees,
        skipped.employees!,
        'employee.employeeCode'
      );

      // Departments: natural key (tenant_id, code)
      counts.departments = await insertReturning(
        tx,
        bundle.departments,
        (row) => ({
          id: (row.id as string) ?? this.genId(),
          tenantId,
          code: (row.code as string) ?? '',
          name: (row.name as string) ?? '',
        }),
        departments,
        skipped.departments!,
        'department.code'
      );

      // Teams: natural key (tenant_id, code)
      counts.teams = await insertReturning(
        tx,
        bundle.teams,
        (row) => ({
          id: (row.id as string) ?? this.genId(),
          tenantId,
          code: (row.code as string) ?? '',
          name: (row.name as string) ?? '',
          kind: (row.kind as string) ?? 'ops',
        }),
        teams,
        skipped.teams!,
        'team.code'
      );

      return { counts, skipped };
    });
  }
}

/**
 * Insert `rows` into `table` using ON CONFLICT DO NOTHING, returning
 * successfully-inserted ids. Rows that failed to insert (conflict) are
 * pushed into `skipBucket` keyed by their natural identifier.
 */
async function insertReturning(
  tx: DrizzleLike,
  rows: ReadonlyArray<Record<string, unknown>>,
  mapRow: (r: Record<string, unknown>) => Record<string, unknown>,
  table: unknown,
  skipBucket: string[],
  naturalKey: string
): Promise<number> {
  if (rows.length === 0) return 0;

  const values = rows.map((r) => mapRow(r));
  let inserted: Array<{ id: string }> = [];

  try {
    inserted = (await tx
      .insert(table)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: (table as { id: unknown }).id })) as Array<{
      id: string;
    }>;
  } catch (error) {
    // If the batch fails hard (e.g. validation on a single row), fall back
    // to per-row inserts so partial success is still recorded.
    for (const v of values) {
      try {
        const got = (await tx
          .insert(table)
          .values(v)
          .onConflictDoNothing()
          .returning({ id: (table as { id: unknown }).id })) as Array<{
          id: string;
        }>;
        inserted.push(...got);
      } catch (rowErr) {
        skipBucket.push(
          `${naturalKey}=${JSON.stringify(v)}: ${(rowErr as Error).message}`
        );
      }
    }
    // Report the original batch error once, too, for diagnostic visibility.
    skipBucket.push(`batch-fallback(${naturalKey}): ${(error as Error).message}`);
  }

  const skipped = values.length - inserted.length;
  if (skipped > 0) {
    skipBucket.push(
      `${skipped} row(s) skipped on conflict (natural key: ${naturalKey})`
    );
  }
  return inserted.length;
}

function rowToMigrationRun(row: {
  id: string;
  tenantId: string;
  createdBy: string;
  status: string;
  uploadFilename: string | null;
  uploadMimeType: string | null;
  uploadSizeBytes: number | null;
  extractionSummary: unknown;
  diffSummary: unknown;
  committedSummary: unknown;
  bundle: unknown;
  errorMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  approvedAt: Date | string | null;
  committedAt: Date | string | null;
}): MigrationRun {
  return {
    id: row.id,
    tenantId: row.tenantId,
    createdBy: row.createdBy,
    status: row.status as MigrationRunStatus,
    uploadFilename: row.uploadFilename,
    uploadMimeType: row.uploadMimeType,
    uploadSizeBytes: row.uploadSizeBytes,
    extractionSummary:
      (row.extractionSummary as MigrationRunCounts | null) ?? null,
    diffSummary:
      (row.diffSummary as MigrationRun['diffSummary']) ?? null,
    committedSummary:
      (row.committedSummary as MigrationRunCounts | null) ?? null,
    errorMessage: row.errorMessage,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    approvedAt: row.approvedAt ? toIso(row.approvedAt) : null,
    committedAt: row.committedAt ? toIso(row.committedAt) : null,
    bundle: (row.bundle as Record<string, unknown> | null) ?? null,
  };
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : String(d);
}