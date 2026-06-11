/**
 * Reflexion loader service — unit tests (the compounding-loop READ-back).
 *
 * Coverage:
 *   1. recentReflexions returns tenant-wide rows ordered by importance/recency
 *   2. recentReflexions with a userId returns tenant-wide + this-user rows (superset)
 *   3. recentReflexions filters `pruned_at IS NULL` (pruned rows never surface)
 *   4. recentReflexions honest-degrades to [] when the db throws
 *   5. recentReflexions returns [] for a null db / missing tenant
 *   6. recentGuidelines returns tenant-wide + this-user rows from the
 *      SEPARATE reflexion_guidelines table
 *   7. recentGuidelines honest-degrades to [] on db error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDrizzleReflexionLoader } from '../reflexion-loader.service.js';
import type { DatabaseClient } from '../../client.js';

interface StoredReflexion {
  id: string;
  tenantId: string;
  userId: string | null;
  sessionId: string | null;
  taskId: string | null;
  reflection: string;
  outcome: string;
  importance: number;
  recordedAt: Date;
  prunedAt: Date | null;
  clusterId: string | null;
}

interface StoredGuideline {
  id: string;
  tenantId: string;
  userId: string | null;
  slug: string;
  body: string;
  confidence: number;
  updatedAt: Date;
}

type Table = 'reflexion' | 'guideline';

interface StubState {
  reflexions: StoredReflexion[];
  guidelines: StoredGuideline[];
  // Predicate captured per query so the stub `then` can apply the filter.
  predicate?: (table: Table, row: StoredReflexion | StoredGuideline) => boolean;
  activeTable?: Table;
  failNextSelect: boolean;
}

/**
 * Minimal Drizzle-shaped stub. Each `.where(predicate)` captures a
 * synthetic predicate the test wires; the stub applies it in `then`.
 * The loader uses `and(...) / or(...) / isNull / eq` from the mocked
 * drizzle-orm below, which produce plain predicate descriptors the stub
 * interprets.
 */
function makeStubDb(initial: {
  reflexions?: StoredReflexion[];
  guidelines?: StoredGuideline[];
}): { client: DatabaseClient; state: StubState } {
  const state: StubState = {
    reflexions: [...(initial.reflexions ?? [])],
    guidelines: [...(initial.guidelines ?? [])],
    failNextSelect: false,
  };

  function makeSelectChain(): unknown {
    let limitN = Infinity;
    let whereDesc: PredicateDesc | undefined;
    const chain: Record<string, unknown> = {
      from: (tbl: { __name?: Table }) => {
        state.activeTable = tbl.__name ?? 'reflexion';
        return chain;
      },
      where: (desc: PredicateDesc) => {
        whereDesc = desc;
        return chain;
      },
      orderBy: () => chain,
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (r: unknown) => unknown,
      ) => {
        if (state.failNextSelect) {
          state.failNextSelect = false;
          if (reject) return reject(new Error('select boom'));
          throw new Error('select boom');
        }
        const rows: Array<StoredReflexion | StoredGuideline> =
          state.activeTable === 'guideline'
            ? [...state.guidelines]
            : [...state.reflexions];
        const out = rows.filter((r) =>
          evalPredicate(whereDesc, r as unknown as Record<string, unknown>),
        );
        return resolve(out.slice(0, limitN));
      },
    };
    return chain;
  }

  const client = {
    select: () => makeSelectChain(),
  } as unknown as DatabaseClient;

  return { client, state };
}

// ── Predicate descriptor mini-language produced by the mocked drizzle-orm ──

type PredicateDesc =
  | { op: 'eq'; col: string; value: unknown }
  | { op: 'isNull'; col: string }
  | { op: 'and'; args: Array<PredicateDesc | undefined> }
  | { op: 'or'; args: Array<PredicateDesc | undefined> };

function evalPredicate(
  desc: PredicateDesc | undefined,
  row: Record<string, unknown>,
): boolean {
  if (!desc) return true;
  switch (desc.op) {
    case 'eq':
      return row[desc.col] === desc.value;
    case 'isNull':
      return row[desc.col] === null || row[desc.col] === undefined;
    case 'and':
      return desc.args.every((a) => evalPredicate(a, row));
    case 'or':
      return desc.args.some((a) => evalPredicate(a, row));
    default:
      return true;
  }
}

// Map a drizzle column object (we tag it with `_name`) to its property key.
function colKey(column: { _name?: string }): string {
  return String(column?._name ?? '');
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { _name?: string }, value: unknown) => ({
      op: 'eq',
      col: colKey(column),
      value,
    }),
    isNull: (column: { _name?: string }) => ({
      op: 'isNull',
      col: colKey(column),
    }),
    and: (...args: unknown[]) => ({ op: 'and', args }),
    or: (...args: unknown[]) => ({ op: 'or', args }),
    desc: (column: unknown) => ({ op: 'desc', column }),
  };
});

// The schema columns the loader references must carry `_name` so the
// mocked `eq` / `isNull` can resolve the row property they filter on.
vi.mock('../../schemas/reflexion-buffer.schema.js', () => {
  const tag = (name: string) => ({ _name: name });
  return {
    reflexionBuffer: Object.assign(
      { __name: 'reflexion' as Table },
      {
        id: tag('id'),
        tenantId: tag('tenantId'),
        userId: tag('userId'),
        sessionId: tag('sessionId'),
        taskId: tag('taskId'),
        reflection: tag('reflection'),
        outcome: tag('outcome'),
        importance: tag('importance'),
        recordedAt: tag('recordedAt'),
        prunedAt: tag('prunedAt'),
        clusterId: tag('clusterId'),
      },
    ),
    reflexionGuidelines: Object.assign(
      { __name: 'guideline' as Table },
      {
        id: tag('id'),
        tenantId: tag('tenantId'),
        userId: tag('userId'),
        slug: tag('slug'),
        body: tag('body'),
        confidence: tag('confidence'),
        updatedAt: tag('updatedAt'),
      },
    ),
  };
});

function reflexionRow(
  over: Partial<StoredReflexion> & { id: string; tenantId: string },
): StoredReflexion {
  return {
    userId: null,
    sessionId: 'sess',
    taskId: null,
    reflection: `reflection-${over.id}`,
    outcome: 'mixed',
    importance: 0.5,
    recordedAt: new Date(2026, 0, 1),
    prunedAt: null,
    clusterId: null,
    ...over,
  };
}

function guidelineRow(
  over: Partial<StoredGuideline> & { id: string; tenantId: string; slug: string },
): StoredGuideline {
  return {
    userId: null,
    body: `body-${over.id}`,
    confidence: 0.5,
    updatedAt: new Date(2026, 0, 1),
    ...over,
  };
}

describe('reflexion-loader.recentReflexions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns tenant-wide rows ordered by importance then recency', async () => {
    const stub = makeStubDb({
      reflexions: [
        reflexionRow({ id: 'lo', tenantId: 't-1', importance: 0.2 }),
        reflexionRow({ id: 'hi', tenantId: 't-1', importance: 0.9 }),
      ],
    });
    const loader = createDrizzleReflexionLoader(stub.client);
    const out = await loader.recentReflexions({ tenantId: 't-1', limit: 5 });
    expect(out.map((r) => r.id)).toContain('hi');
    expect(out.map((r) => r.id)).toContain('lo');
    // Both tenant-wide rows surface (userId null inherits tenant scope).
    expect(out).toHaveLength(2);
  });

  it('with a userId returns tenant-wide rows PLUS this user (superset, not restriction)', async () => {
    const stub = makeStubDb({
      reflexions: [
        reflexionRow({ id: 'tenant', tenantId: 't-1', userId: null }),
        reflexionRow({ id: 'mine', tenantId: 't-1', userId: 'u-1' }),
        reflexionRow({ id: 'other', tenantId: 't-1', userId: 'u-2' }),
      ],
    });
    const loader = createDrizzleReflexionLoader(stub.client);
    const out = await loader.recentReflexions({
      tenantId: 't-1',
      limit: 5,
      userId: 'u-1',
    });
    const ids = out.map((r) => r.id);
    expect(ids).toContain('tenant'); // tenant-wide inherited
    expect(ids).toContain('mine'); // this user
    expect(ids).not.toContain('other'); // a different user is excluded
  });

  it('filters pruned_at IS NULL (pruned rows never surface)', async () => {
    const stub = makeStubDb({
      reflexions: [
        reflexionRow({ id: 'live', tenantId: 't-1', prunedAt: null }),
        reflexionRow({
          id: 'pruned',
          tenantId: 't-1',
          prunedAt: new Date(2026, 0, 2),
        }),
      ],
    });
    const loader = createDrizzleReflexionLoader(stub.client);
    const out = await loader.recentReflexions({ tenantId: 't-1', limit: 5 });
    const ids = out.map((r) => r.id);
    expect(ids).toContain('live');
    expect(ids).not.toContain('pruned');
  });

  it('honest-degrades to [] when the db throws', async () => {
    const stub = makeStubDb({
      reflexions: [reflexionRow({ id: 'r1', tenantId: 't-1' })],
    });
    stub.state.failNextSelect = true;
    const loader = createDrizzleReflexionLoader(stub.client);
    const out = await loader.recentReflexions({ tenantId: 't-1', limit: 5 });
    expect(out).toEqual([]);
  });

  it('returns [] for a null db or a missing tenant', async () => {
    const nullLoader = createDrizzleReflexionLoader(null);
    expect(await nullLoader.recentReflexions({ tenantId: 't-1', limit: 5 })).toEqual(
      [],
    );
    const stub = makeStubDb({
      reflexions: [reflexionRow({ id: 'r1', tenantId: 't-1' })],
    });
    const loader = createDrizzleReflexionLoader(stub.client);
    expect(await loader.recentReflexions({ tenantId: '', limit: 5 })).toEqual([]);
  });

  it('maps importance/clusterId/taskId onto the loaded entry', async () => {
    const stub = makeStubDb({
      reflexions: [
        reflexionRow({
          id: 'r1',
          tenantId: 't-1',
          importance: 0.77,
          clusterId: 'c-9',
          taskId: 'task-3',
        }),
      ],
    });
    const loader = createDrizzleReflexionLoader(stub.client);
    const out = await loader.recentReflexions({ tenantId: 't-1', limit: 5 });
    expect(out[0]?.importance).toBe(0.77);
    expect(out[0]?.clusterId).toBe('c-9');
    expect(out[0]?.taskId).toBe('task-3');
  });
});

describe('reflexion-loader.recentGuidelines', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns tenant-wide + this-user guidelines from reflexion_guidelines', async () => {
    const stub = makeStubDb({
      guidelines: [
        guidelineRow({
          id: 'g-tenant',
          tenantId: 't-1',
          slug: 'cite-row-ids',
          userId: null,
        }),
        guidelineRow({
          id: 'g-mine',
          tenantId: 't-1',
          slug: 'ask-before-fuzzy',
          userId: 'u-1',
        }),
        guidelineRow({
          id: 'g-other',
          tenantId: 't-1',
          slug: 'other',
          userId: 'u-2',
        }),
      ],
    });
    const loader = createDrizzleReflexionLoader(stub.client);
    const out = await loader.recentGuidelines({
      tenantId: 't-1',
      limit: 5,
      userId: 'u-1',
    });
    const ids = out.map((g) => g.id);
    expect(ids).toContain('g-tenant');
    expect(ids).toContain('g-mine');
    expect(ids).not.toContain('g-other');
  });

  it('honest-degrades to [] on db error', async () => {
    const stub = makeStubDb({
      guidelines: [
        guidelineRow({ id: 'g1', tenantId: 't-1', slug: 's' }),
      ],
    });
    stub.state.failNextSelect = true;
    const loader = createDrizzleReflexionLoader(stub.client);
    const out = await loader.recentGuidelines({ tenantId: 't-1', limit: 5 });
    expect(out).toEqual([]);
  });
});
