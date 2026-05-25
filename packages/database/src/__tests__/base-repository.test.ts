/**
 * Unit tests for repositories/base.repository.ts — pure helpers for
 * pagination shape and defaults.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGINATION,
  buildPaginatedResult,
} from '../repositories/base.repository.js';

describe('DEFAULT_PAGINATION', () => {
  it('uses limit=20, offset=0', () => {
    expect(DEFAULT_PAGINATION.limit).toBe(20);
    expect(DEFAULT_PAGINATION.offset).toBe(0);
  });
});

describe('buildPaginatedResult', () => {
  it('echoes items, total, limit, and offset', () => {
    const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = buildPaginatedResult(items, 100, { limit: 20, offset: 0 });
    expect(result.items).toBe(items);
    expect(result.total).toBe(100);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('reports hasMore=true when more items remain on the server', () => {
    const result = buildPaginatedResult(
      [{ id: 1 }, { id: 2 }],
      100,
      { limit: 2, offset: 0 },
    );
    expect(result.hasMore).toBe(true);
  });

  it('reports hasMore=false when all items have been delivered', () => {
    const result = buildPaginatedResult(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      3,
      { limit: 10, offset: 0 },
    );
    expect(result.hasMore).toBe(false);
  });

  it('hasMore=false when offset+items.length === total', () => {
    const result = buildPaginatedResult(
      [{ id: 4 }, { id: 5 }],
      5,
      { limit: 2, offset: 3 },
    );
    expect(result.hasMore).toBe(false);
  });

  it('hasMore=true when offset+items.length < total mid-range', () => {
    const result = buildPaginatedResult(
      [{ id: 4 }, { id: 5 }],
      9,
      { limit: 2, offset: 3 },
    );
    expect(result.hasMore).toBe(true);
  });

  it('handles empty items list (total=0)', () => {
    const result = buildPaginatedResult([], 0, { limit: 10, offset: 0 });
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('preserves item identity (no copy)', () => {
    const items = [{ id: 1, frozen: true }];
    const result = buildPaginatedResult(items, 1, { limit: 1, offset: 0 });
    expect(result.items).toBe(items);
  });
});
