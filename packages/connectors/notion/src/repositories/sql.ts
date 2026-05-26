/**
 * SQL repository surface — production code wires this to a Drizzle
 * client over `notion_pages` / `notion_blocks`. The implementation is
 * a stub; the real client lives at the service layer where `db` is in
 * scope.
 */

import type {
  NotionPageRepository,
  NotionBlockRepository,
} from './in-memory.js';
import type { NotionPage, NotionBlock } from '../types.js';

export interface NotionSqlPageDeps {
  readonly insertOnConflictDoNothing: (
    row: NotionPage,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<NotionPage>>;
}

export interface NotionSqlBlockDeps {
  readonly insertOnConflictDoNothing: (
    row: NotionBlock,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<NotionBlock>>;
}

export function createSqlNotionPageRepository(
  deps: NotionSqlPageDeps,
): NotionPageRepository {
  return {
    insert: deps.insertOnConflictDoNothing,
    listByTenant: deps.listByTenant,
  };
}

export function createSqlNotionBlockRepository(
  deps: NotionSqlBlockDeps,
): NotionBlockRepository {
  return {
    insert: deps.insertOnConflictDoNothing,
    listByTenant: deps.listByTenant,
  };
}
