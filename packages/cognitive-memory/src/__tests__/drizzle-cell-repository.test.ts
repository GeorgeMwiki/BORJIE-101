/**
 * Drizzle cell repository tests (Wave 18AA follow-up).
 *
 * These exercise the row<->domain mapping, the present-fields-only UPDATE
 * builder, the distance->similarity conversion in searchByEmbedding, and
 * the zod input guards — WITHOUT a real Postgres. A minimal structural
 * fake records the chained Drizzle query-builder calls and returns canned
 * rows, so the contract is verified in-process and deterministically.
 *
 * The durable behaviour itself (persistence across a process restart) is
 * a property of Postgres, not of this mapping layer — covered by the
 * migration apply check + integration suites.
 */

import { describe, expect, it } from 'vitest';
import { createDrizzleCellRepository } from '../storage/drizzle-cell-repository.js';
import {
  CognitiveMemoryError,
  EMBEDDING_DIM,
  type CognitiveMemoryCell,
} from '../types.js';
import type { DatabaseClient } from '@borjie/database';
import type { CognitiveMemoryCellRow } from '@borjie/database';

// ---------------------------------------------------------------------------
// Row + cell fixtures
// ---------------------------------------------------------------------------

function makeRow(
  overrides: Partial<CognitiveMemoryCellRow> = {},
): CognitiveMemoryCellRow {
  return {
    id: 'cell-1',
    tenantId: 'tenant-a',
    scopeId: 'tenant_root',
    kind: 'fact',
    contentText: 'Geita ore grade is 4.2 g/t',
    contentStructured: { subject: 'ore_grade' },
    embedding: new Array<number>(EMBEDDING_DIM).fill(0.01),
    contributedBySpecialisation: 'mr-mwikila',
    reinforcedBySpecialisations: [],
    contributedInTurnId: null,
    reinforcedInTurnIds: [],
    evidenceCitations: [],
    confidenceScore: '0.50',
    accessCount: 0,
    lastAccessedAt: null,
    promotionStatus: 'observed',
    contradictingCellId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    promotedAt: null,
    decayedAt: null,
    auditHash: 'hash-1',
    ...overrides,
  } as CognitiveMemoryCellRow;
}

function makeCell(
  overrides: Partial<CognitiveMemoryCell> = {},
): CognitiveMemoryCell {
  return {
    id: 'cell-1',
    tenant_id: 'tenant-a',
    scope_id: 'tenant_root',
    content: {
      text: 'Geita ore grade is 4.2 g/t',
      embedding: new Array<number>(EMBEDDING_DIM).fill(0.01),
      structured: { subject: 'ore_grade' },
    },
    kind: 'fact',
    contributed_by_specialisation: 'mr-mwikila',
    reinforced_by_specialisations: [],
    contributed_in_turn_id: '',
    reinforced_in_turn_ids: [],
    evidence_citations: [],
    confidence_score: 0.5,
    access_count: 0,
    last_accessed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    promoted_at: null,
    decayed_at: null,
    promotion_status: 'observed',
    contradicting_cell_id: null,
    audit_hash: 'hash-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural Drizzle fake — records calls, returns canned rows.
// ---------------------------------------------------------------------------

interface FakeState {
  insertValues?: Record<string, unknown>;
  updateSet?: Record<string, unknown>;
  selectProjection?: unknown;
  insertRows: unknown[];
  selectRows: unknown[];
  updateRows: unknown[];
}

function makeFakeDb(state: FakeState): DatabaseClient {
  const fake = {
    insert() {
      return {
        values(v: Record<string, unknown>) {
          state.insertValues = v;
          return {
            async returning() {
              return state.insertRows;
            },
          };
        },
      };
    },
    select(projection?: unknown) {
      state.selectProjection = projection;
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return state.selectRows;
                },
                orderBy() {
                  return {
                    async limit() {
                      return state.selectRows;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    update() {
      return {
        set(s: Record<string, unknown>) {
          state.updateSet = s;
          return {
            where() {
              return {
                async returning() {
                  return state.updateRows;
                },
              };
            },
          };
        },
      };
    },
  };
  return fake as unknown as DatabaseClient;
}

function newState(partial: Partial<FakeState> = {}): FakeState {
  return {
    insertRows: [],
    selectRows: [],
    updateRows: [],
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDrizzleCellRepository.insert', () => {
  it('maps a domain cell to row columns and back to a frozen cell', async () => {
    const state = newState({ insertRows: [makeRow()] });
    const repo = createDrizzleCellRepository(makeFakeDb(state));

    const result = await repo.insert(makeCell());

    expect(state.insertValues).toMatchObject({
      id: 'cell-1',
      tenantId: 'tenant-a',
      scopeId: 'tenant_root',
      kind: 'fact',
      contentText: 'Geita ore grade is 4.2 g/t',
      confidenceScore: '0.50',
      // empty contributed_in_turn_id is normalised to null (uuid column)
      contributedInTurnId: null,
      auditHash: 'hash-1',
    });
    expect(result.id).toBe('cell-1');
    expect(result.confidence_score).toBe(0.5);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('rejects an insert with empty id / tenant via zod guard', async () => {
    const repo = createDrizzleCellRepository(makeFakeDb(newState()));
    await expect(repo.insert(makeCell({ id: '' }))).rejects.toBeInstanceOf(
      CognitiveMemoryError,
    );
  });

  it('translates a unique-violation into the duplicate_id contract', async () => {
    const db = {
      insert() {
        return {
          values() {
            return {
              async returning(): Promise<unknown[]> {
                throw new Error(
                  'duplicate key value violates unique constraint "cognitive_memory_cells_pkey"',
                );
              },
            };
          },
        };
      },
    } as unknown as DatabaseClient;
    const repo = createDrizzleCellRepository(db);
    await expect(repo.insert(makeCell())).rejects.toMatchObject({
      code: 'cell_repo.duplicate_id',
    });
  });
});

describe('createDrizzleCellRepository.read', () => {
  it('returns the mapped cell when a row is found', async () => {
    const state = newState({ selectRows: [makeRow()] });
    const repo = createDrizzleCellRepository(makeFakeDb(state));
    const cell = await repo.read('cell-1', 'tenant-a');
    expect(cell?.id).toBe('cell-1');
    expect(cell?.tenant_id).toBe('tenant-a');
  });

  it('returns null when no row matches', async () => {
    const repo = createDrizzleCellRepository(makeFakeDb(newState()));
    const cell = await repo.read('missing', 'tenant-a');
    expect(cell).toBeNull();
  });

  it('returns null on invalid id/tenant without querying', async () => {
    const repo = createDrizzleCellRepository(makeFakeDb(newState()));
    expect(await repo.read('', 'tenant-a')).toBeNull();
    expect(await repo.read('cell-1', '')).toBeNull();
  });
});

describe('createDrizzleCellRepository.update', () => {
  it('forwards ONLY the present patch fields to the SET clause', async () => {
    const updatedRow = makeRow({
      promotionStatus: 'reinforced',
      confidenceScore: '0.80',
    });
    const state = newState({ updateRows: [updatedRow] });
    const repo = createDrizzleCellRepository(makeFakeDb(state));

    const result = await repo.update('cell-1', 'tenant-a', {
      promotion_status: 'reinforced',
      confidence_score: 0.8,
    });

    expect(state.updateSet).toEqual({
      promotionStatus: 'reinforced',
      confidenceScore: '0.80',
    });
    expect(result?.promotion_status).toBe('reinforced');
    expect(result?.confidence_score).toBe(0.8);
  });

  it('returns the current row unchanged for an empty patch (no SQL UPDATE)', async () => {
    const state = newState({ selectRows: [makeRow()] });
    const repo = createDrizzleCellRepository(makeFakeDb(state));
    const result = await repo.update('cell-1', 'tenant-a', {});
    expect(state.updateSet).toBeUndefined();
    expect(result?.id).toBe('cell-1');
  });
});

describe('createDrizzleCellRepository.searchByEmbedding', () => {
  it('converts cosine distance to similarity (1 - distance)', async () => {
    const state = newState({
      selectRows: [{ row: makeRow(), distance: 0.25 }],
    });
    const repo = createDrizzleCellRepository(makeFakeDb(state));
    const results = await repo.searchByEmbedding(
      'tenant-a',
      'tenant_root',
      new Array<number>(EMBEDDING_DIM).fill(0.01),
      { limit: 5 },
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.similarity).toBeCloseTo(0.75, 5);
    expect(results[0]?.cell.id).toBe('cell-1');
  });

  it('throws a typed error on a wrong-dimension embedding', async () => {
    const repo = createDrizzleCellRepository(makeFakeDb(newState()));
    await expect(
      repo.searchByEmbedding('tenant-a', 'tenant_root', [0.1, 0.2], {
        limit: 5,
      }),
    ).rejects.toMatchObject({ code: 'cell_repo.invalid_search' });
  });

  it('filters out non-finite distances', async () => {
    const state = newState({
      selectRows: [{ row: makeRow(), distance: Number.NaN }],
    });
    const repo = createDrizzleCellRepository(makeFakeDb(state));
    const results = await repo.searchByEmbedding(
      'tenant-a',
      'tenant_root',
      new Array<number>(EMBEDDING_DIM).fill(0.01),
      { limit: 5 },
    );
    expect(results).toHaveLength(0);
  });
});
