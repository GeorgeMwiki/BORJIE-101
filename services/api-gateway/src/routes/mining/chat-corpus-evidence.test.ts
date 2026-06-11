/**
 * Tests for the corpus ANN retrieval seam (lane knowledge-flow).
 *
 *   - KI-07: the ANN SELECT must reference the REAL column `text`
 *            (NOT the non-existent `chunk_text` that silently threw and
 *            degraded every semantic lookup to the ILIKE fallback).
 *   - KI-08: the ANN ORDER BY must use the COSINE distance operator `<=>`
 *            (NOT the L2 operator `<->`) so it matches the
 *            `vector_cosine_ops` hnsw/ivfflat indexes and ranks correctly.
 *
 * We drive `searchCorpusTopK` with a fake Drizzle client whose `execute`
 * captures the emitted SQL text, then assert on the rendered query. The
 * fake returns one row so the ANN path is taken (no ILIKE fallback) and we
 * also assert the row is mapped from the `text` column.
 */

import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { searchCorpusTopK } from './chat-corpus-evidence.js';

/**
 * Render a drizzle `SQL` object to its raw string by walking its query
 * chunks. We only need the literal SQL fragments (operators + column
 * names), not the bound params, so concatenating the `StringChunk` values
 * is sufficient and avoids depending on a live dialect.
 */
function renderSql(q: unknown): string {
  const chunks = (q as { queryChunks?: ReadonlyArray<unknown> }).queryChunks ?? [];
  let out = '';
  for (const c of chunks) {
    const value = (c as { value?: unknown }).value;
    if (Array.isArray(value)) out += value.join('');
    else if (typeof value === 'string') out += value;
  }
  return out;
}

function fakeDb(capture: { sqlText: string }) {
  return {
    execute(q: unknown) {
      capture.sqlText = renderSql(q);
      return Promise.resolve([
        { id: 'row-1', source_file: 'research/reg.md', section: 'Royalty', text: 'royalty body', url: null },
      ]);
    },
    // unused by the ANN path but part of the duck-typed selector surface
    select() {
      throw new Error('ILIKE fallback should not run when ANN returns rows');
    },
  };
}

describe('searchCorpusTopK ANN query (KI-07 / KI-08)', () => {
  const embedding = new Array(1024).fill(0.01);

  it('selects the real `text` column, never `chunk_text` (KI-07)', async () => {
    const capture = { sqlText: '' };
    const rows = await searchCorpusTopK({
      db: fakeDb(capture),
      tenantId: null,
      message: 'royalty rate',
      embedding,
    });
    expect(capture.sqlText).toContain(' text');
    expect(capture.sqlText).not.toContain('chunk_text');
    // The returned row maps from the `text` column.
    expect(rows[0]?.text).toBe('royalty body');
    expect(rows[0]?.id).toBe('row-1');
  });

  it('orders by the cosine operator `<=>`, never L2 `<->` (KI-08)', async () => {
    const capture = { sqlText: '' };
    await searchCorpusTopK({
      db: fakeDb(capture),
      tenantId: 'tenant-x',
      message: 'royalty rate',
      embedding,
    });
    expect(capture.sqlText).toContain('<=>');
    expect(capture.sqlText).not.toContain('<->');
  });

  it('falls back to ILIKE (no ANN) when embedding is null', async () => {
    const capture = { sqlText: '' };
    let ilikeRan = false;
    const db = {
      execute() {
        throw new Error('ANN should not run without an embedding');
      },
      select() {
        ilikeRan = true;
        return {
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([]),
              }),
            }),
          }),
        };
      },
    };
    const rows = await searchCorpusTopK({
      db,
      tenantId: null,
      message: 'royalty rate',
      embedding: null,
    });
    expect(ilikeRan).toBe(true);
    expect(rows).toEqual([]);
    expect(capture.sqlText).toBe('');
  });
});
