/**
 * skill-registry-writer.service — unit tests.
 *
 * Coverage:
 *   1. upsertSkill inserts a new row + returns true
 *   2. upsertSkill on (tenant, code_hash) collision returns false
 *      (counter-bump path, not a new row)
 *   3. upsertSkill rejects missing name / nlDescription / codeHash
 *   4. upsertSkill returns false on DB error
 *   5. findByCodeHash returns the matching record
 *   6. findByCodeHash is tenant-scoped (NULL = global pool)
 *   7. findByCodeHash returns null for unknown codeHash
 *   8. findByCodeHash returns null on DB error
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSkillRegistryWriterService,
  type PromotionRecord,
} from '../skill-registry-writer.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredSkill {
  id: string;
  tenantId: string | null;
  name: string;
  nlDescription: string;
  codeHash: string;
  toolCallTemplate: Record<string, unknown>;
  successCount: number;
  failureCount: number;
}

interface StubState {
  rows: StoredSkill[];
  failNextInsert: boolean;
  failNextSelect: boolean;
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
    isNull: (col: { name?: string }) => ({
      _op: 'isNull',
      col: String(col?.name ?? ''),
    }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        _sql: strings.join('?'),
        values,
      }),
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<StoredSkill> = []): {
  client: DatabaseClient;
  state: StubState;
} {
  const state: StubState = {
    rows: [...initial],
    failNextInsert: false,
    failNextSelect: false,
  };

  function captureWhere(pred: unknown): {
    tenantId: string | null | 'global';
    codeHash: string | null;
  } {
    const out: {
      tenantId: string | null | 'global';
      codeHash: string | null;
    } = { tenantId: null, codeHash: null };
    function walk(p: unknown): void {
      const x = p as {
        _op?: string;
        col?: string;
        value?: unknown;
        args?: unknown[];
      };
      if (!x) return;
      if (x._op === 'eq') {
        if (x.col === 'tenant_id') out.tenantId = String(x.value);
        if (x.col === 'code_hash') out.codeHash = String(x.value);
      }
      if (x._op === 'isNull' && x.col === 'tenant_id') out.tenantId = 'global';
      if (x._op === 'and' && Array.isArray(x.args)) {
        for (const a of x.args) walk(a);
      }
    }
    walk(pred);
    return out;
  }

  function makeSelectChain(): unknown {
    let wheres: ReturnType<typeof captureWhere> = {
      tenantId: null,
      codeHash: null,
    };
    let limitN = Infinity;
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (pred: unknown) => {
        wheres = captureWhere(pred);
        return chain;
      },
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextSelect) {
          state.failNextSelect = false;
          if (reject) return reject(new Error('select boom'));
          throw new Error('select boom');
        }
        let out = state.rows.filter((r) => {
          if (wheres.codeHash !== null && r.codeHash !== wheres.codeHash) {
            return false;
          }
          if (wheres.tenantId === 'global') return r.tenantId === null;
          if (wheres.tenantId === null) return true;
          return r.tenantId === wheres.tenantId;
        });
        return resolve(out.slice(0, limitN));
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
      onConflictDoUpdate: () => chain,
      returning: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          if (reject) return reject(new Error('insert boom'));
          throw new Error('insert boom');
        }
        if (!pending) return resolve([]);
        const dupIdx = state.rows.findIndex(
          (r) =>
            r.tenantId === (pending!.tenantId as string | null) &&
            r.codeHash === String(pending!.codeHash),
        );
        if (dupIdx >= 0) {
          const existing = state.rows[dupIdx]!;
          const updated: StoredSkill = {
            ...existing,
            name: String(pending.name),
            nlDescription: String(pending.nlDescription),
            toolCallTemplate: pending.toolCallTemplate as Record<string, unknown>,
            successCount:
              existing.successCount + Number(pending.successCount ?? 0),
            failureCount:
              existing.failureCount + Number(pending.failureCount ?? 0),
          };
          state.rows[dupIdx] = updated;
          // Return the EXISTING id (not the new one) — signals counter-bump.
          return resolve([{ id: existing.id }]);
        }
        const row: StoredSkill = {
          id: String(pending.id),
          tenantId: pending.tenantId as string | null,
          name: String(pending.name),
          nlDescription: String(pending.nlDescription),
          codeHash: String(pending.codeHash),
          toolCallTemplate: pending.toolCallTemplate as Record<string, unknown>,
          successCount: Number(pending.successCount ?? 0),
          failureCount: Number(pending.failureCount ?? 0),
        };
        state.rows.push(row);
        return resolve([{ id: row.id }]);
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

function recordFixture(overrides: Partial<PromotionRecord> = {}): PromotionRecord {
  return {
    tenantId: 't-1',
    name: 'reconcile-mpesa-batch',
    nlDescription:
      'Reconcile an M-Pesa batch: resolveContact → fetchLedger → postEntry',
    codeHash: 'sha256-abc',
    toolCallTemplate: {
      sequence: ['resolveContact', 'fetchLedger', 'postEntry'],
    },
    initialSuccessCount: 5,
    initialFailureCount: 1,
    ...overrides,
  };
}

describe('skill-registry-writer.upsertSkill', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('inserts a new row and returns true', async () => {
    const stub = makeStubDb();
    const svc = createSkillRegistryWriterService(stub.client);
    const created = await svc.upsertSkill(recordFixture());
    expect(created).toBe(true);
    expect(stub.state.rows).toHaveLength(1);
  });

  it('on (tenant, code_hash) collision returns false — counter-bump path', async () => {
    const stub = makeStubDb();
    const svc = createSkillRegistryWriterService(stub.client);
    await svc.upsertSkill(recordFixture());
    const second = await svc.upsertSkill(
      recordFixture({ initialSuccessCount: 3, initialFailureCount: 2 }),
    );
    expect(second).toBe(false);
    expect(stub.state.rows).toHaveLength(1);
    expect(stub.state.rows[0]!.successCount).toBe(5 + 3);
    expect(stub.state.rows[0]!.failureCount).toBe(1 + 2);
  });

  it('rejects missing name / nlDescription / codeHash', async () => {
    const stub = makeStubDb();
    const svc = createSkillRegistryWriterService(stub.client);
    expect(await svc.upsertSkill(recordFixture({ name: '' }))).toBe(false);
    expect(await svc.upsertSkill(recordFixture({ nlDescription: '' }))).toBe(false);
    expect(await svc.upsertSkill(recordFixture({ codeHash: '' }))).toBe(false);
    expect(stub.state.rows).toHaveLength(0);
  });

  it('returns false on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextInsert = true;
    const svc = createSkillRegistryWriterService(stub.client);
    const created = await svc.upsertSkill(recordFixture());
    expect(created).toBe(false);
  });
});

describe('skill-registry-writer.findByCodeHash', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns the matching record', async () => {
    const stub = makeStubDb([
      {
        id: 's-1',
        tenantId: 't-1',
        name: 'skill-x',
        nlDescription: 'desc',
        codeHash: 'hash-x',
        toolCallTemplate: { foo: 'bar' },
        successCount: 7,
        failureCount: 2,
      },
    ]);
    const svc = createSkillRegistryWriterService(stub.client);
    const out = await svc.findByCodeHash('t-1', 'hash-x');
    expect(out).not.toBeNull();
    expect(out!.tenantId).toBe('t-1');
    expect(out!.codeHash).toBe('hash-x');
    expect(out!.initialSuccessCount).toBe(7);
    expect(out!.initialFailureCount).toBe(2);
  });

  it('is tenant-scoped — NULL = global pool', async () => {
    const stub = makeStubDb([
      {
        id: 'g-1',
        tenantId: null,
        name: 'global-skill',
        nlDescription: 'global',
        codeHash: 'hash-g',
        toolCallTemplate: {},
        successCount: 1,
        failureCount: 0,
      },
      {
        id: 't-1-skill',
        tenantId: 't-1',
        name: 'tenant-skill',
        nlDescription: 't1',
        codeHash: 'hash-t',
        toolCallTemplate: {},
        successCount: 1,
        failureCount: 0,
      },
    ]);
    const svc = createSkillRegistryWriterService(stub.client);
    const global = await svc.findByCodeHash(null, 'hash-g');
    expect(global).not.toBeNull();
    expect(global!.tenantId).toBeNull();
    // Searching tenant t-1 for hash-g must NOT return the global row.
    const tenantMiss = await svc.findByCodeHash('t-1', 'hash-g');
    expect(tenantMiss).toBeNull();
  });

  it('returns null for unknown codeHash', async () => {
    const stub = makeStubDb();
    const svc = createSkillRegistryWriterService(stub.client);
    const out = await svc.findByCodeHash('t-1', 'unknown-hash');
    expect(out).toBeNull();
  });

  it('returns null on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createSkillRegistryWriterService(stub.client);
    const out = await svc.findByCodeHash('t-1', 'hash-x');
    expect(out).toBeNull();
  });
});
