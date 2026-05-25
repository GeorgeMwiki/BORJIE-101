/**
 * aop-registry-store.service — unit tests.
 *
 * Coverage:
 *   1. putSpec persists a new spec
 *   2. putSpec throws on (id, version) duplicate (port contract)
 *   3. putSpec rejects missing id / version
 *   4. listSpecs returns specs in insertion order
 *   5. putRegressionSet inserts; same id again overwrites
 *   6. listRegressionSets returns the latest payloads
 *   7. putActiveVersion(id, version) flips the row
 *   8. putActiveVersion(id, null) deactivates (delete)
 *   9. listActiveVersions returns the current map
 *  10. tenant-scoping: scopeTenantId='t-1' filters reads (no leak from null)
 *  11. read paths degrade to [] on DB error
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createAopRegistryStoreService,
  type AopSpecLike,
} from '../aop-registry-store.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredSpec {
  id: string;
  version: string;
  scopeTenantId: string | null;
  spec: AopSpecLike;
  insertedAt: number;
}

interface StoredRegressionSet {
  id: string;
  scopeTenantId: string | null;
  payload: Record<string, unknown>;
  updatedAt: number;
}

interface StoredActive {
  id: string;
  scopeTenantId: string | null;
  version: string;
}

interface StubState {
  specs: StoredSpec[];
  sets: StoredRegressionSet[];
  actives: StoredActive[];
  failNextSelect: boolean;
  failNextInsert: boolean;
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
    asc: (col: unknown) => ({ _op: 'asc', col }),
    desc: (col: unknown) => ({ _op: 'desc', col }),
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

function captureWhere(pred: unknown): {
  ids: string[];
  versions: string[];
  scopeTenantId: string | null | 'global' | 'any';
} {
  const out: {
    ids: string[];
    versions: string[];
    scopeTenantId: string | null | 'global' | 'any';
  } = {
    ids: [],
    versions: [],
    scopeTenantId: 'any',
  };
  function walk(p: unknown): void {
    const x = p as {
      _op?: string;
      col?: string;
      value?: unknown;
      args?: unknown[];
    };
    if (!x) return;
    if (x._op === 'eq') {
      if (x.col === 'id') out.ids.push(String(x.value));
      if (x.col === 'version') out.versions.push(String(x.value));
      if (x.col === 'scope_tenant_id') out.scopeTenantId = String(x.value);
    }
    if (x._op === 'isNull' && x.col === 'scope_tenant_id') {
      out.scopeTenantId = 'global';
    }
    if (x._op === 'and' && Array.isArray(x.args)) {
      for (const a of x.args) walk(a);
    }
  }
  walk(pred);
  return out;
}

function makeStubDb(): { client: DatabaseClient; state: StubState } {
  const state: StubState = {
    specs: [],
    sets: [],
    actives: [],
    failNextSelect: false,
    failNextInsert: false,
  };

  // The service uses a single SCHEMA table for each call. Infer the
  // current table from the SELECT_COLS object handed to db.select(...)
  // — each adapter's SELECT_COLS has a distinctive key set:
  //
  //   SPEC_SELECT_COLS    has 'spec'
  //   SET_SELECT_COLS     has 'payload'
  //   ACTIVE_SELECT_COLS  has 'version' + 'activatedAt'
  function makeSelectChain(selectCols: Record<string, unknown> | null): unknown {
    let wheres = captureWhere(undefined);
    let limitN = Infinity;
    let table: 'specs' | 'regression_sets' | 'active_versions' = 'specs';
    if (selectCols) {
      if ('payload' in selectCols) table = 'regression_sets';
      else if ('spec' in selectCols) table = 'specs';
      else if ('activatedAt' in selectCols) table = 'active_versions';
    }
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: (pred: unknown) => {
        wheres = captureWhere(pred);
        return chain;
      },
      orderBy: () => chain,
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
        const scopeMatch = (s: string | null): boolean => {
          if (wheres.scopeTenantId === 'any') return true;
          if (wheres.scopeTenantId === 'global') return s === null;
          return s === wheres.scopeTenantId;
        };
        if (table === 'specs') {
          const out = state.specs
            .filter((s) => scopeMatch(s.scopeTenantId))
            .filter(
              (s) =>
                (wheres.ids.length === 0 || wheres.ids.includes(s.id)) &&
                (wheres.versions.length === 0 ||
                  wheres.versions.includes(s.version)),
            )
            .sort((a, b) => a.insertedAt - b.insertedAt)
            .slice(0, limitN)
            .map((s) => ({
              id: s.id,
              version: s.version,
              scopeTenantId: s.scopeTenantId,
              spec: s.spec,
              insertedAt: s.insertedAt,
            }));
          return resolve(out);
        }
        if (table === 'regression_sets') {
          const out = state.sets
            .filter((s) => scopeMatch(s.scopeTenantId))
            .filter(
              (s) => wheres.ids.length === 0 || wheres.ids.includes(s.id),
            )
            .slice(0, limitN)
            .map((s) => ({
              id: s.id,
              scopeTenantId: s.scopeTenantId,
              payload: s.payload,
              updatedAt: s.updatedAt,
            }));
          return resolve(out);
        }
        // active_versions
        const out = state.actives
          .filter((s) => scopeMatch(s.scopeTenantId))
          .filter(
            (s) => wheres.ids.length === 0 || wheres.ids.includes(s.id),
          )
          .slice(0, limitN)
          .map((s) => ({
            id: s.id,
            scopeTenantId: s.scopeTenantId,
            version: s.version,
            activatedAt: 0,
          }));
        return resolve(out);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    let pending: Record<string, unknown> | null = null;
    let upsert: { target?: unknown; set?: Record<string, unknown> } = {};
    const chain: Record<string, unknown> = {
      values: (v: Record<string, unknown>) => {
        pending = v;
        return chain;
      },
      onConflictDoNothing: () => chain,
      onConflictDoUpdate: (cfg: { target?: unknown; set?: Record<string, unknown> }) => {
        upsert = cfg;
        return chain;
      },
      then: (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) => {
        if (state.failNextInsert) {
          state.failNextInsert = false;
          if (reject) return reject(new Error('insert boom'));
          throw new Error('insert boom');
        }
        if (!pending) return resolve(undefined);
        // Infer the target table from value shape.
        if (
          'version' in pending &&
          'spec' in pending &&
          !('payload' in pending)
        ) {
          // aop_specs
          const dup = state.specs.find(
            (s) =>
              s.id === String(pending!.id) &&
              s.version === String(pending!.version),
          );
          if (dup) return resolve(undefined); // ON CONFLICT DO NOTHING
          state.specs.push({
            id: String(pending.id),
            version: String(pending.version),
            scopeTenantId:
              pending.scopeTenantId === null
                ? null
                : String(pending.scopeTenantId),
            spec: pending.spec as AopSpecLike,
            insertedAt: state.specs.length,
          });
          return resolve(undefined);
        }
        if ('payload' in pending) {
          // aop_regression_sets — upsert on id
          const idx = state.sets.findIndex(
            (s) => s.id === String(pending!.id),
          );
          const row: StoredRegressionSet = {
            id: String(pending.id),
            scopeTenantId:
              pending.scopeTenantId === null
                ? null
                : String(pending.scopeTenantId),
            payload: pending.payload as Record<string, unknown>,
            updatedAt: Date.now(),
          };
          if (idx >= 0) state.sets[idx] = row;
          else state.sets.push(row);
          void upsert;
          return resolve(undefined);
        }
        if ('version' in pending) {
          // aop_active_versions — upsert on (scopeTenantId, id)
          const idx = state.actives.findIndex(
            (s) =>
              s.id === String(pending!.id) &&
              s.scopeTenantId ===
                (pending!.scopeTenantId === null
                  ? null
                  : String(pending!.scopeTenantId)),
          );
          const row: StoredActive = {
            id: String(pending.id),
            scopeTenantId:
              pending.scopeTenantId === null
                ? null
                : String(pending.scopeTenantId),
            version: String(pending.version),
          };
          if (idx >= 0) state.actives[idx] = row;
          else state.actives.push(row);
          return resolve(undefined);
        }
        return resolve(undefined);
      },
    };
    return chain;
  }

  function makeDeleteChain(): unknown {
    const chain: Record<string, unknown> = {
      where: (pred: unknown) => {
        const w = captureWhere(pred);
        const scopeMatch = (s: string | null): boolean => {
          if (w.scopeTenantId === 'any') return true;
          if (w.scopeTenantId === 'global') return s === null;
          return s === w.scopeTenantId;
        };
        state.actives = state.actives.filter(
          (s) => !(w.ids.includes(s.id) && scopeMatch(s.scopeTenantId)),
        );
        return Promise.resolve(undefined);
      },
    };
    return chain;
  }

  const client = {
    select: (cols?: Record<string, unknown>) =>
      makeSelectChain(cols ?? null),
    insert: () => makeInsertChain(),
    delete: () => makeDeleteChain(),
  } as unknown as DatabaseClient;

  return { client, state };
}

describe('aop-registry-store.putSpec / listSpecs', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists a new spec', async () => {
    const stub = makeStubDb();
    const svc = createAopRegistryStoreService(stub.client);
    await svc.putSpec({ id: 'aop-1', version: 'v1', systemPrompt: 'hello' });
    expect(stub.state.specs).toHaveLength(1);
  });

  it('throws on duplicate (id, version)', async () => {
    const stub = makeStubDb();
    const svc = createAopRegistryStoreService(stub.client);
    await svc.putSpec({ id: 'aop-1', version: 'v1' });
    await expect(svc.putSpec({ id: 'aop-1', version: 'v1' })).rejects.toThrow(
      /duplicate/i,
    );
  });

  it('rejects missing id / version', async () => {
    const stub = makeStubDb();
    const svc = createAopRegistryStoreService(stub.client);
    await expect(
      svc.putSpec({ id: '', version: 'v1' } as unknown as AopSpecLike),
    ).rejects.toThrow();
    await expect(
      svc.putSpec({ id: 'aop-1', version: '' } as unknown as AopSpecLike),
    ).rejects.toThrow();
  });

  it('returns specs in insertion order', async () => {
    const stub = makeStubDb();
    const svc = createAopRegistryStoreService(stub.client);
    await svc.putSpec({ id: 'a', version: 'v1' });
    await svc.putSpec({ id: 'b', version: 'v1' });
    await svc.putSpec({ id: 'a', version: 'v2' });
    const list = await svc.listSpecs();
    expect(list.map((s) => `${s.id}@${s.version}`)).toEqual([
      'a@v1',
      'b@v1',
      'a@v2',
    ]);
  });
});

describe('aop-registry-store.putRegressionSet / listRegressionSets', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('inserts; same id again overwrites', async () => {
    const stub = makeStubDb();
    const svc = createAopRegistryStoreService(stub.client);
    await svc.putRegressionSet({ id: 'rs-1', transcripts: [{ id: 't1' }] });
    await svc.putRegressionSet({ id: 'rs-1', transcripts: [{ id: 't2' }] });
    const sets = await svc.listRegressionSets();
    expect(sets).toHaveLength(1);
    const s = sets[0] as unknown as {
      id: string;
      transcripts: ReadonlyArray<{ id: string }>;
    };
    expect(s.transcripts[0]!.id).toBe('t2');
  });
});

describe('aop-registry-store.putActiveVersion / listActiveVersions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('flips active version', async () => {
    const stub = makeStubDb();
    const svc = createAopRegistryStoreService(stub.client);
    await svc.putActiveVersion('a', 'v1');
    let actives = await svc.listActiveVersions();
    expect(actives).toEqual([{ id: 'a', version: 'v1' }]);
    await svc.putActiveVersion('a', 'v2');
    actives = await svc.listActiveVersions();
    expect(actives).toEqual([{ id: 'a', version: 'v2' }]);
  });

  it('null deactivates (delete)', async () => {
    const stub = makeStubDb();
    const svc = createAopRegistryStoreService(stub.client);
    await svc.putActiveVersion('a', 'v1');
    await svc.putActiveVersion('a', null);
    const actives = await svc.listActiveVersions();
    expect(actives).toEqual([]);
  });
});

describe('aop-registry-store tenant scoping', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('scopeTenantId="t-1" filters reads (no leak from null scope)', async () => {
    const stub = makeStubDb();
    const platform = createAopRegistryStoreService(stub.client, {
      scopeTenantId: null,
    });
    const tenant = createAopRegistryStoreService(stub.client, {
      scopeTenantId: 't-1',
    });
    await platform.putSpec({ id: 'global', version: 'v1' });
    await tenant.putSpec({ id: 'tenant-only', version: 'v1' });
    const platformList = await platform.listSpecs();
    const tenantList = await tenant.listSpecs();
    expect(platformList.map((s) => s.id)).toEqual(['global']);
    expect(tenantList.map((s) => s.id)).toEqual(['tenant-only']);
  });
});

describe('aop-registry-store error handling', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('listSpecs degrades to [] on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createAopRegistryStoreService(stub.client);
    const out = await svc.listSpecs();
    expect(out).toEqual([]);
  });

  it('listActiveVersions degrades to [] on DB error', async () => {
    const stub = makeStubDb();
    stub.state.failNextSelect = true;
    const svc = createAopRegistryStoreService(stub.client);
    const out = await svc.listActiveVersions();
    expect(out).toEqual([]);
  });
});
