/**
 * Shared pagination helpers for Hono route handlers.
 *
 * The historical pattern across routes was:
 *   - Accept page/pageSize query params
 *   - Load {limit: 1000, offset: 0} from the repo
 *   - Paginate the full 1000-row result in memory
 *
 * That collapses under any real dataset (>1000 rows silently truncated;
 * memory spikes on every list request). This module replaces it with
 * push-the-pagination-to-the-DB parsing and a response shape helper.
 */

import type { Context } from 'hono';

export interface ListPagination {
  page: number;
  pageSize: number;
  limit: number;
  offset: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * Parse page/pageSize (or legacy `limit`) query params and clamp them.
 * pageSize is capped at 100 to prevent DOS via huge pages.
 */
export function parseListPagination(c: Context): ListPagination {
  const page = Math.max(1, Number(c.req.query('page') || '1') || 1);
  const rawSize = Number(c.req.query('pageSize') || c.req.query('limit') || DEFAULT_PAGE_SIZE);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, rawSize || DEFAULT_PAGE_SIZE));
  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

/**
 * Build the {data, pagination} response shape that all list endpoints return.
 * Takes the total count from the repo's `result.total` so we don't need to
 * re-count on the client side.
 */
export function buildListResponse<T>(
  data: T[],
  totalItems: number,
  p: ListPagination
): {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
} {
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  return {
    data,
    pagination: {
      page: p.page,
      pageSize: p.pageSize,
      totalItems,
      totalPages,
      hasNextPage: p.page < totalPages,
      hasPreviousPage: p.page > 1,
    },
  };
}
