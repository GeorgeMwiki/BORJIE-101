/**
 * internal/brain-loopback.hono — the borjie.ask / borjie.cite / documents.*
 * brain-tool loopback.
 *
 * These four tools were BORN DARK (no router at /internal/brain/* or
 * /internal/documents/*), so every call 404'd in prod. This suite proves the
 * routes are now reachable, auth-gated, tenant-bound, and never fabricate:
 *
 *   1. AUTH GATE — no token → 401 on every route.
 *   2. ask returns corpus snippet + REAL evidence ids (empty echo on no match).
 *   3. cite resolves evidence ids → citations (unknown for a missing id).
 *   4. upload-url persists a pending document_uploads row + returns its URL.
 *   5. search returns the tenant's matching documents.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import internalBrainLoopbackRouter from '../brain-loopback.hono.js';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';

// ---------------------------------------------------------------------------
// Chainable Drizzle-builder double. `select()` resolves to `rows`; `insert()`
// records the values it was asked to persist.
// ---------------------------------------------------------------------------

function fakeDb(opts?: {
  selectRows?: ReadonlyArray<Record<string, unknown>>;
  failSelect?: boolean;
  failInsert?: boolean;
}) {
  const inserted: Array<Record<string, unknown>> = [];
  const rows = opts?.selectRows ?? [];
  const selectChain = {
    from() {
      return this;
    },
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    async limit() {
      if (opts?.failSelect) throw new Error('boom-select');
      return rows;
    },
    // Some queries (cite) await the chain directly after `.where()` with no
    // `.limit()` — make the builder thenable so `await chain` resolves rows.
    then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
      if (opts?.failSelect) return reject(new Error('boom-select'));
      return resolve(rows);
    },
  };
  return {
    inserted,
    db: {
      select() {
        return selectChain;
      },
      insert() {
        return {
          values(v: Record<string, unknown>) {
            inserted.push(v);
            return {
              async onConflictDoNothing() {
                if (opts?.failInsert) throw new Error('boom-insert');
                return undefined;
              },
            };
          },
        };
      },
    },
  };
}

function appWith(dbDouble: ReturnType<typeof fakeDb>['db'] | null): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', { loopbackDb: dbDouble ?? undefined } as never);
    await next();
  });
  app.route('/internal/brain', internalBrainLoopbackRouter);
  app.route('/internal/documents', internalBrainLoopbackRouter);
  return app;
}

function bearer(role: UserRole, tenantId = 'tenant_1'): string {
  return `Bearer ${generateToken({
    userId: 'op_1',
    tenantId,
    role: role as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('internal/brain-loopback — auth gate', () => {
  const cases: Array<['POST' | 'GET', string, unknown]> = [
    ['POST', '/internal/brain/ask', { question: 'royalty' }],
    ['POST', '/internal/brain/cite', { evidenceIds: ['ev_1'] }],
    ['POST', '/internal/documents/upload-url', { fileName: 'a.pdf', contentType: 'application/pdf', byteSize: 10 }],
    ['GET', '/internal/documents/search?q=permit', undefined],
  ];
  for (const [method, path, body] of cases) {
    it(`401 without a token: ${method} ${path}`, async () => {
      const res = await appWith(fakeDb().db).request(path, {
        method,
        ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
      });
      expect(res.status).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// ask — corpus-grounded, evidence-carrying
// ---------------------------------------------------------------------------

describe('internal/brain-loopback — ask', () => {
  it('returns the corpus snippet + REAL evidence ids', async () => {
    const { db } = fakeDb({
      selectRows: [
        { id: 'ev_chunk_1', text: 'TZS royalty rate for gold is 6%.', sourceFile: 'tz/mining-act.md' },
      ],
    });
    const res = await appWith(db).request('/internal/brain/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'royalty rate' }),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { answer: string; evidenceIds: string[] };
    expect(body.answer).toContain('royalty rate for gold');
    expect(body.evidenceIds).toEqual(['ev_chunk_1']);
  });

  it('echoes the question with EMPTY evidence on no match — never fabricates', async () => {
    const { db } = fakeDb({ selectRows: [] });
    const res = await appWith(db).request('/internal/brain/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'unknown topic' }),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.OWNER) },
    });
    const body = (await res.json()) as { answer: string; evidenceIds: string[] };
    expect(body.evidenceIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cite — evidence ids → citations
// ---------------------------------------------------------------------------

describe('internal/brain-loopback — cite', () => {
  it('resolves known ids to citations and marks a missing id unknown', async () => {
    const { db } = fakeDb({
      selectRows: [
        { id: 'ev_1', sourceFile: 'tz/eia.md', text: 'EIA is required before extraction.', url: 'https://x/eia' },
      ],
    });
    const res = await appWith(db).request('/internal/brain/cite', {
      method: 'POST',
      body: JSON.stringify({ evidenceIds: ['ev_1', 'ev_missing'] }),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      citations: Array<{ evidenceId: string; title: string; excerpt: string; sourceUri?: string }>;
    };
    const known = body.citations.find((x) => x.evidenceId === 'ev_1');
    const missing = body.citations.find((x) => x.evidenceId === 'ev_missing');
    expect(known?.title).toBe('tz/eia.md');
    expect(known?.sourceUri).toBe('https://x/eia');
    expect(missing?.title).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// upload-url — persists a pending row
// ---------------------------------------------------------------------------

describe('internal/brain-loopback — upload-url', () => {
  it('persists a pending document row scoped to the caller tenant + returns the url', async () => {
    const fixture = fakeDb();
    const res = await appWith(fixture.db).request('/internal/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify({ fileName: 'permit.pdf', contentType: 'application/pdf', byteSize: 2048 }),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.OWNER, 'tenant_xyz') },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploadUrl: string; documentId: string; expiresAt: string };
    expect(body.documentId).toBeTruthy();
    expect(body.uploadUrl).toContain('tenant_xyz');
    // The persisted row is tenant-scoped + pending.
    expect(fixture.inserted).toHaveLength(1);
    expect(fixture.inserted[0]?.tenantId).toBe('tenant_xyz');
    expect(fixture.inserted[0]?.status).toBe('pending_upload');
    expect(fixture.inserted[0]?.fileName).toBe('permit.pdf');
  });

  it('503 when the DB is unwired (never a fabricated URL)', async () => {
    const res = await appWith(null).request('/internal/documents/upload-url', {
      method: 'POST',
      body: JSON.stringify({ fileName: 'permit.pdf', contentType: 'application/pdf', byteSize: 2048 }),
      headers: { 'content-type': 'application/json', authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// search — tenant documents
// ---------------------------------------------------------------------------

describe('internal/brain-loopback — search', () => {
  it('returns the tenant matching documents', async () => {
    const { db } = fakeDb({
      selectRows: [
        { id: 'doc_1', fileName: 'mining-permit.pdf', documentType: 'permit', updatedAt: new Date() },
      ],
    });
    const res = await appWith(db).request('/internal/documents/search?q=permit&limit=5', {
      headers: { authorization: bearer(UserRole.OWNER) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Array<{ documentId: string; title: string }>; totalHits: number };
    expect(body.hits[0]?.documentId).toBe('doc_1');
    expect(body.totalHits).toBe(1);
  });

  it('empty result for an empty query (no scan)', async () => {
    const { db } = fakeDb({ selectRows: [{ id: 'doc_1', fileName: 'x', documentType: 'permit' }] });
    const res = await appWith(db).request('/internal/documents/search', {
      headers: { authorization: bearer(UserRole.OWNER) },
    });
    const body = (await res.json()) as { hits: unknown[]; totalHits: number };
    expect(body.totalHits).toBe(0);
  });
});
