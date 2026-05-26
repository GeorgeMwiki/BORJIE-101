/**
 * SQL repository surface — production code wires this to a Drizzle
 * client over `drive_files`. The implementation is a stub; the real
 * client lives at the service layer where `db` is in scope.
 */

import type { DriveRepository } from './in-memory.js';
import type { DriveFile } from '../types.js';

export interface DriveSqlDeps {
  readonly insertOnConflictDoNothing: (
    row: DriveFile,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly upsert: (
    row: DriveFile,
  ) => Promise<{ readonly inserted: boolean; readonly updated: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<DriveFile>>;
  readonly find: (
    tenantId: string,
    account: string,
    fileId: string,
  ) => Promise<DriveFile | null>;
}

export function createSqlDriveRepository(deps: DriveSqlDeps): DriveRepository {
  return {
    insert: deps.insertOnConflictDoNothing,
    upsert: deps.upsert,
    listByTenant: deps.listByTenant,
    find: deps.find,
  };
}
