/**
 * Unit tests for createSemanticMemoryService.
 *
 * Mocks the Drizzle DatabaseClient with an in-memory store and the
 * minimum subset of drizzle-orm operators the service uses
 * (eq, isNull, like, sql, desc, and). Tests cover:
 *
 *   1. upsertFact inserts a new (tenant, user, key) tuple
 *   2. upsertFact UPDATES the existing row + bumps evidence_count when
 *      the same (tenant, user, key) is re-inserted
 *   3. lookup returns null when no row matches
 *   4. lookup returns the matched row's value + confidence
 *   5. search with prefix returns rows whose key starts with the prefix
 *   6. decay multiplies confidence and returns the rows-touched count
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSemanticMemoryService } from './kernel-memory-semantic.service.js';
import type { DatabaseClient } from '../client.js';

interface StoredRow {
  id: string;
  tenantId: string | null;
  userId: string | null;
  key: string;
  value: unknown;
  confidence: number;
  sourceTurnId: string | null;
  evidenceCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  expiresAt: Date | null;
  source: string;
}

interface CapturedFilter {
  tenantId?: string;
  userIdEq?: string;
  userIdIsNull?: boolean;
  key?: string;
  prefix?: string;
}

const captured: { current: CapturedFilter; updateExpr?: { factor: number } } = {
  current: {},
};

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'tenant_id') captured.current.tenantId = String(value);
      else if (colName === 'user_id') captured.current.userIdEq = String(value);
      else if (colName === 'key') captured.current.key = String(value);
      return { _op: 'eq', col: colName, value };
    },
    isNull: (column: { name?: string }) => {
      const colName = String(column?.name ?? '');
      if (colName === 'user_id') captured.current.userIdIsNull = true;
      return { _op: 'isNull', col: colName };
    },
    like: (column: { name?: string }, value: unknown) => {
      const colName = String(column?.name ?? '');
      if (colName === 'key') {
        // service formats "<prefix>%" — strip trailing %.
        const v = String(value);
        captured.current.prefix = v.endsWith('%') ? v.slice(0, -1) : v;
      }
      return { _op: 'like', col: colName, value };
    },
    desc: (column: unknown) => ({ _op: 'desc', column }),
    and: (...args: unknown[]) => ({ _op: 'and', args }),
    sql: Object.assign(
      (strings: TemplateStringsArray, ...vals: unknown[]) => {
        // Capture the decay factor — strings.join('') is something like
        // "${col} * ${factor}" with the factor as a runtime value.
        const last = vals[vals.length - 1];
        if (typeof last === 'number' && Number.isFinite(last) && last <= 1) {
          captured.updateExpr = { factor: last };
        }
        return { _sql: strings.join('') };
      },
      { raw: (s: string) => ({ _sql: s }) },
    ),
  };
});

function makeStubDb(initial: ReadonlyArray<StoredRow> = []): {
  client: DatabaseClient;
  readonly rows: StoredRow[];
} {
  const state = { rows: [...initial] };

  function applyFilter(rows: StoredRow[]): StoredRow[] {
    const f = captured.current;
    let out = [...rows];
    if (f.tenantId !== undefined) {
      out = out.filter((r) => r.tenantId === f.tenantId);
    }
    if (f.userIdIsNull) {
      out = out.filter((r) => r.userId === null);
    } else if (f.userIdEq !== undefined) {
      out = out.filter((r) => r.userId === f.userIdEq);
    }
    if (f.key !== undefined) {
      out = out.filter((r) => r.key === f.key);
    }
    if (f.prefix !== undefined) {
      out = out.filter((r) => r.key.startsWith(f.prefix!));
    }
    return out;
  }

  function makeSelectChain(): unknown {
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (rows: unknown) => unknown) => {
        const rows = applyFilter(state.rows);
        rows.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
        captured.current = {};
        return resolve(rows);
      },
    };
    return chain;
  }

  function makeInsertChain(): unknown {
    const chain: Record<string, unknown> = {
      _values: null as Partial<StoredRow> | null,
      values: (v: Partial<StoredRow>) => {
        chain._values = v;
        return chain;
      },
      onConflictDoUpdate: (cfg: { set: Partial<StoredRow> }) => {
        const v = (chain._values ?? {}) as Partial<StoredRow>;
        const tenantId = (v.tenantId ?? null) as string | null;
        const userId = (v.userId ?? null) as string | null;
        const key = String(v.key ?? '');
        const existing = state.rows.find(
          (r) =>
            r.tenantId === tenantId && r.userId === userId && r.key === key,
        );
        if (existing) {
          // Apply the SET clauses we understand: value, confidence,
          // sourceTurnId, source. evidenceCount uses sql, so we bump
          // it by 1 to mirror the service's intent. lastSeenAt → now.
          if ('value' in cfg.set) existing.value = cfg.set.value;
          if ('confidence' in cfg.set) {
            existing.confidence = Number(cfg.set.confidence ?? 0);
          }
          if ('sourceTurnId' in cfg.set) {
            existing.sourceTurnId =
              (cfg.set.sourceTurnId ?? null) as string | null;
          }
          if ('source' in cfg.set) {
            existing.source = String(cfg.set.source ?? 'extracted');
          }
          existing.evidenceCount += 1;
          existing.lastSeenAt = new Date();
        } else {
          state.rows.push({
            id: String(v.id ?? `r_${state.rows.length}`),
            tenantId,
            userId,
            key,
            value: v.value,
            confidence: Number(v.confidence ?? 0.5),
            sourceTurnId: (v.sourceTurnId ?? null) as string | null,
            evidenceCount: Number(v.evidenceCount ?? 1),
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
            expiresAt: null,
            source: String(v.source ?? 'extracted'),
          });
        }
        return chain;
      },
      then: (resolve: (rows: unknown) => unknown) => resolve(undefined),
    };
    return chain;
  }

  function makeUpdateChain(): unknown {
    const chain: Record<string, unknown> = {
      _setApplied: false,
      set: (_args: unknown) => chain,
      where: () => chain,
      returning: () => ({
        then: (resolve: (rows: unknown) => unknown) => {
          const factor = captured.updateExpr?.factor;
          const target = applyFilter(state.rows);
          if (typeof factor === 'number') {
            for (const row of target) {
              row.confidence = row.confidence * factor;
            }
          }
          captured.updateExpr = undefined;
          captured.current = {};
          return resolve(target.map((r) => ({ id: r.id })));
        },
      }),
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => makeSelectChain(),
    insert: () => makeInsertChain(),
    update: () => makeUpdateChain(),
  };
  const result = { client: db as unknown as DatabaseClient } as {
    client: DatabaseClient;
    readonly rows: StoredRow[];
  };
  Object.defineProperty(result, 'rows', { get: () => state.rows });
  return result;
}

describe('createSemanticMemoryService', () => {
  beforeEach(() => {
    captured.current = {};
    captured.updateExpr = undefined;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('upsertFact inserts a new (tenant, user, key) row', async () => {
    const stub = makeStubDb();
    const svc = createSemanticMemoryService(stub.client);

    await svc.upsertFact({
      tenantId: 't_demo',
      userId: 'u_alice',
      key: 'language.preferred',
      value: 'sw',
      confidence: 0.8,
      source: 'declared',
    });

    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.key).toBe('language.preferred');
    expect(stub.rows[0]?.value).toBe('sw');
    expect(stub.rows[0]?.confidence).toBeCloseTo(0.8);
    expect(stub.rows[0]?.evidenceCount).toBe(1);
    expect(stub.rows[0]?.source).toBe('declared');
  });

  it('upsertFact UPDATES the existing row + bumps evidence_count', async () => {
    const stub = makeStubDb();
    const svc = createSemanticMemoryService(stub.client);

    await svc.upsertFact({
      tenantId: 't_demo',
      userId: 'u_alice',
      key: 'tone.preferred',
      value: 'warm',
      confidence: 0.6,
    });
    await svc.upsertFact({
      tenantId: 't_demo',
      userId: 'u_alice',
      key: 'tone.preferred',
      value: 'warm',
      confidence: 0.7,
    });

    expect(stub.rows).toHaveLength(1);
    expect(stub.rows[0]?.confidence).toBeCloseTo(0.7);
    expect(stub.rows[0]?.evidenceCount).toBe(2);
  });

  it('lookup returns null when no row matches', async () => {
    const stub = makeStubDb();
    const svc = createSemanticMemoryService(stub.client);

    const out = await svc.lookup({
      tenantId: 't_demo',
      userId: 'u_alice',
      key: 'unknown.fact',
    });

    expect(out).toBeNull();
  });

  it('lookup returns the matched fact for a (tenant, user, key) tuple', async () => {
    const stub = makeStubDb([
      {
        id: 'r1',
        tenantId: 't_demo',
        userId: 'u_alice',
        key: 'language.preferred',
        value: 'sw',
        confidence: 0.85,
        sourceTurnId: 'tu_1',
        evidenceCount: 3,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: null,
        source: 'declared',
      },
    ]);
    const svc = createSemanticMemoryService(stub.client);

    const out = await svc.lookup({
      tenantId: 't_demo',
      userId: 'u_alice',
      key: 'language.preferred',
    });

    expect(out).not.toBeNull();
    expect(out?.value).toBe('sw');
    expect(out?.confidence).toBeCloseTo(0.85);
    expect(out?.evidenceCount).toBe(3);
    expect(out?.source).toBe('declared');
  });

  it('search with prefix returns only rows whose key starts with the prefix', async () => {
    const now = new Date();
    const stub = makeStubDb([
      {
        id: 'r1',
        tenantId: 't_demo',
        userId: 'u_alice',
        key: 'language.preferred',
        value: 'sw',
        confidence: 0.9,
        sourceTurnId: null,
        evidenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        expiresAt: null,
        source: 'extracted',
      },
      {
        id: 'r2',
        tenantId: 't_demo',
        userId: 'u_alice',
        key: 'tone.preferred',
        value: 'warm',
        confidence: 0.6,
        sourceTurnId: null,
        evidenceCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        expiresAt: null,
        source: 'extracted',
      },
    ]);
    const svc = createSemanticMemoryService(stub.client);

    const out = await svc.search({
      tenantId: 't_demo',
      userId: 'u_alice',
      prefix: 'language.',
      limit: 10,
    });

    expect(out).toHaveLength(1);
    expect(out[0]?.key).toBe('language.preferred');
  });

  it('decay multiplies confidence by the per-day factor and reports rows touched', async () => {
    const stub = makeStubDb([
      {
        id: 'r1',
        tenantId: 't_demo',
        userId: 'u_alice',
        key: 'a.b',
        value: 1,
        confidence: 1.0,
        sourceTurnId: null,
        evidenceCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: null,
        source: 'extracted',
      },
      {
        id: 'r2',
        tenantId: 't_demo',
        userId: 'u_alice',
        key: 'c.d',
        value: 2,
        confidence: 0.4,
        sourceTurnId: null,
        evidenceCount: 1,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: null,
        source: 'extracted',
      },
    ]);
    const svc = createSemanticMemoryService(stub.client);

    const touched = await svc.decay({ tenantId: 't_demo', decayPerDay: 0.5 });

    expect(touched).toBe(2);
    const a = stub.rows.find((r) => r.key === 'a.b');
    const c = stub.rows.find((r) => r.key === 'c.d');
    expect(a?.confidence).toBeCloseTo(0.5);
    expect(c?.confidence).toBeCloseTo(0.2);
  });
});
