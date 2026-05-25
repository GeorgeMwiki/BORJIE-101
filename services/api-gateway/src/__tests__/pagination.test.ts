/**
 * Pagination helper tests.
 *
 * The helpers replaced 10+ ad-hoc page-in-memory sites across the
 * route layer. Their correctness matters: a wrong clamp turns every
 * list endpoint into a DOS vector. These tests pin down the key
 * invariants — clamping, default, envelope shape.
 */

import { describe, it, expect } from 'vitest';
import { parseListPagination, buildListResponse } from '../routes/pagination';

function mockContext(query: Record<string, string>): any {
  return {
    req: {
      query(key: string) {
        return query[key];
      },
    },
  };
}

describe('parseListPagination', () => {
  it('defaults to page 1, pageSize 20 when no params present', () => {
    const p = parseListPagination(mockContext({}));
    expect(p).toEqual({ page: 1, pageSize: 20, limit: 20, offset: 0 });
  });

  it('parses page + pageSize and computes offset', () => {
    const p = parseListPagination(mockContext({ page: '3', pageSize: '25' }));
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(25);
    expect(p.offset).toBe(50);
  });

  it('clamps pageSize at 100 (DOS protection)', () => {
    const p = parseListPagination(mockContext({ page: '1', pageSize: '9999' }));
    expect(p.pageSize).toBe(100);
    expect(p.limit).toBe(100);
  });

  it('clamps page at minimum 1', () => {
    const p = parseListPagination(mockContext({ page: '0', pageSize: '10' }));
    expect(p.page).toBe(1);
    expect(p.offset).toBe(0);

    const p2 = parseListPagination(mockContext({ page: '-5', pageSize: '10' }));
    expect(p2.page).toBe(1);
  });

  it('accepts legacy `limit` in place of pageSize', () => {
    const p = parseListPagination(mockContext({ limit: '50' }));
    expect(p.pageSize).toBe(50);
  });

  it('falls back to defaults on non-numeric input', () => {
    const p = parseListPagination(mockContext({ page: 'abc', pageSize: 'def' }));
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(20);
  });
});

describe('buildListResponse', () => {
  it('produces the expected envelope shape', () => {
    const res = buildListResponse([{ id: 1 }, { id: 2 }], 42, {
      page: 2,
      pageSize: 2,
      limit: 2,
      offset: 2,
    });
    expect(res).toEqual({
      data: [{ id: 1 }, { id: 2 }],
      pagination: {
        page: 2,
        pageSize: 2,
        totalItems: 42,
        totalPages: 21,
        hasNextPage: true,
        hasPreviousPage: true,
      },
    });
  });

  it('marks hasNextPage false on the last page', () => {
    const res = buildListResponse([], 20, { page: 2, pageSize: 10, limit: 10, offset: 10 });
    expect(res.pagination.hasNextPage).toBe(false);
    expect(res.pagination.hasPreviousPage).toBe(true);
  });

  it('marks hasPreviousPage false on page 1', () => {
    const res = buildListResponse([{ id: 1 }], 1, { page: 1, pageSize: 10, limit: 10, offset: 0 });
    expect(res.pagination.hasPreviousPage).toBe(false);
    expect(res.pagination.totalPages).toBe(1);
  });

  it('totalPages is at least 1 even for an empty result set', () => {
    const res = buildListResponse([], 0, { page: 1, pageSize: 10, limit: 10, offset: 0 });
    expect(res.pagination.totalPages).toBe(1);
  });
});
