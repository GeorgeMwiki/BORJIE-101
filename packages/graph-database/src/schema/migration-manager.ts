/**
 * Cypher migration manager.
 *
 * Versioned Cypher migrations are a parallel to Drizzle's SQL
 * migrations: each migration carries a monotonically-increasing
 * version, an up Cypher script, an optional down script, and a
 * description. The manager applies them in order, records
 * progress in an internal `MigrationLog` port, and is idempotent.
 *
 * Per project rules — no I/O in this package directly. The host
 * supplies the `MigrationLog` (in-memory for tests, SQL-backed in
 * production) and the `GraphDriverPort` to run the scripts
 * against.
 *
 * @module @borjie/graph-database/schema/migration-manager
 */

import {
  GraphDatabaseError,
  type GraphDriverPort,
} from '../types.js';
import { wrapTenantScopedQuery } from '../query/tenant-scoped-query.js';

export interface CypherMigration {
  readonly version: number;
  readonly name: string;
  readonly description: string;
  /** Up cypher script. MUST reference `$tenantId` to satisfy
      tenant-scoping. Migrations targeting global graph schema must
      use a control tenant id (e.g. `__global__`). */
  readonly up: string;
  readonly down?: string;
}

export interface MigrationLogRecord {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: Date;
  readonly tenantId: string;
}

export interface MigrationLogPort {
  readonly listApplied: (tenantId: string) => Promise<ReadonlyArray<MigrationLogRecord>>;
  readonly record: (record: MigrationLogRecord) => Promise<void>;
  readonly remove: (version: number, tenantId: string) => Promise<void>;
}

export interface MigrationManager {
  readonly applyUp: (
    migrations: ReadonlyArray<CypherMigration>,
    tenantId: string,
  ) => Promise<ReadonlyArray<MigrationLogRecord>>;
  readonly applyDown: (
    migration: CypherMigration,
    tenantId: string,
  ) => Promise<void>;
}

export interface CreateMigrationManagerArgs {
  readonly driver: GraphDriverPort;
  readonly log: MigrationLogPort;
  readonly now?: () => Date;
}

export function createMigrationManager(
  args: CreateMigrationManagerArgs,
): MigrationManager {
  if (!args.driver) {
    throw new GraphDatabaseError(
      'migration_failed',
      'createMigrationManager requires a driver',
    );
  }
  if (!args.log) {
    throw new GraphDatabaseError(
      'migration_failed',
      'createMigrationManager requires a MigrationLogPort',
    );
  }
  const now = args.now ?? (() => new Date());

  return {
    async applyUp(migrations, tenantId) {
      assertValidTenant(tenantId);
      const sorted = [...migrations].sort((a, b) => a.version - b.version);
      const applied = await args.log.listApplied(tenantId);
      const appliedVersions = new Set(applied.map((r) => r.version));
      const newlyApplied: MigrationLogRecord[] = [];
      for (const migration of sorted) {
        if (appliedVersions.has(migration.version)) continue;
        const query = wrapTenantScopedQuery({
          cypher: migration.up,
          tenantId,
          readOnly: false,
        });
        try {
          await args.driver.run(query);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new GraphDatabaseError(
            'migration_failed',
            `migration ${migration.version} (${migration.name}) failed: ${message}`,
            { version: migration.version, tenantId },
          );
        }
        const record: MigrationLogRecord = {
          version: migration.version,
          name: migration.name,
          appliedAt: now(),
          tenantId,
        };
        await args.log.record(record);
        newlyApplied.push(record);
      }
      return newlyApplied;
    },
    async applyDown(migration, tenantId) {
      assertValidTenant(tenantId);
      if (!migration.down) {
        throw new GraphDatabaseError(
          'migration_failed',
          `migration ${migration.version} has no down script`,
          { version: migration.version },
        );
      }
      const query = wrapTenantScopedQuery({
        cypher: migration.down,
        tenantId,
        readOnly: false,
      });
      try {
        await args.driver.run(query);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new GraphDatabaseError(
          'migration_failed',
          `down migration ${migration.version} failed: ${message}`,
          { version: migration.version, tenantId },
        );
      }
      await args.log.remove(migration.version, tenantId);
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory MigrationLogPort for tests
// ---------------------------------------------------------------------------

export function createInMemoryMigrationLog(): MigrationLogPort {
  const rows = new Map<string, MigrationLogRecord>();

  function key(version: number, tenantId: string): string {
    return `${tenantId}::${String(version)}`;
  }

  return {
    async listApplied(tenantId) {
      return [...rows.values()]
        .filter((r) => r.tenantId === tenantId)
        .sort((a, b) => a.version - b.version);
    },
    async record(record) {
      rows.set(key(record.version, record.tenantId), record);
    },
    async remove(version, tenantId) {
      rows.delete(key(version, tenantId));
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function assertValidTenant(tenantId: string): void {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new GraphDatabaseError(
      'tenant_scope_missing',
      'migration manager requires a non-empty tenantId',
    );
  }
}
