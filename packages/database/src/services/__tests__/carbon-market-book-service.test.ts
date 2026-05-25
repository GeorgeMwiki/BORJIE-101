/**
 * carbon-market-book-service — Drizzle-level unit tests.
 *
 * Coverage:
 *   1. save inserts a new row with all BookEntry fields mapped correctly
 *   2. save re-inserts (upsert) on conflicting entry_id
 *   3. save rejects missing entry.id
 *   4. save rejects missing entry.tenantId
 *   5. save surfaces DB errors (booked trade loss desyncs desk + repo)
 *   6. findById returns a translated entry
 *   7. findById returns null on miss
 *   8. findById degrades to null on DB error
 *   9. findByTenant returns every entry for the tenant
 *  10. findByTenant degrades to [] on DB error
 *  11. findOpenByTenant filters by status correctly
 *  12. findBySymbol respects the `since` cutoff
 *  13. findBySymbol omits the cutoff when undefined
 *  14. markSettled updates status + settlement_date
 *  15. markSettled returns null when no row was updated
 *  16. cancel updates status + metadata (preserves existing metadata keys)
 *  17. cancel returns null when no row was updated
 *  18. price conversion: USD/tonne → cents on write, cents → USD/tonne on read
 *
 * Uses the same stub pattern as the sibling database/__tests__ files
 * (no pg / pg-mem). The stub is a record + replay shim around the
 * Drizzle query-builder surface the service touches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createCarbonMarketBookService } from '../carbon-market-book-service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredRow {
  entryId: string;
  tenantId: string;
  counterparty: string;
  symbol: string;
  side: string;
  qty: string;
  pricePerUnitCents: bigint;
  currency: string;
  tenor: string | null;
  tradeDate: Date;
  settlementDate: Date | null;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface WhereSpec {
  readonly tenantId?: string;
  readonly entryId?: string;
  readonly symbol?: string;
  readonly status?: string;
  readonly tradeDateGte?: Date;
}

interface StubState {
  rows: StoredRow[];
  whereSpec: WhereSpec;
  failNextInsert: boolean;
  failNextSelect: boolean;
  failNextUpdate: boolean;
  orderDir: 'asc' | 'desc';
  orderField: 'tradeDate' | null;
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: { name?: string }, value: unknown) => ({
      _op: 'eq',
      col: String(col?.name ?? ''),
      value,
    }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    gte: (col: { name?: string }, value: unknown) => ({
      _op: 'gte',
      col: String(col?.name ?? ''),
      value,
    }),
    asc: (col: { name?: string }) => ({ _op: 'asc', col: String(col?.name ?? '') }),
    desc: (col: { name?: string }) => ({ _op: 'desc', col: String(col?.name ?? '') }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _sql: strings.join('?'),
        values,
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function applyWhere(state: StubState, predicate: unknown): void {
  const stack: unknown[] = [predicate];
  while (stack.length > 0) {
    const node = stack.pop() as { _op?: string; args?: unknown[]; col?: string; value?: unknown };
    if (!node) continue;
    if (node._op === 'and' && Array.isArray(node.args)) {
      for (const a of node.args) stack.push(a);
      continue;
    }
    if (node._op === 'eq') {
      switch (node.col) {
        case 'tenant_id': state.whereSpec = { ...state.whereSpec, tenantId: String(node.value) }; break;
        case 'entry_id': state.whereSpec = { ...state.whereSpec, entryId: String(node.value) }; break;
        case 'symbol': state.whereSpec = { ...state.whereSpec, symbol: String(node.value) }; break;
        case 'status': state.whereSpec = { ...state.whereSpec, status: String(node.value) }; break;
        default: break;
      }
    }
    if (node._op === 'gte' && node.col === 'trade_date') {
      state.whereSpec = { ...state.whereSpec, tradeDateGte: node.value as Date };
    }
  }
}

function makeStubDb(): { client: DatabaseClient; state: StubState } {
  const state: StubState = {
    rows: [],
    whereSpec: {},
    failNextInsert: false,
    failNextSelect: false,
    failNextUpdate: false,
    orderDir: 'asc',
    orderField: null,
  };

  function filterRows(): StoredRow[] {
    let out = state.rows;
    if (state.whereSpec.tenantId !== undefined) {
      out = out.filter((r) => r.tenantId === state.whereSpec.tenantId);
    }
    if (state.whereSpec.entryId !== undefined) {
      out = out.filter((r) => r.entryId === state.whereSpec.entryId);
    }
    if (state.whereSpec.symbol !== undefined) {
      out = out.filter((r) => r.symbol === state.whereSpec.symbol);
    }
    if (state.whereSpec.status !== undefined) {
      out = out.filter((r) => r.status === state.whereSpec.status);
    }
    if (state.whereSpec.tradeDateGte) {
      const cutoff = state.whereSpec.tradeDateGte.getTime();
      out = out.filter((r) => r.tradeDate.getTime() >= cutoff);
    }
    return [...out];
  }

  function resetWhere(): void {
    state.whereSpec = {};
    state.orderDir = 'asc';
    state.orderField = null;
  }

  function makeSelectChain(): unknown {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (pred: unknown) => {
        applyWhere(state, pred);
        return chain;
      },
      orderBy: (...args: unknown[]) => {
        const first = args[0] as { _op?: string; col?: string };
        if (first?._op === 'desc') {
          state.orderDir = 'desc';
        } else if (first?._op === 'asc') {
          state.orderDir = 'asc';
        }
        state.orderField = 'tradeDate';
        return chain;
      },
      limit: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextSelect) {
          state.failNextSelect = false;
          if (reject) return reject(new Error('select boom'));
          throw new Error('select boom');
        }
        let out = filterRows();
        if (state.orderField === 'tradeDate') {
          out.sort((a, b) =>
            state.orderDir === 'desc'
              ? b.tradeDate.getTime() - a.tradeDate.getTime()
              : a.tradeDate.getTime() - b.tradeDate.getTime(),
          );
        }
        resetWhere();
        return resolve(out);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    let pending: Record<string, unknown> | null = null;
    let conflictUpdate: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        pending = v;
        return chain;
      },
      onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
        conflictUpdate = cfg.set;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          if (reject) return reject(new Error('insert boom'));
          throw new Error('insert boom');
        }
        if (!pending) return resolve(undefined);
        const id = String(pending.entryId);
        const existing = state.rows.findIndex((r) => r.entryId === id);
        const row: StoredRow = {
          entryId: id,
          tenantId: String(pending.tenantId),
          counterparty: String(pending.counterparty),
          symbol: String(pending.symbol),
          side: String(pending.side),
          qty: String(pending.qty),
          pricePerUnitCents: BigInt(pending.pricePerUnitCents as bigint | number),
          currency: String(pending.currency),
          tenor: pending.tenor === null ? null : String(pending.tenor),
          tradeDate: pending.tradeDate instanceof Date ? pending.tradeDate : new Date(),
          settlementDate:
            pending.settlementDate instanceof Date ? pending.settlementDate : null,
          status: String(pending.status),
          metadata:
            pending.metadata && typeof pending.metadata === 'object'
              ? (pending.metadata as Record<string, unknown>)
              : {},
          createdAt: new Date(),
          updatedAt:
            pending.updatedAt instanceof Date ? pending.updatedAt : new Date(),
        };
        if (existing >= 0 && conflictUpdate) {
          // Apply the conflict-update set instead of replacing wholesale.
          const target = state.rows[existing]!;
          state.rows[existing] = {
            ...target,
            ...row,
            createdAt: target.createdAt,
          };
        } else {
          state.rows.push(row);
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  function makeUpdateChain(): unknown {
    let setPayload: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      set: (v: Record<string, unknown>) => {
        setPayload = v;
        return chain;
      },
      where: (pred: unknown) => {
        applyWhere(state, pred);
        return chain;
      },
      returning: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextUpdate) {
          state.failNextUpdate = false;
          if (reject) return reject(new Error('update boom'));
          throw new Error('update boom');
        }
        if (!setPayload) return resolve([]);
        const matches = filterRows();
        for (const m of matches) {
          const idx = state.rows.findIndex((r) => r.entryId === m.entryId);
          if (idx >= 0) {
            state.rows[idx] = { ...m, ...setPayload } as StoredRow;
          }
        }
        const updated = matches.map((m) => state.rows.find((r) => r.entryId === m.entryId)!);
        resetWhere();
        return resolve(updated);
      },
    };
    return chain;
  }

  const client = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
    update: () => makeUpdateChain(),
  } as unknown as DatabaseClient;

  return { client, state };
}

const BASE_ENTRY = {
  id: 'BE-test-1',
  tenantId: 't-1',
  side: 'BUY' as const,
  symbol: 'CIX-NBS-2024',
  qty: 100,
  priceUsdPerTonne: 7.5,
  tenor: 'Dec-26',
  counterparty: 'CIX-DEALER-01',
  tradeDate: '2026-05-23T00:00:00.000Z',
  status: 'OPEN' as const,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('carbon-market-book.save', () => {
  it('inserts a new row mapping every BookEntry field correctly', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save(BASE_ENTRY);
    expect(stub.state.rows).toHaveLength(1);
    const row = stub.state.rows[0]!;
    expect(row.entryId).toBe('BE-test-1');
    expect(row.side).toBe('buy');
    expect(row.status).toBe('open');
    expect(row.symbol).toBe('CIX-NBS-2024');
    expect(row.currency).toBe('USD');
    expect(row.pricePerUnitCents).toBe(750n);
  });

  it('upserts on conflicting entry_id (idempotent retry)', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save(BASE_ENTRY);
    await svc.save({ ...BASE_ENTRY, priceUsdPerTonne: 9.0 });
    expect(stub.state.rows).toHaveLength(1);
    expect(stub.state.rows[0]!.pricePerUnitCents).toBe(900n);
  });

  it('rejects missing entry.id', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await expect(svc.save({ ...BASE_ENTRY, id: '' })).rejects.toThrow(/entry\.id/);
  });

  it('rejects missing entry.tenantId', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await expect(svc.save({ ...BASE_ENTRY, tenantId: '' })).rejects.toThrow(/tenantId/);
  });

  it('surfaces DB errors — losing a booked trade desyncs desk + repo', async () => {
    const stub = makeStubDb();
    stub.state.failNextInsert = true;
    const svc = createCarbonMarketBookService({ db: stub.client });
    await expect(svc.save(BASE_ENTRY)).rejects.toThrow('insert boom');
  });
});

describe('carbon-market-book.findById', () => {
  it('returns a translated entry on a hit', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save(BASE_ENTRY);
    const found = await svc.findById('BE-test-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('BE-test-1');
    expect(found!.side).toBe('BUY');
    expect(found!.status).toBe('OPEN');
    expect(found!.priceUsdPerTonne).toBe(7.5);
  });

  it('returns null on miss', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    const found = await svc.findById('NOPE');
    expect(found).toBeNull();
  });

  it('degrades to null on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createCarbonMarketBookService({ db: stub.client });
    const found = await svc.findById('anything');
    expect(found).toBeNull();
  });
});

describe('carbon-market-book.findByTenant', () => {
  it('returns every entry for the tenant', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'A' });
    await svc.save({ ...BASE_ENTRY, id: 'B', status: 'SETTLED' });
    await svc.save({ ...BASE_ENTRY, id: 'C', tenantId: 't-other' });
    const list = await svc.findByTenant('t-1');
    expect(list).toHaveLength(2);
  });

  it('degrades to [] on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createCarbonMarketBookService({ db: stub.client });
    const list = await svc.findByTenant('t-1');
    expect(list).toEqual([]);
  });
});

describe('carbon-market-book.findOpenByTenant', () => {
  it('filters by status=open', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'A', status: 'OPEN' });
    await svc.save({ ...BASE_ENTRY, id: 'B', status: 'SETTLED' });
    await svc.save({ ...BASE_ENTRY, id: 'C', status: 'CANCELLED' });
    const list = await svc.findOpenByTenant('t-1');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('A');
  });
});

describe('carbon-market-book.findBySymbol', () => {
  it('respects the `since` cutoff', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'OLD', tradeDate: '2026-04-01T00:00:00Z' });
    await svc.save({ ...BASE_ENTRY, id: 'NEW', tradeDate: '2026-05-22T00:00:00Z' });
    const list = await svc.findBySymbol('t-1', 'CIX-NBS-2024', new Date('2026-05-01T00:00:00Z'));
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('NEW');
  });

  it('returns every match when `since` is undefined', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'OLD', tradeDate: '2026-04-01T00:00:00Z' });
    await svc.save({ ...BASE_ENTRY, id: 'NEW', tradeDate: '2026-05-22T00:00:00Z' });
    const list = await svc.findBySymbol('t-1', 'CIX-NBS-2024');
    expect(list).toHaveLength(2);
  });
});

describe('carbon-market-book.markSettled', () => {
  it('updates status + settlement_date for an open row', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'S1', status: 'OPEN' });
    const settledAt = new Date('2026-06-01T12:00:00Z');
    const result = await svc.markSettled('S1', settledAt);
    expect(result).not.toBeNull();
    expect(result!.status).toBe('SETTLED');
    expect(result!.settlementDate).toBe('2026-06-01T12:00:00.000Z');
    expect(stub.state.rows[0]!.status).toBe('settled');
    expect(stub.state.rows[0]!.settlementDate).toEqual(settledAt);
  });

  it('returns null (via findById fallback) when the entry is missing', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    const result = await svc.markSettled('GONE', new Date());
    expect(result).toBeNull();
  });
});

describe('carbon-market-book.cancel', () => {
  it('updates status + preserves existing metadata while adding the reason', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'C1', status: 'OPEN' });
    // Pre-seed some metadata
    stub.state.rows[0]!.metadata = { custodianRef: 'CUST-123' };
    const result = await svc.cancel('C1', 'price moved');
    expect(result).not.toBeNull();
    expect(result!.status).toBe('CANCELLED');
    expect(stub.state.rows[0]!.status).toBe('cancelled');
    const meta = stub.state.rows[0]!.metadata as Record<string, unknown>;
    expect(meta.custodianRef).toBe('CUST-123');
    expect(meta.cancellationReason).toBe('price moved');
    expect(typeof meta.cancelledAt).toBe('string');
  });

  it('returns null when the entry is missing', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    const result = await svc.cancel('GONE', 'reason');
    expect(result).toBeNull();
  });
});

describe('carbon-market-book — price conversion round-trip', () => {
  it('USD/tonne → cents on write, cents → USD/tonne on read (no drift)', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'P1', priceUsdPerTonne: 12.34 });
    expect(stub.state.rows[0]!.pricePerUnitCents).toBe(1234n);
    const found = await svc.findById('P1');
    expect(found!.priceUsdPerTonne).toBe(12.34);
  });

  it('handles large prices (uint256-safe via BigInt)', async () => {
    const stub = makeStubDb();
    const svc = createCarbonMarketBookService({ db: stub.client });
    await svc.save({ ...BASE_ENTRY, id: 'P2', priceUsdPerTonne: 1_000_000.55 });
    expect(stub.state.rows[0]!.pricePerUnitCents).toBe(100_000_055n);
    const found = await svc.findById('P2');
    expect(found!.priceUsdPerTonne).toBe(1_000_000.55);
  });
});
