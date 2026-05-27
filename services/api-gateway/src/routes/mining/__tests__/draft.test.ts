/**
 * Document drafter route tests.
 *
 * Mounts the real router against a fake Drizzle client + injected
 * auth context (same pattern as `escalations.test.ts`). Tests cover:
 *   - auth gate (401)
 *   - validation (400)
 *   - happy-path create
 *   - revision chain (parent_draft_id, revision_count bump)
 *   - finalize lifecycle + revise-after-finalize conflict
 *   - render endpoint emits a base64 PDF
 *   - tenant isolation (cross-tenant id miss → 404)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Middleware stubs — must hoist BEFORE importing the router.
// ---------------------------------------------------------------------------
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
    desc: (col: any) => col,
  };
});

import { Hono } from 'hono';
import { miningDraftsRouter } from '../draft.hono';

// ---------------------------------------------------------------------------
// Fake Drizzle client
// ---------------------------------------------------------------------------

function createFakeDb(initial: any[] = []) {
  let rows: any[] = [...initial];
  const api = {
    rows: () => rows,
    setRows: (next: any[]) => {
      rows = next;
    },
    select() {
      return {
        from() {
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
    insert() {
      return {
        values(input: any) {
          const next = Array.isArray(input) ? input : [input];
          return {
            returning() {
              const created = next.map((row) => ({
                id:
                  row.id ??
                  `00000000-0000-4000-8000-${Math.random()
                    .toString(16)
                    .slice(2, 14)
                    .padStart(12, '0')}`,
                hashChainId: null,
                createdAt: new Date(),
                lastRevisedAt: row.lastRevisedAt ?? new Date(),
                revisionCount: row.revisionCount ?? 1,
                status: row.status ?? 'drafting',
                language: row.language ?? 'sw',
                titleEn: row.titleEn ?? null,
                jurisdiction: row.jurisdiction ?? 'TZ',
                parentDraftId: row.parentDraftId ?? null,
                ...row,
              }));
              rows = [...rows, ...created];
              return Promise.resolve(created);
            },
          };
        },
      };
    },
    update() {
      return {
        set(patch: any) {
          return {
            where(condition: any) {
              const filterFn = (condition as any).__filter ?? (() => true);
              return {
                returning() {
                  const updated: any[] = [];
                  rows = rows.map((row) => {
                    if (filterFn(row)) {
                      const merged = { ...row, ...patch };
                      updated.push(merged);
                      return merged;
                    }
                    return row;
                  });
                  return Promise.resolve(updated);
                },
              };
            },
          };
        },
      };
    },
  };
  return api;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, ch) => ch.toUpperCase());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TENANT_ID = 'tenant-001';
const USER_ID = 'user-1';
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function setAuth(overrides: Partial<{ userId: string; tenantId: string; role: string }> = {}) {
  (globalThis as any).__BORJIE_TEST_AUTH__ = {
    userId: overrides.userId ?? USER_ID,
    tenantId: overrides.tenantId ?? TENANT_ID,
    role: overrides.role ?? 'owner',
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
  app.route('/', miningDraftsRouter);
  return app;
}

async function postJson(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('mining drafts router — auth gate', () => {
  beforeEach(() => {
    clearAuth();
    setDb(createFakeDb());
  });

  it('rejects unauthenticated GET / with 401', async () => {
    const app = buildApp();
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated POST / with 401', async () => {
    const app = buildApp();
    const res = await postJson(app, '/', { kind: 'memo', templateSlug: 'memo.internal' });
    expect(res.status).toBe(401);
  });
});

describe('mining drafts router — POST /', () => {
  beforeEach(() => {
    clearAuth();
    setDb(createFakeDb());
  });

  it('returns 400 when the body is missing required fields', async () => {
    setAuth();
    const app = buildApp();
    const res = await postJson(app, '/', { kind: 'memo' });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when templateSlug is unknown', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await postJson(app, '/', {
      kind: 'contract',
      templateSlug: 'contract.does-not-exist',
      language: 'sw',
      titleSw: 'X',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('COMPOSE_FAILED');
  });

  it('happy path: creates a draft', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await postJson(app, '/', {
      kind: 'memo',
      templateSlug: 'memo.internal',
      language: 'en',
      titleSw: 'Pit safety memo',
      titleEn: 'Pit safety memo',
      fillVars: {
        tenantName: 'Acme Mining',
        fromName: 'Mwikila',
        fromRole: 'Founder',
        toName: 'Manager',
        toRole: 'Operations',
        memoDate: '2026-05-27',
        memoReference: 'MEMO-1',
        memoSubject: 'Pit safety',
      },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      success: boolean;
      data: { id: string; status: string; revisionCount: number };
    };
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('drafting');
    expect(json.data.revisionCount).toBe(1);
  });
});

describe('mining drafts router — GET /:id', () => {
  beforeEach(() => {
    clearAuth();
    setDb(createFakeDb());
  });

  it('returns 400 on invalid uuid', async () => {
    setAuth();
    const app = buildApp();
    const res = await app.request('/not-a-uuid', { method: 'GET' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    setAuth();
    setDb(createFakeDb());
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('returns 404 across tenants (tenant isolation)', async () => {
    setAuth({ tenantId: 'tenantA' });
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: 'tenantB',
          createdByUserId: USER_ID,
          kind: 'memo',
          status: 'drafting',
          titleSw: 'X',
          contentMd: 'X',
          sourceTemplateSlug: 'memo.internal',
          language: 'en',
          revisionCount: 1,
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}`, { method: 'GET' });
    expect(res.status).toBe(404);
  });

  it('fetches an existing draft', async () => {
    setAuth();
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          createdByUserId: USER_ID,
          kind: 'memo',
          status: 'drafting',
          titleSw: 'Memo',
          contentMd: '# Memo',
          sourceTemplateSlug: 'memo.internal',
          language: 'en',
          revisionCount: 1,
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const res = await app.request(`/${VALID_UUID}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string } };
    expect(json.data.id).toBe(VALID_UUID);
  });
});

describe('mining drafts router — revise + finalize', () => {
  beforeEach(() => {
    clearAuth();
    setDb(createFakeDb());
  });

  it('POST /:id/revise creates a child revision with bumped count', async () => {
    setAuth();
    const db = createFakeDb([
      {
        id: VALID_UUID,
        tenantId: TENANT_ID,
        createdByUserId: USER_ID,
        kind: 'memo',
        status: 'drafting',
        titleSw: 'Memo',
        contentMd: '# Memo',
        sourceTemplateSlug: 'memo.internal',
        language: 'en',
        revisionCount: 1,
        createdAt: new Date(),
      },
    ]);
    setDb(db);
    const app = buildApp();
    const res = await postJson(app, `/${VALID_UUID}/revise`, {
      revisionInstruction: 'Tighten paragraph 2.',
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { parentDraftId: string; revisionCount: number };
    };
    expect(json.data.parentDraftId).toBe(VALID_UUID);
    expect(json.data.revisionCount).toBe(2);
    expect(db.rows()).toHaveLength(2);
  });

  it('POST /:id/finalize locks the draft, subsequent revise returns 409', async () => {
    setAuth();
    const db = createFakeDb([
      {
        id: VALID_UUID,
        tenantId: TENANT_ID,
        createdByUserId: USER_ID,
        kind: 'memo',
        status: 'drafting',
        titleSw: 'Memo',
        contentMd: '# Memo',
        sourceTemplateSlug: 'memo.internal',
        language: 'en',
        revisionCount: 1,
        createdAt: new Date(),
      },
    ]);
    setDb(db);
    const app = buildApp();
    const finalizeRes = await postJson(app, `/${VALID_UUID}/finalize`, {});
    expect(finalizeRes.status).toBe(200);
    const finalized = (await finalizeRes.json()) as { data: { status: string } };
    expect(finalized.data.status).toBe('finalized');

    const reviseRes = await postJson(app, `/${VALID_UUID}/revise`, {
      revisionInstruction: 'Tighten everything.',
    });
    expect(reviseRes.status).toBe(409);
  });

  it('POST /:id/revise rejects empty instruction', async () => {
    setAuth();
    const db = createFakeDb([
      {
        id: VALID_UUID,
        tenantId: TENANT_ID,
        createdByUserId: USER_ID,
        kind: 'memo',
        status: 'drafting',
        titleSw: 'Memo',
        contentMd: '# Memo',
        sourceTemplateSlug: 'memo.internal',
        language: 'en',
        revisionCount: 1,
        createdAt: new Date(),
      },
    ]);
    setDb(db);
    const app = buildApp();
    const res = await postJson(app, `/${VALID_UUID}/revise`, {
      revisionInstruction: '',
    });
    expect(res.status).toBe(400);
  });
});

describe('mining drafts router — POST /:id/render', () => {
  beforeEach(() => {
    clearAuth();
    setDb(createFakeDb());
  });

  it('renders the draft and returns a base64 PDF data URL', async () => {
    setAuth();
    setDb(
      createFakeDb([
        {
          id: VALID_UUID,
          tenantId: TENANT_ID,
          createdByUserId: USER_ID,
          kind: 'memo',
          status: 'drafting',
          titleSw: 'Memo',
          contentMd: '# Memo\nBody.',
          sourceTemplateSlug: 'memo.internal',
          language: 'en',
          revisionCount: 1,
          createdAt: new Date(),
        },
      ]),
    );
    const app = buildApp();
    const res = await postJson(app, `/${VALID_UUID}/render`, {});
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { pdfDataUrl: string; byteLength: number; draftId: string };
    };
    expect(json.data.pdfDataUrl.startsWith('data:application/pdf;base64,')).toBe(true);
    expect(json.data.byteLength).toBeGreaterThan(100);
    // Decode and check PDF magic.
    const base64 = json.data.pdfDataUrl.split(',')[1] ?? '';
    const buf = Buffer.from(base64, 'base64');
    expect(buf.slice(0, 4).toString()).toBe('%PDF');
  });
});
