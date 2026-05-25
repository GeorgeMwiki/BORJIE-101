/**
 * worm-audit-log.service — unit tests.
 *
 * Coverage:
 *   1. append persists a row + returns a chained entry
 *   2. append chains the second row to the first (previousEntryHash = first.chainHash)
 *   3. append rejects missing tenantId
 *   4. append rejects missing actorId
 *   5. append surfaces DB errors (must not silently lose audit rows)
 *   6. list returns tenant-scoped rows in sequence-number order
 *   7. list is tenant-scoped (no cross-tenant leak)
 *   8. list degrades to [] on DB error
 *   9. verify ok on a clean chain
 *  10. verify detects a mutated chain_hash
 *  11. verify detects a broken previousEntryHash link
 *  12. verify degrades to { ok: false } on DB error
 *
 * Uses the same stub pattern as the other database/__tests__ files
 * (no pg / pg-mem). The stub is a record + replay shim around the
 * Drizzle query-builder surface the service touches.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createWormAuditLogService } from '../worm-audit-log.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredRow {
  entryId: string;
  tenantId: string;
  actorId: string;
  documentKind: string;
  documentId: string;
  renderedAtIso: string;
  renderedSha256: string;
  citationsSha256: string;
  previousEntryHash: string | null;
  chainHash: string;
  sequenceNumber: number;
}

interface StubState {
  rows: StoredRow[];
  whereTenantId: string | null;
  failNextInsert: boolean;
  failNextSelect: boolean;
  orderDir: 'asc' | 'desc';
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
    asc: (col: { name?: string }) => ({ _op: 'asc', col }),
    desc: (col: { name?: string }) => ({ _op: 'desc', col }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _sql: strings.join('?'),
        values,
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<StoredRow> = []): {
  client: DatabaseClient;
  state: StubState;
} {
  const state: StubState = {
    rows: [...initial],
    whereTenantId: null,
    failNextInsert: false,
    failNextSelect: false,
    orderDir: 'asc',
  };

  function applyWhere(predicate: unknown): void {
    const p = predicate as { _op?: string; col?: string; value?: unknown };
    if (p?._op === 'eq' && p.col === 'tenant_id') {
      state.whereTenantId = String(p.value);
    }
  }

  function makeSelectChain(): unknown {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (pred: unknown) => {
        applyWhere(pred);
        return chain;
      },
      orderBy: (...args: unknown[]) => {
        // The service uses `sql\`${seq} DESC\`` for tail-read and
        // `asc(seq)` for verify/list. We just inspect the first arg.
        const first = args[0] as { _op?: string; _sql?: string };
        if (
          first?._op === 'desc' ||
          (first?._sql && first._sql.includes('DESC'))
        ) {
          state.orderDir = 'desc';
        } else {
          state.orderDir = 'asc';
        }
        return chain;
      },
      limit: (_n: number) => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextSelect) {
          state.failNextSelect = false;
          if (reject) return reject(new Error('select boom'));
          throw new Error('select boom');
        }
        let out = [...state.rows];
        if (state.whereTenantId !== null) {
          out = out.filter((r) => r.tenantId === state.whereTenantId);
        }
        out.sort((a, b) =>
          state.orderDir === 'desc'
            ? b.sequenceNumber - a.sequenceNumber
            : a.sequenceNumber - b.sequenceNumber,
        );
        // Reset for the next query (the service issues sequential reads).
        state.whereTenantId = null;
        state.orderDir = 'asc';
        return resolve(out);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    let pending: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        pending = v;
        return chain;
      },
      onConflictDoNothing: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          if (reject) return reject(new Error('insert boom'));
          throw new Error('insert boom');
        }
        if (!pending) {
          return resolve(undefined);
        }
        // Honour the entry_id uniqueness: skip duplicates silently.
        if (state.rows.some((r) => r.entryId === String(pending!.entryId))) {
          return resolve(undefined);
        }
        state.rows.push({
          entryId: String(pending.entryId),
          tenantId: String(pending.tenantId),
          actorId: String(pending.actorId),
          documentKind: String(pending.documentKind),
          documentId: String(pending.documentId),
          renderedAtIso: String(pending.renderedAtIso),
          renderedSha256: String(pending.renderedSha256),
          citationsSha256: String(pending.citationsSha256),
          previousEntryHash:
            pending.previousEntryHash === null
              ? null
              : String(pending.previousEntryHash),
          chainHash: String(pending.chainHash),
          sequenceNumber: Number(pending.sequenceNumber),
        });
        return resolve(undefined);
      },
    };
    return chain;
  }

  const client = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
  } as unknown as DatabaseClient;

  return { client, state };
}

describe('worm-audit-log.append', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists one row and returns a chained entry', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    const entry = await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'monthly-owner-report',
      documentId: 'doc-1',
      renderedAtIso: '2026-05-23T00:00:00Z',
      renderedSha256: 'abc',
      citationsSha256: 'def',
    });
    expect(entry.entryId).toMatch(/^worm-\d+-/);
    expect(entry.tenantId).toBe('t-1');
    expect(entry.previousEntryHash).toBeNull();
    expect(entry.chainHash).toHaveLength(64);
    expect(stub.state.rows).toHaveLength(1);
    expect(stub.state.rows[0]!.sequenceNumber).toBe(1);
  });

  it('chains the second row to the first', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    const first = await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'monthly-owner-report',
      documentId: 'doc-1',
      renderedAtIso: '2026-05-23T00:00:00Z',
      renderedSha256: 'r1',
      citationsSha256: 'c1',
    });
    const second = await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'eviction-notice',
      documentId: 'doc-2',
      renderedAtIso: '2026-05-23T01:00:00Z',
      renderedSha256: 'r2',
      citationsSha256: 'c2',
    });
    expect(second.previousEntryHash).toBe(first.chainHash);
    expect(stub.state.rows[1]!.sequenceNumber).toBe(2);
  });

  it('rejects missing tenantId', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    await expect(
      svc.append({
        tenantId: '',
        actorId: 'u-1',
        documentKind: 'k',
        documentId: 'd',
        renderedAtIso: 'iso',
        renderedSha256: 'r',
        citationsSha256: 'c',
      }),
    ).rejects.toThrow(/tenantId/);
  });

  it('rejects missing actorId', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    await expect(
      svc.append({
        tenantId: 't-1',
        actorId: '',
        documentKind: 'k',
        documentId: 'd',
        renderedAtIso: 'iso',
        renderedSha256: 'r',
        citationsSha256: 'c',
      }),
    ).rejects.toThrow(/actorId/);
  });

  it('surfaces DB errors — audit-row loss is a SOC 2 violation', async () => {
    const stub = makeStubDb();
    stub.state.failNextInsert = true;
    const svc = createWormAuditLogService(stub.client);
    await expect(
      svc.append({
        tenantId: 't-1',
        actorId: 'u-1',
        documentKind: 'k',
        documentId: 'd',
        renderedAtIso: 'iso',
        renderedSha256: 'r',
        citationsSha256: 'c',
      }),
    ).rejects.toThrow('insert boom');
  });
});

describe('worm-audit-log.list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns tenant-scoped rows in sequence-number order', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'a',
      documentId: 'd1',
      renderedAtIso: '2026-05-23T00:00:00Z',
      renderedSha256: 'r1',
      citationsSha256: 'c1',
    });
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'b',
      documentId: 'd2',
      renderedAtIso: '2026-05-23T01:00:00Z',
      renderedSha256: 'r2',
      citationsSha256: 'c2',
    });
    const list = await svc.list('t-1');
    expect(list).toHaveLength(2);
    expect(list[0]!.documentId).toBe('d1');
    expect(list[1]!.documentId).toBe('d2');
  });

  it('is tenant-scoped (no cross-tenant leak)', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'a',
      documentId: 'd1',
      renderedAtIso: 'iso',
      renderedSha256: 'r',
      citationsSha256: 'c',
    });
    await svc.append({
      tenantId: 't-2',
      actorId: 'u-2',
      documentKind: 'a',
      documentId: 'd2',
      renderedAtIso: 'iso',
      renderedSha256: 'r',
      citationsSha256: 'c',
    });
    const t1 = await svc.list('t-1');
    const t2 = await svc.list('t-2');
    expect(t1).toHaveLength(1);
    expect(t2).toHaveLength(1);
    expect(t1[0]!.documentId).toBe('d1');
    expect(t2[0]!.documentId).toBe('d2');
  });

  it('degrades to [] on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createWormAuditLogService(stub.client);
    const out = await svc.list('t-1');
    expect(out).toEqual([]);
  });
});

describe('worm-audit-log.verify', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('verifies a clean chain', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'a',
      documentId: 'd1',
      renderedAtIso: 'iso1',
      renderedSha256: 'r1',
      citationsSha256: 'c1',
    });
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'b',
      documentId: 'd2',
      renderedAtIso: 'iso2',
      renderedSha256: 'r2',
      citationsSha256: 'c2',
    });
    const result = await svc.verify('t-1');
    expect(result).toEqual({ ok: true });
  });

  it('detects a mutated chain_hash', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'a',
      documentId: 'd1',
      renderedAtIso: 'iso1',
      renderedSha256: 'r1',
      citationsSha256: 'c1',
    });
    // Tamper: rewrite the actor_id but leave the chain_hash unchanged.
    stub.state.rows[0]!.actorId = 'attacker';
    const result = await svc.verify('t-1');
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(0);
  });

  it('detects a broken previousEntryHash link', async () => {
    const stub = makeStubDb();
    const svc = createWormAuditLogService(stub.client);
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'a',
      documentId: 'd1',
      renderedAtIso: 'iso1',
      renderedSha256: 'r1',
      citationsSha256: 'c1',
    });
    await svc.append({
      tenantId: 't-1',
      actorId: 'u-1',
      documentKind: 'b',
      documentId: 'd2',
      renderedAtIso: 'iso2',
      renderedSha256: 'r2',
      citationsSha256: 'c2',
    });
    // Tamper: rewrite the second row's previousEntryHash.
    stub.state.rows[1]!.previousEntryHash = 'forged';
    const result = await svc.verify('t-1');
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('degrades to { ok: false } on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createWormAuditLogService(stub.client);
    const result = await svc.verify('t-1');
    expect(result.ok).toBe(false);
  });
});
