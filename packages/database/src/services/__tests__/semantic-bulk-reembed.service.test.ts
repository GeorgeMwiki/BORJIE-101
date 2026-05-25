/**
 * Bulk re-embedder — unit tests.
 *
 * Coverage (6+):
 *   1. chunk iteration: re-embeds rows across multiple chunks
 *   2. respects per-tenant `limit` (stops at limit)
 *   3. resumability: rows with `last_embedded_at` newer than the
 *      modelCutoff are skipped
 *   4. embedder failure on a single row degrades gracefully
 *      (row not stamped; other rows proceed)
 *   5. zero rows returns inspectedCount=0 / reEmbeddedCount=0
 *   6. DB SELECT failure returns the base report (no crash)
 *   7. wrong-dim embedding response is dropped (row not stamped)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSemanticBulkReEmbedService,
  type BulkReEmbedder,
} from '../semantic-bulk-reembed.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredRow {
  id: string;
  tenantId: string | null;
  key: string;
  value: unknown;
  embedding: number[] | null;
  lastEmbeddedAt: Date | null;
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => ({
      _op: 'eq',
      col: String(column?.name ?? ''),
      value: typeof value === 'object' && value !== null
        ? value
        : String(value),
    }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    or: (...args: unknown[]) => ({ _op: 'or', args }),
    isNull: (column: { name?: string }) => ({
      _op: 'isnull',
      col: String(column?.name ?? ''),
    }),
    lt: (column: { name?: string }, value: unknown) => ({
      _op: 'lt',
      col: String(column?.name ?? ''),
      value,
    }),
    asc: (column: unknown) => ({ _op: 'asc', column }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _sql: strings.join('?'),
        values,
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<StoredRow>): {
  client: DatabaseClient;
  rows: StoredRow[];
  failNextSelect?: boolean;
} {
  const state = { rows: [...initial], failNextSelect: false };

  // Filter state captured between calls to model the WHERE clause.
  let currentTenantFilter: string | null | undefined;
  let currentCutoffFilter: Date | null = null;
  let currentLimit = Infinity;
  let currentUpdateId: string | undefined;
  let currentUpdateSet: Record<string, unknown> = {};

  function makeSelectChain(): unknown {
    currentTenantFilter = undefined;
    currentCutoffFilter = null;
    currentLimit = Infinity;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (filter: unknown) => {
        // Walk the and/or tree pulling out tenant_id eq + last_embedded
        // lt. The mock simplifies — tenantId set from the eq, cutoff
        // from the lt.
        const walk = (n: unknown): void => {
          if (!n || typeof n !== 'object') return;
          const node = n as {
            _op?: string;
            col?: string;
            value?: unknown;
            args?: unknown[];
          };
          if (node._op === 'and' || node._op === 'or') {
            (node.args ?? []).forEach(walk);
          } else if (node._op === 'eq' && node.col === 'tenant_id') {
            currentTenantFilter = String(node.value);
          } else if (node._op === 'isnull' && node.col === 'tenant_id') {
            currentTenantFilter = null;
          } else if (
            node._op === 'lt' &&
            node.col === 'last_embedded_at' &&
            node.value instanceof Date
          ) {
            currentCutoffFilter = node.value;
          }
        };
        walk(filter);
        return chain;
      },
      orderBy: () => chain,
      limit: (n: number) => {
        currentLimit = n;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextSelect) {
          state.failNextSelect = false;
          if (reject) return reject(new Error('select boom'));
          throw new Error('select boom');
        }
        const filtered = state.rows.filter((r) => {
          if (currentTenantFilter !== undefined &&
              r.tenantId !== currentTenantFilter) {
            return false;
          }
          if (currentCutoffFilter !== null) {
            // eligible: last_embedded_at IS NULL OR < cutoff
            if (r.lastEmbeddedAt && r.lastEmbeddedAt >= currentCutoffFilter) {
              return false;
            }
          }
          return true;
        });
        // NULLS FIRST ordering
        const sorted = filtered.slice().sort((a, b) => {
          if (a.lastEmbeddedAt === null && b.lastEmbeddedAt !== null) return -1;
          if (a.lastEmbeddedAt !== null && b.lastEmbeddedAt === null) return 1;
          if (a.lastEmbeddedAt && b.lastEmbeddedAt) {
            return a.lastEmbeddedAt.getTime() - b.lastEmbeddedAt.getTime();
          }
          return a.id.localeCompare(b.id);
        });
        const sliced = sorted.slice(0, Math.min(currentLimit, sorted.length));
        return resolve(
          sliced.map((r) => ({
            id: r.id,
            key: r.key,
            value: r.value,
            lastEmbeddedAt: r.lastEmbeddedAt,
          })),
        );
      },
    };
    return chain;
  }

  function makeUpdateChain(): unknown {
    currentUpdateId = undefined;
    currentUpdateSet = {};
    const chain: Record<string, unknown> = {
      set: (v: Record<string, unknown>) => {
        currentUpdateSet = v;
        return chain;
      },
      where: (filter: unknown) => {
        const id = (filter as { value?: unknown })?.value;
        if (typeof id === 'string') currentUpdateId = id;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (currentUpdateId) {
          const row = state.rows.find((r) => r.id === currentUpdateId);
          if (row) {
            if (Array.isArray(currentUpdateSet.embedding)) {
              row.embedding = currentUpdateSet.embedding as number[];
            }
            if (currentUpdateSet.lastEmbeddedAt instanceof Date) {
              row.lastEmbeddedAt = currentUpdateSet.lastEmbeddedAt;
            }
          }
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  const client = {
    select: () => makeSelectChain(),
    update: () => makeUpdateChain(),
  } as unknown as DatabaseClient;

  return Object.assign(state, { client });
}

const EMBED_1536 = (seed: number): number[] => {
  const out = new Array(1536);
  for (let i = 0; i < 1536; i += 1) out[i] = ((seed + i) % 7) * 0.01;
  return out;
};

function makeEmbedder(
  opts: { failOn?: string; wrongDimOn?: string } = {},
): BulkReEmbedder {
  return {
    async embed(text) {
      const id = text.split(' ')[0] ?? '';
      if (opts.failOn && id === opts.failOn) {
        throw new Error('embedder boom');
      }
      if (opts.wrongDimOn && id === opts.wrongDimOn) {
        return [0.1, 0.2];
      }
      return EMBED_1536(1);
    },
  };
}

describe('semantic-bulk-reembed.reEmbedForTenant', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('iterates rows across chunks', async () => {
    const rows: StoredRow[] = Array.from({ length: 25 }, (_, i) => ({
      id: `r-${i}`,
      tenantId: 't-1',
      key: `r-${i}`,
      value: { text: 'fact' },
      embedding: null,
      lastEmbeddedAt: null,
    }));
    const stub = makeStubDb(rows);
    const svc = createSemanticBulkReEmbedService(
      stub.client,
      makeEmbedder(),
    );
    const out = await svc.reEmbedForTenant({
      tenantId: 't-1',
      chunkSize: 10,
      limit: 100,
    });
    expect(out.inspectedCount).toBe(25);
    expect(out.reEmbeddedCount).toBe(25);
  });

  it('stops at perTenant limit', async () => {
    const rows: StoredRow[] = Array.from({ length: 50 }, (_, i) => ({
      id: `r-${i}`,
      tenantId: 't-1',
      key: `r-${i}`,
      value: 'v',
      embedding: null,
      lastEmbeddedAt: null,
    }));
    const stub = makeStubDb(rows);
    const svc = createSemanticBulkReEmbedService(
      stub.client,
      makeEmbedder(),
    );
    const out = await svc.reEmbedForTenant({
      tenantId: 't-1',
      chunkSize: 10,
      limit: 20,
    });
    expect(out.reEmbeddedCount).toBe(20);
  });

  it('skips rows newer than modelCutoff', async () => {
    const cutoff = new Date('2026-05-01T00:00:00Z');
    const rows: StoredRow[] = [
      {
        id: 'fresh',
        tenantId: 't-1',
        key: 'fresh',
        value: 'v',
        embedding: EMBED_1536(0),
        // After cutoff — should be skipped
        lastEmbeddedAt: new Date('2026-05-10T00:00:00Z'),
      },
      {
        id: 'stale',
        tenantId: 't-1',
        key: 'stale',
        value: 'v',
        embedding: EMBED_1536(0),
        // Before cutoff — should be re-embedded
        lastEmbeddedAt: new Date('2026-04-01T00:00:00Z'),
      },
    ];
    const stub = makeStubDb(rows);
    const svc = createSemanticBulkReEmbedService(
      stub.client,
      makeEmbedder(),
    );
    const out = await svc.reEmbedForTenant({
      tenantId: 't-1',
      modelCutoff: cutoff,
      chunkSize: 10,
    });
    expect(out.reEmbeddedCount).toBe(1);
    expect(stub.rows.find((r) => r.id === 'fresh')?.lastEmbeddedAt).toEqual(
      new Date('2026-05-10T00:00:00Z'),
    );
    expect(
      stub.rows.find((r) => r.id === 'stale')?.lastEmbeddedAt,
    ).not.toEqual(new Date('2026-04-01T00:00:00Z'));
  });

  it('embedder failure on one row skips that row, others proceed', async () => {
    const rows: StoredRow[] = [
      {
        id: 'good-1',
        tenantId: 't-1',
        key: 'good-1',
        value: 'v',
        embedding: null,
        lastEmbeddedAt: null,
      },
      {
        id: 'bad',
        tenantId: 't-1',
        key: 'bad',
        value: 'v',
        embedding: null,
        lastEmbeddedAt: null,
      },
      {
        id: 'good-2',
        tenantId: 't-1',
        key: 'good-2',
        value: 'v',
        embedding: null,
        lastEmbeddedAt: null,
      },
    ];
    const stub = makeStubDb(rows);
    const svc = createSemanticBulkReEmbedService(
      stub.client,
      makeEmbedder({ failOn: 'bad' }),
    );
    const out = await svc.reEmbedForTenant({
      tenantId: 't-1',
      chunkSize: 10,
    });
    expect(out.reEmbeddedCount).toBe(2);
    expect(out.inspectedCount).toBe(3);
    expect(stub.rows.find((r) => r.id === 'bad')?.lastEmbeddedAt).toBeNull();
  });

  it('zero matching rows returns zeroed report', async () => {
    const stub = makeStubDb([]);
    const svc = createSemanticBulkReEmbedService(
      stub.client,
      makeEmbedder(),
    );
    const out = await svc.reEmbedForTenant({ tenantId: 't-1' });
    expect(out.inspectedCount).toBe(0);
    expect(out.reEmbeddedCount).toBe(0);
  });

  it('drops wrong-dim embedding silently (row not stamped)', async () => {
    const rows: StoredRow[] = [
      {
        id: 'wrong',
        tenantId: 't-1',
        key: 'wrong',
        value: 'v',
        embedding: null,
        lastEmbeddedAt: null,
      },
    ];
    const stub = makeStubDb(rows);
    const svc = createSemanticBulkReEmbedService(
      stub.client,
      makeEmbedder({ wrongDimOn: 'wrong' }),
    );
    const out = await svc.reEmbedForTenant({
      tenantId: 't-1',
      chunkSize: 10,
    });
    expect(out.reEmbeddedCount).toBe(0);
    expect(stub.rows[0]?.lastEmbeddedAt).toBeNull();
  });

  it('DB SELECT failure returns base report (no crash)', async () => {
    const stub = makeStubDb([]);
    stub.failNextSelect = true;
    const svc = createSemanticBulkReEmbedService(
      stub.client,
      makeEmbedder(),
    );
    const out = await svc.reEmbedForTenant({ tenantId: 't-1' });
    expect(out.reEmbeddedCount).toBe(0);
    expect(out.inspectedCount).toBe(0);
  });
});
