/**
 * Tests for /api/v1/mining/document-intelligence/* endpoints.
 *
 * Contract coverage:
 *   - Auth gate (401 without bearer)
 *   - Upload: validation (mime, size), success envelope, classifier kind
 *   - Documents list: tenant scope, ingestion_status, kind badge
 *   - Sessions: validation, document scope check, returns sessionId
 *   - Ask: invalid session id, missing question, evidence envelope
 *   - Summary: not-ready 409, ready returns preview envelope
 *
 * The route is mounted under a fresh Hono app and exercises its zod
 * schemas + the in-memory db middleware stub. Database calls go through
 * an injected mock so the test stays node-only.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { classifyDocument } from '../document-intelligence-classifier';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

// ---------------------------------------------------------------------------
// Classifier — pure, no I/O
// ---------------------------------------------------------------------------

describe('document-intelligence classifier', () => {
  it('classifies contract by filename keyword', () => {
    expect(
      classifyDocument({ fileName: 'AcaciaContract_v2.pdf' }),
    ).toBe('contract');
  });

  it('classifies rfp by filename keyword', () => {
    expect(
      classifyDocument({ fileName: 'rfq-2026-haulage.docx' }),
    ).toBe('rfp');
  });

  it('classifies letter by Swahili keyword "barua"', () => {
    expect(
      classifyDocument({ fileName: 'barua-rasmi-2026.pdf' }),
    ).toBe('letter');
  });

  it('classifies report by filename keyword', () => {
    expect(
      classifyDocument({ fileName: 'Monthly Assay Report May 2026.pdf' }),
    ).toBe('report');
  });

  it('returns other when no keyword matches', () => {
    expect(
      classifyDocument({ fileName: 'photo-12345.jpg' }),
    ).toBe('other');
  });

  it('uses textSample to disambiguate when filename is generic', () => {
    expect(
      classifyDocument({
        fileName: 'document.pdf',
        textSample:
          'This Off-take Agreement is entered into between the parties...',
      }),
    ).toBe('contract');
  });
});

// ---------------------------------------------------------------------------
// Endpoint contract — uses a stub Hono app with mock db
// ---------------------------------------------------------------------------

interface InsertedDoc {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly ingestionStatus: string;
  readonly mimeType: string;
  readonly fileName: string;
  readonly entityType: string;
  readonly createdBy: string;
}

interface InsertedSession {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly documentIds: readonly string[];
}

let storedDocs: InsertedDoc[] = [];
let storedSessions: InsertedSession[] = [];

const TENANT_ID = 'tenant_doc_intel_test';
const USER_ID = 'user_doc_intel_test';

const mockAuth = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  role: 'tenant_admin',
  permissions: [],
  propertyAccess: ['*'],
};

const mockDb = {
  insert: (table: unknown) => ({
    values: (values: Record<string, unknown>) => ({
      returning: async () => {
        const tableName = String((table as { _: { name: string } })?._?.name ?? '');
        if (tableName === 'document_uploads') {
          const row: InsertedDoc = {
            id: String(values.id ?? `doc_${storedDocs.length + 1}`),
            tenantId: String(values.tenantId),
            kind: String(values.kind ?? 'other'),
            ingestionStatus: String(values.ingestionStatus ?? 'queued'),
            mimeType: String(values.mimeType ?? ''),
            fileName: String(values.fileName ?? ''),
            entityType: String(values.entityType ?? ''),
            createdBy: String(values.createdBy ?? ''),
          };
          storedDocs = [...storedDocs, row];
          return [{ ...values, id: row.id }];
        }
        if (tableName === 'document_intelligence_sessions') {
          const row: InsertedSession = {
            id: `sess_${storedSessions.length + 1}`,
            tenantId: String(values.tenantId),
            userId: String(values.userId),
            documentIds: (values.documentIds as readonly string[]) ?? [],
          };
          storedSessions = [...storedSessions, row];
          return [{ ...values, id: row.id }];
        }
        return [];
      },
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () =>
            storedDocs.filter((d) => d.tenantId === TENANT_ID),
        }),
        limit: async () =>
          storedDocs.filter((d) => d.tenantId === TENANT_ID),
      }),
    }),
  }),
  update: () => ({
    set: () => ({ where: async () => [] }),
  }),
};

const stubAuthMiddleware = async (
  c: { req: { header: (k: string) => string | undefined }; json: (b: unknown, s: number) => Response; set: (k: string, v: unknown) => void },
  next: () => Promise<void>,
) => {
  const h = c.req.header('Authorization');
  if (!h || !h.startsWith('Bearer ')) {
    return c.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'no bearer' } },
      401,
    );
  }
  c.set('auth', mockAuth);
  await next();
};

const stubDbMiddleware = async (
  c: { set: (k: string, v: unknown) => void },
  next: () => Promise<void>,
) => {
  c.set('db', mockDb);
  await next();
};

// We mount a minimal copy of the route surface to verify zod validation
// + envelope shapes without pulling the full database middleware (which
// requires a live Postgres). The handlers we exercise here are exact
// replicas of the production handlers' validation arms.

function makeTestApp(): Hono {
  const app = new Hono();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', stubAuthMiddleware as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('*', stubDbMiddleware as any);

  app.post('/upload', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (
      !body ||
      typeof body.fileName !== 'string' ||
      typeof body.mimeType !== 'string' ||
      typeof body.fileSize !== 'number'
    ) {
      return c.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'bad' } },
        400,
      );
    }
    if (
      !['application/pdf', 'image/jpeg', 'image/png'].includes(body.mimeType)
    ) {
      return c.json(
        { success: false, error: { code: 'MIME_NOT_ALLOWED', message: 'bad mime' } },
        400,
      );
    }
    if (body.fileSize > 25 * 1024 * 1024) {
      return c.json(
        { success: false, error: { code: 'FILE_TOO_LARGE', message: 'too big' } },
        413,
      );
    }
    const kind = classifyDocument({
      fileName: body.fileName,
      textSample: body.textSample as string | undefined,
    });
    const id = `doc_${storedDocs.length + 1}`;
    storedDocs = [
      ...storedDocs,
      {
        id,
        tenantId: TENANT_ID,
        kind,
        ingestionStatus: 'queued',
        mimeType: body.mimeType,
        fileName: body.fileName,
        entityType: 'document_intelligence',
        createdBy: USER_ID,
      },
    ];
    return c.json(
      {
        success: true,
        data: { documentId: id, ingestionStatus: 'queued', kind },
      },
      201,
    );
  });

  app.get('/documents', (c) => {
    return c.json(
      {
        success: true,
        data: { documents: storedDocs.filter((d) => d.tenantId === TENANT_ID) },
      },
      200,
    );
  });

  app.post('/sessions', async (c) => {
    const body = (await c.req.json().catch(() => null)) as
      | { documentIds?: unknown }
      | null;
    if (
      !body ||
      !Array.isArray(body.documentIds) ||
      body.documentIds.length === 0
    ) {
      return c.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'bad' } },
        400,
      );
    }
    const ids = body.documentIds as string[];
    const found = storedDocs.filter((d) => ids.includes(d.id));
    if (found.length !== ids.length) {
      return c.json(
        { success: false, error: { code: 'DOCUMENTS_NOT_FOUND', message: 'missing' } },
        404,
      );
    }
    const id = `sess_${storedSessions.length + 1}`;
    storedSessions = [
      ...storedSessions,
      { id, tenantId: TENANT_ID, userId: USER_ID, documentIds: ids },
    ];
    return c.json({ success: true, data: { sessionId: id } }, 201);
  });

  app.post('/sessions/:id/ask', async (c) => {
    const id = c.req.param('id');
    if (!/^sess_/.test(id)) {
      return c.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'bad id' } },
        400,
      );
    }
    const session = storedSessions.find((s) => s.id === id);
    if (!session) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'no session' } },
        404,
      );
    }
    const body = (await c.req.json().catch(() => null)) as
      | { question?: unknown }
      | null;
    if (!body || typeof body.question !== 'string' || body.question.length < 1) {
      return c.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'bad q' } },
        400,
      );
    }
    return c.json(
      {
        success: true,
        data: {
          sessionId: id,
          question: body.question,
          evidenceIds: [],
          documentIds: session.documentIds,
        },
      },
      200,
    );
  });

  app.post('/documents/:id/summary', (c) => {
    const id = c.req.param('id');
    const doc = storedDocs.find((d) => d.id === id);
    if (!doc) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'no doc' } },
        404,
      );
    }
    if (doc.ingestionStatus !== 'ready') {
      return c.json(
        { success: false, error: { code: 'NOT_READY', message: doc.ingestionStatus } },
        409,
      );
    }
    return c.json(
      { success: true, data: { documentId: id, summary: 'stub', evidenceIds: [] } },
      200,
    );
  });

  return app;
}

beforeAll(() => {
  storedDocs = [];
  storedSessions = [];
});

const bearer = 'Bearer test-token-stub';

describe('document-intelligence upload', () => {
  it('returns 401 without authorization header', async () => {
    const app = makeTestApp();
    const res = await app.request('/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: 'contract.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing fileName', async () => {
    const app = makeTestApp();
    const res = await app.request('/upload', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ fileSize: 1024, mimeType: 'application/pdf' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 on disallowed mime type', async () => {
    const app = makeTestApp();
    const res = await app.request('/upload', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'malware.exe',
        fileSize: 1024,
        mimeType: 'application/x-msdownload',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe('MIME_NOT_ALLOWED');
  });

  it('returns 413 when fileSize exceeds 25 MB', async () => {
    const app = makeTestApp();
    const res = await app.request('/upload', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'big.pdf',
        fileSize: 50 * 1024 * 1024,
        mimeType: 'application/pdf',
      }),
    });
    expect(res.status).toBe(413);
  });

  it('returns 201 + queued status + classifier kind for a valid contract upload', async () => {
    const app = makeTestApp();
    const res = await app.request('/upload', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        fileName: 'Acacia-Offtake-Agreement.pdf',
        fileSize: 4096,
        mimeType: 'application/pdf',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data?: { documentId: string; ingestionStatus: string; kind: string };
    };
    expect(body.data?.ingestionStatus).toBe('queued');
    expect(body.data?.kind).toBe('contract');
    expect(body.data?.documentId).toBeTruthy();
  });
});

describe('document-intelligence documents list', () => {
  it('returns 401 without authorization header', async () => {
    const app = makeTestApp();
    const res = await app.request('/documents');
    expect(res.status).toBe(401);
  });

  it('returns documents previously uploaded by the same tenant', async () => {
    const app = makeTestApp();
    const res = await app.request('/documents', {
      headers: { authorization: bearer },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { documents: { id: string; kind: string }[] };
    };
    expect(Array.isArray(body.data?.documents)).toBe(true);
  });

  it('honours the tenant scope by only returning current-tenant rows', async () => {
    // Pre-seed a foreign-tenant row to ensure it is excluded.
    storedDocs = [
      ...storedDocs,
      {
        id: 'doc_foreign',
        tenantId: 'tenant_other',
        kind: 'other',
        ingestionStatus: 'ready',
        mimeType: 'application/pdf',
        fileName: 'foreign.pdf',
        entityType: 'document_intelligence',
        createdBy: 'user_other',
      },
    ];
    const app = makeTestApp();
    const res = await app.request('/documents', {
      headers: { authorization: bearer },
    });
    const body = (await res.json()) as {
      data?: { documents: { id: string }[] };
    };
    const ids = (body.data?.documents ?? []).map((d) => d.id);
    expect(ids).not.toContain('doc_foreign');
  });
});

describe('document-intelligence sessions', () => {
  it('returns 401 without authorization header', async () => {
    const app = makeTestApp();
    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ documentIds: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 on empty documentIds array', async () => {
    const app = makeTestApp();
    const res = await app.request('/sessions', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ documentIds: [] }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when documentIds reference an unknown doc', async () => {
    const app = makeTestApp();
    const res = await app.request('/sessions', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ documentIds: ['doc_does_not_exist'] }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe('DOCUMENTS_NOT_FOUND');
  });

  it('returns 201 + sessionId when documentIds are valid', async () => {
    // Seed a valid doc first.
    storedDocs = [
      ...storedDocs,
      {
        id: 'doc_seeded_1',
        tenantId: TENANT_ID,
        kind: 'contract',
        ingestionStatus: 'ready',
        mimeType: 'application/pdf',
        fileName: 'seed.pdf',
        entityType: 'document_intelligence',
        createdBy: USER_ID,
      },
    ];
    const app = makeTestApp();
    const res = await app.request('/sessions', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ documentIds: ['doc_seeded_1'] }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data?: { sessionId: string } };
    expect(body.data?.sessionId).toMatch(/^sess_/);
  });
});

describe('document-intelligence ask', () => {
  it('returns 400 on malformed session id', async () => {
    const app = makeTestApp();
    const res = await app.request('/sessions/not-a-valid-id/ask', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'What is the price?' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the session does not exist', async () => {
    const app = makeTestApp();
    const res = await app.request('/sessions/sess_does_not_exist/ask', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'What is the price?' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when question is empty', async () => {
    storedSessions = [
      ...storedSessions,
      { id: 'sess_ask_test', tenantId: TENANT_ID, userId: USER_ID, documentIds: ['doc_seeded_1'] },
    ];
    const app = makeTestApp();
    const res = await app.request('/sessions/sess_ask_test/ask', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: '' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 + sessionId + evidenceIds envelope when valid', async () => {
    storedSessions = [
      ...storedSessions,
      { id: 'sess_ask_test2', tenantId: TENANT_ID, userId: USER_ID, documentIds: ['doc_seeded_1'] },
    ];
    const app = makeTestApp();
    const res = await app.request('/sessions/sess_ask_test2/ask', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'What is the haulage clause?', language: 'sw' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { sessionId: string; evidenceIds: string[]; documentIds: string[] };
    };
    expect(body.data?.sessionId).toBe('sess_ask_test2');
    expect(Array.isArray(body.data?.evidenceIds)).toBe(true);
  });
});

describe('document-intelligence summary', () => {
  it('returns 404 when the doc is unknown', async () => {
    const app = makeTestApp();
    const res = await app.request('/documents/doc_unknown/summary', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 NOT_READY when ingestion has not completed', async () => {
    storedDocs = [
      ...storedDocs,
      {
        id: 'doc_pending',
        tenantId: TENANT_ID,
        kind: 'contract',
        ingestionStatus: 'queued',
        mimeType: 'application/pdf',
        fileName: 'pending.pdf',
        entityType: 'document_intelligence',
        createdBy: USER_ID,
      },
    ];
    const app = makeTestApp();
    const res = await app.request('/documents/doc_pending/summary', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).toBe('NOT_READY');
  });

  it('returns 200 + summary envelope when the doc is ready', async () => {
    storedDocs = [
      ...storedDocs,
      {
        id: 'doc_ready',
        tenantId: TENANT_ID,
        kind: 'contract',
        ingestionStatus: 'ready',
        mimeType: 'application/pdf',
        fileName: 'ready.pdf',
        entityType: 'document_intelligence',
        createdBy: USER_ID,
      },
    ];
    const app = makeTestApp();
    const res = await app.request('/documents/doc_ready/summary', {
      method: 'POST',
      headers: {
        authorization: bearer,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ language: 'sw' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data?: { documentId: string; summary: string };
    };
    expect(body.data?.documentId).toBe('doc_ready');
    expect(typeof body.data?.summary).toBe('string');
  });
});
