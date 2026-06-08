/**
 * Drizzle audit-chain tests (cognitive-persistence follow-up).
 *
 * Verify the hash-chained, append-only semantics against a structural
 * Drizzle fake — WITHOUT a real Postgres:
 *   - first row links to GENESIS at index 0;
 *   - the next row links to the prior rowHash at the next index;
 *   - the persisted columns let `@borjie/audit-hash-chain`'s `verifyChain`
 *     recompute every hash (semantics preserved exactly).
 */

import { describe, expect, it } from 'vitest';
import { createDrizzleAuditChain } from '../audit/drizzle-audit-chain.js';
import { CognitiveMemoryError } from '../types.js';
import {
  GENESIS_HASH,
  verifyChain,
  type ChainEntry,
} from '@borjie/audit-hash-chain';
import type {
  DatabaseClient,
  CognitiveMemoryAuditChainRow,
} from '@borjie/database';

// A growing in-memory table the fake reads its head from and appends to.
interface FakeChainState {
  rows: CognitiveMemoryAuditChainRow[];
}

function makeFakeDb(state: FakeChainState): DatabaseClient {
  const fake = {
    select() {
      return {
        from() {
          return {
            where(predicate: unknown) {
              // The repo filters by tenant; our fake stores a single tenant.
              void predicate;
              return {
                orderBy() {
                  return {
                    async limit() {
                      const sorted = [...state.rows].sort(
                        (a, b) => b.chainIndex - a.chainIndex,
                      );
                      return sorted.slice(0, 1);
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    insert() {
      return {
        async values(v: Record<string, unknown>) {
          state.rows.push({
            id: `row-${String(state.rows.length)}`,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            ...v,
          } as unknown as CognitiveMemoryAuditChainRow);
        },
      };
    },
  };
  return fake as unknown as DatabaseClient;
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: 'tenant-a',
    event_kind: 'memory.observe' as const,
    cell_id: 'cell-1',
    specialisation: 'mr-mwikila',
    turn_id: 'turn-1',
    occurred_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createDrizzleAuditChain.append', () => {
  it('seals the first row against GENESIS at index 0', async () => {
    const state: FakeChainState = { rows: [] };
    const chain = createDrizzleAuditChain(makeFakeDb(state));

    const hash = await chain.append(basePayload());

    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]?.chainIndex).toBe(0);
    expect(state.rows[0]?.prevHash).toBe(GENESIS_HASH);
    expect(state.rows[0]?.rowHash).toBe(hash);
  });

  it('links the next row to the prior rowHash at the next index', async () => {
    const state: FakeChainState = { rows: [] };
    const chain = createDrizzleAuditChain(makeFakeDb(state));

    const h0 = await chain.append(basePayload());
    const h1 = await chain.append(
      basePayload({ event_kind: 'memory.reinforce', cell_id: 'cell-2' }),
    );

    expect(state.rows).toHaveLength(2);
    expect(state.rows[1]?.chainIndex).toBe(1);
    expect(state.rows[1]?.prevHash).toBe(h0);
    expect(state.rows[1]?.rowHash).toBe(h1);
    expect(h1).not.toBe(h0);
  });

  it('produces a chain that verifyChain accepts (semantics preserved)', async () => {
    const state: FakeChainState = { rows: [] };
    const chain = createDrizzleAuditChain(makeFakeDb(state));

    await chain.append(basePayload());
    await chain.append(
      basePayload({
        event_kind: 'memory.cite',
        cell_id: 'cell-3',
        extra: { artifact: 'report-42' },
      }),
    );

    // Reconstruct ChainEntry[] from the stored columns exactly as an
    // out-of-band verifier would, and recompute every hash.
    const entries: ChainEntry[] = state.rows.map((r) => ({
      index: r.chainIndex,
      prevHash: r.prevHash,
      rowHash: r.rowHash,
      sealedAtIso: '2026-01-01T00:00:00.000Z',
      payload: {
        tenant_id: r.tenantId,
        event_kind: r.eventKind,
        cell_id: r.cellId,
        specialisation: r.specialisation,
        turn_id: r.turnId,
        occurred_at:
          r.occurredAt instanceof Date
            ? r.occurredAt.toISOString()
            : String(r.occurredAt),
        ...(r.extra !== null && r.extra !== undefined
          ? { extra: r.extra }
          : {}),
      },
    }));

    const result = verifyChain(entries);
    expect(result.ok).toBe(true);
    expect(result.scanned).toBe(2);
  });

  it('wraps a DB fault in a typed CognitiveMemoryError', async () => {
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy() {
                    return {
                      async limit(): Promise<unknown[]> {
                        throw new Error('connection reset');
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as DatabaseClient;
    const chain = createDrizzleAuditChain(db);
    await expect(chain.append(basePayload())).rejects.toBeInstanceOf(
      CognitiveMemoryError,
    );
  });
});
