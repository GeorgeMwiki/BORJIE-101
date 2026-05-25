/**
 * Base repository with common CRUD operations using Drizzle ORM.
 * Provides tenant-scoped queries, pagination, and soft delete support.
 */

import type {
  PaginationParams,
  PaginatedResult,
} from '@borjie/domain-models';

/** Default pagination when not specified */
export const DEFAULT_PAGINATION: PaginationParams = {
  limit: 20,
  offset: 0,
};

/**
 * Build a PaginatedResult from items and total count.
 */
export function buildPaginatedResult<T>(
  items: readonly T[],
  total: number,
  pagination: PaginationParams
): PaginatedResult<T> {
  const { limit, offset } = pagination;
  return {
    items,
    total,
    limit,
    offset,
    hasMore: offset + items.length < total,
  };
}
