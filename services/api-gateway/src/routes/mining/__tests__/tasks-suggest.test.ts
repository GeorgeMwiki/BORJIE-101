/**
 * Tasks suggest-assignee route + scorer unit tests.
 *
 * Two surfaces under test:
 *   1. The deterministic rules-based scorer (`rulesBasedSuggestPort`)
 *      — pure function, covered with edge cases.
 *   2. The Hono route (`miningTasksSuggestRouter`) — covers auth,
 *      validation, tenant isolation, and port-injection seam.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../../middleware/hono-auth', () => ({
  authMiddleware: async (c: any, next: any) => {
    const ctx = (globalThis as any).__BORJIE_TEST_AUTH__;
    if (!ctx) {
      return c.json({ success: false, error: { code: 'UNAUTHORIZED' } }, 401);
    }
    c.set('auth', ctx);
    await next();
  },
}));

vi.mock('../../../middleware/database', () => ({
  databaseMiddleware: async (c: any, next: any) => {
    const db = (globalThis as any).__BORJIE_TEST_DB__;
    c.set('db', db);
    c.set('repos', {});
    c.set('useMockData', false);
    await next();
  },
}));

vi.mock('drizzle-orm', async (original) => {
  const real = await original<typeof import('drizzle-orm')>();
  const readField = (col: any) => col?.name ?? col?._?.name ?? null;
  return {
    ...real,
    eq: (col: any, value: any) => ({
      __filter: (row: any) => {
        const key = readField(col);
        if (!key) return true;
        return row[snakeToCamel(key)] === value || row[key] === value;
      },
    }),
    and: (...conds: any[]) => ({
      __filter: (row: any) =>
        conds.every((c) => (c?.__filter ? c.__filter(row) : true)),
    }),
    or: (...conds: any[]) => ({
      __filter: (row: any) =>
        conds.some((c) => (c?.__filter ? c.__filter(row) : false)),
    }),
    desc: (col: any) => col,
  };
});

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

import { Hono } from 'hono';
import {
  miningTasksSuggestRouter,
  rulesBasedSuggestPort,
  setSuggestPortForTesting,
  resetSuggestPortForTesting,
  type SuggestAssigneePort,
} from '../tasks-suggest.hono';

// ---------------------------------------------------------------------------
// Multi-table fake db keyed by table name (tasks, employees, attendance)
// ---------------------------------------------------------------------------

function getTableName(table: any): string {
  for (const sym of Object.getOwnPropertySymbols(table)) {
    if (sym.toString().includes('drizzle:Name') || sym.toString().includes('Name')) {
      const v = (table as any)[sym];
      if (typeof v === 'string') return v;
    }
  }
  return (table as any)?._?.name ?? '';
}

function createFakeDb(seed: Record<string, any[]>) {
  const store = new Map<string, any[]>();
  for (const [name, rows] of Object.entries(seed)) {
    store.set(name, [...rows]);
  }
  return {
    select() {
      return {
        from(table: any) {
          const name = getTableName(table);
          const rows = store.get(name) ?? [];
          return {
            where(condition: any) {
              const filterFn = (condition as any).__filter ?? (() => true);
              return {
                orderBy() {
                  return {
                    limit() {
                      return Promise.resolve(rows.filter(filterFn));
                    },
                  };
                },
                limit() {
                  return Promise.resolve(rows.filter(filterFn));
                },
              };
            },
          };
        },
      };
    },
  };
}

const TENANT_ID = 'tenant-001';
const MANAGER_ID = 'user-mgr';
const VALID_UUID = '33333333-3333-4333-8333-333333333333';

function setAuth() {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: MANAGER_ID,
    tenantId: TENANT_ID,
    role: 'manager',
    permissions: [],
    propertyAccess: ['*'],
  };
}

function clearAuth() {
  (globalThis as any).__BORJIE_TEST_AUTH__ = undefined;
}

function setDb(db: any) {
  (globalThis as any).__BORJIE_TEST_DB__ = db;
}

function buildApp() {
  const app = new Hono();
  app.route('/', miningTasksSuggestRouter);
  return app;
}

// ---------------------------------------------------------------------------
// 1. Pure scorer tests
// ---------------------------------------------------------------------------

describe('rulesBasedSuggestPort', () => {
  it('returns null userId + 0 confidence when no candidates', () => {
    const out = rulesBasedSuggestPort.rank({
      task: { siteId: null, attributes: {} } as any,
      candidates: [],
    });
    expect(out.userId).toBeNull();
    expect(out.confidence).toBe(0);
    expect(out.top).toEqual([]);
    expect(out.reasoning.sw).toContain('Hakuna');
  });

  it('ranks cert-match + same-site + no-conflict + low-fatigue at the top', () => {
    const task = {
      siteId: 'site-A',
      attributes: { requiredCertification: 'excavator' },
    } as any;
    const candidates = [
      {
        employee: {
          id: 'e-low',
          userId: 'u-low',
          attributes: { certifications: [] },
        } as any,
        lastAttendance: null,
        hasActiveShiftNow: false,
        fatigueScore: 0.9,
      },
      {
        employee: {
          id: 'e-best',
          userId: 'u-best',
          attributes: { certifications: ['excavator'] },
        } as any,
        lastAttendance: { siteId: 'site-A' } as any,
        hasActiveShiftNow: false,
        fatigueScore: 0.1,
      },
    ];
    const out = rulesBasedSuggestPort.rank({ task, candidates });
    expect(out.userId).toBe('u-best');
    expect(out.confidence).toBeGreaterThan(0.85);
    expect(out.top[0].userId).toBe('u-best');
  });

  it('clamps confidence at 1 and never returns NaN', () => {
    const task = {
      siteId: 'site-A',
      attributes: { requiredCertification: 'haul' },
    } as any;
    const candidates = [
      {
        employee: {
          id: 'e1',
          userId: 'u1',
          attributes: { certifications: ['haul'] },
        } as any,
        lastAttendance: { siteId: 'site-A' } as any,
        hasActiveShiftNow: false,
        fatigueScore: 0,
      },
    ];
    const out = rulesBasedSuggestPort.rank({ task, candidates });
    expect(out.confidence).toBeLessThanOrEqual(1);
    expect(out.confidence).toBeGreaterThan(0);
    expect(Number.isNaN(out.confidence)).toBe(false);
  });

  it('produces bilingual reasoning strings (sw + en)', () => {
    const task = {
      siteId: 'site-A',
      attributes: { requiredCertification: 'haul' },
    } as any;
    const candidates = [
      {
        employee: {
          id: 'e1',
          userId: 'u1',
          attributes: { certifications: ['haul'] },
        } as any,
        lastAttendance: { siteId: 'site-A' } as any,
        hasActiveShiftNow: false,
        fatigueScore: 0.1,
      },
    ];
    const out = rulesBasedSuggestPort.rank({ task, candidates });
    expect(out.reasoning.sw.length).toBeGreaterThan(0);
    expect(out.reasoning.en.length).toBeGreaterThan(0);
    expect(out.reasoning.sw).not.toBe(out.reasoning.en);
  });

  it('returns top-3 ranking even when more than 3 candidates exist', () => {
    const task = { siteId: 'site-A', attributes: {} } as any;
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      employee: {
        id: `e${i}`,
        userId: `u${i}`,
        attributes: { certifications: [] },
      } as any,
      lastAttendance: null,
      hasActiveShiftNow: i % 2 === 0,
      fatigueScore: i / 6,
    }));
    const out = rulesBasedSuggestPort.rank({ task, candidates });
    expect(out.top).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Route tests
// ---------------------------------------------------------------------------

describe('mining tasks-suggest router', () => {
  beforeEach(() => {
    clearAuth();
    setDb(undefined);
    resetSuggestPortForTesting();
  });

  it('rejects unauthenticated requests with 401', async () => {
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/suggest-assignee`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 when task does not exist', async () => {
    setAuth();
    setDb(createFakeDb({ tasks: [], employees: [], attendance: [] }));
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/suggest-assignee`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('returns suggestion data for valid task using rules port', async () => {
    setAuth();
    setDb(
      createFakeDb({
        tasks: [
          {
            id: VALID_UUID,
            tenantId: TENANT_ID,
            siteId: 'site-A',
            attributes: { requiredCertification: 'excavator' },
            status: 'open',
          },
        ],
        employees: [
          {
            id: 'emp-1',
            userId: 'user-1',
            tenantId: TENANT_ID,
            siteId: 'site-A',
            status: 'active',
            attributes: { certifications: ['excavator'] },
          },
        ],
        attendance: [],
      }),
    );
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/suggest-assignee`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { userId: string; confidence: number; reasoning: { sw: string; en: string } };
    };
    expect(body.success).toBe(true);
    expect(body.data.userId).toBe('user-1');
    expect(body.data.confidence).toBeGreaterThan(0);
    expect(body.data.reasoning.sw.length).toBeGreaterThan(0);
  });

  it('respects port injection — custom scorer is used when injected', async () => {
    setAuth();
    setDb(
      createFakeDb({
        tasks: [
          {
            id: VALID_UUID,
            tenantId: TENANT_ID,
            siteId: null,
            attributes: {},
            status: 'open',
          },
        ],
        employees: [],
        attendance: [],
      }),
    );
    const llmPort: SuggestAssigneePort = {
      rank: () => ({
        userId: 'llm-pick',
        confidence: 0.99,
        reasoning: { sw: 'llm', en: 'llm' },
        top: [
          {
            userId: 'llm-pick',
            confidence: 0.99,
            reasoning: { sw: 'llm', en: 'llm' },
          },
        ],
      }),
    };
    setSuggestPortForTesting(llmPort);
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/suggest-assignee`, {
      method: 'POST',
    });
    const body = (await res.json()) as { data: { userId: string; confidence: number } };
    expect(body.data.userId).toBe('llm-pick');
    expect(body.data.confidence).toBeCloseTo(0.99);
  });

  it('RLS: task in another tenant is not visible (404)', async () => {
    setAuth();
    setDb(
      createFakeDb({
        tasks: [
          {
            id: VALID_UUID,
            tenantId: 'OTHER-TENANT',
            siteId: 'site-A',
            attributes: {},
            status: 'open',
          },
        ],
        employees: [],
        attendance: [],
      }),
    );
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/suggest-assignee`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('returns top-3 candidates even when zero are good matches', async () => {
    setAuth();
    setDb(
      createFakeDb({
        tasks: [
          {
            id: VALID_UUID,
            tenantId: TENANT_ID,
            siteId: 'site-A',
            attributes: { requiredCertification: 'shotfirer' },
            status: 'open',
          },
        ],
        employees: [
          {
            id: 'e1',
            userId: 'u1',
            tenantId: TENANT_ID,
            siteId: 'site-A',
            status: 'active',
            attributes: { certifications: [] },
          },
          {
            id: 'e2',
            userId: 'u2',
            tenantId: TENANT_ID,
            siteId: 'site-A',
            status: 'active',
            attributes: { certifications: [] },
          },
        ],
        attendance: [],
      }),
    );
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}/suggest-assignee`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { top: any[] } };
    expect(body.data.top.length).toBeGreaterThan(0);
    expect(body.data.top.length).toBeLessThanOrEqual(3);
  });
});
