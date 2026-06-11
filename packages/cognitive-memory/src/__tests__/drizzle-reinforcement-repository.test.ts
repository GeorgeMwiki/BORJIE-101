/**
 * Drizzle reinforcement repository tests (cognitive-persistence follow-up).
 *
 * Exercise the row<->domain mapping, the zod input guard, the duplicate-id
 * contract, and the chronological listForCell projection — WITHOUT a real
 * Postgres. A minimal structural fake records the chained Drizzle query-
 * builder calls and returns canned rows, so the contract is verified
 * in-process and deterministically.
 */

import { describe, expect, it } from 'vitest';
import { createDrizzleReinforcementRepository } from '../storage/drizzle-reinforcement-repository.js';
import { CognitiveMemoryError } from '../types.js';
import type {
  DatabaseClient,
  CognitiveMemoryReinforcementRow,
} from '@borjie/database';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(
  overrides: Partial<CognitiveMemoryReinforcementRow> = {},
): CognitiveMemoryReinforcementRow {
  return {
    id: 'reinf-1',
    cellId: 'cell-1',
    tenantId: 'tenant-a',
    specialisation: 'geology-junior',
    turnId: 'turn-1',
    reinforcedAt: new Date('2026-01-01T00:00:00.000Z'),
    auditHash: 'hash-1',
    ...overrides,
  } as CognitiveMemoryReinforcementRow;
}

function makeRecord(
  overrides: Partial<{
    id: string;
    cell_id: string;
    tenant_id: string;
    specialisation: string;
    turn_id: string;
    reinforced_at: string;
    audit_hash: string;
  }> = {},
) {
  return {
    id: 'reinf-1',
    cell_id: 'cell-1',
    tenant_id: 'tenant-a',
    specialisation: 'geology-junior',
    turn_id: 'turn-1',
    reinforced_at: '2026-01-01T00:00:00.000Z',
    audit_hash: 'hash-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Structural Drizzle fake
// ---------------------------------------------------------------------------

interface FakeState {
  insertValues?: Record<string, unknown>;
  selectRows: unknown[];
}

function makeFakeDb(state: FakeState): DatabaseClient {
  const fake = {
    insert() {
      return {
        async values(v: Record<string, unknown>) {
          state.insertValues = v;
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async orderBy() {
                  return state.selectRows;
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
  return { selectRows: [], ...partial };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDrizzleReinforcementRepository.insert', () => {
  it('maps a record to row columns', async () => {
    const state = newState();
    const repo = createDrizzleReinforcementRepository(makeFakeDb(state));

    await repo.insert(makeRecord());

    expect(state.insertValues).toMatchObject({
      id: 'reinf-1',
      cellId: 'cell-1',
      tenantId: 'tenant-a',
      specialisation: 'geology-junior',
      turnId: 'turn-1',
      auditHash: 'hash-1',
    });
    expect(state.insertValues?.reinforcedAt).toBeInstanceOf(Date);
  });

  it('rejects an invalid record via the zod guard', async () => {
    const repo = createDrizzleReinforcementRepository(makeFakeDb(newState()));
    await expect(
      repo.insert(makeRecord({ id: '' })),
    ).rejects.toBeInstanceOf(CognitiveMemoryError);
  });

  it('translates a unique-violation into the duplicate_id contract', async () => {
    const db = {
      insert() {
        return {
          async values(): Promise<void> {
            throw new Error(
              'duplicate key value violates unique constraint "cognitive_memory_reinforcements_pkey"',
            );
          },
        };
      },
    } as unknown as DatabaseClient;
    const repo = createDrizzleReinforcementRepository(db);
    await expect(repo.insert(makeRecord())).rejects.toMatchObject({
      code: 'reinforcement_repo.duplicate_id',
    });
  });
});

describe('createDrizzleReinforcementRepository.listForCell', () => {
  it('projects rows to the port shape with an ISO reinforced_at', async () => {
    const state = newState({ selectRows: [makeRow(), makeRow({ id: 'reinf-2' })] });
    const repo = createDrizzleReinforcementRepository(makeFakeDb(state));

    const items = await repo.listForCell('cell-1');

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      id: 'reinf-1',
      specialisation: 'geology-junior',
      turn_id: 'turn-1',
      reinforced_at: '2026-01-01T00:00:00.000Z',
    });
  });

  it('returns [] on an empty cell id without querying', async () => {
    const repo = createDrizzleReinforcementRepository(makeFakeDb(newState()));
    expect(await repo.listForCell('')).toEqual([]);
  });
});
