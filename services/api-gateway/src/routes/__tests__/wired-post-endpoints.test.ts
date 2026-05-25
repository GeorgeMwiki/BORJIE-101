/**
 * Wired-POST-endpoints integration tests.
 *
 * These tests exercise the five previously-503 POST endpoints end-to-end
 * against an in-memory fake Drizzle client + fake event bus. They prove:
 *
 *   1. The DB row is inserted with tenant isolation.
 *   2. The matching domain event is published on the bus.
 *   3. The response envelope is the expected shape + status code
 *      (202 for deferred work, 201 for direct creation).
 *
 * No real Postgres involvement — this keeps the suite fast and lets us
 * run in CI before the compose-up database is green.
 *
 * We mount each router on a fresh Hono app and skip the JWT auth by
 * injecting the `auth`/`tenantId`/`userId`/`services` context variables
 * in a middleware BEFORE the router's own authMiddleware runs… except
 * the router's middleware verifies the JWT. Easier: we short-circuit the
 * whole router by constructing a new Hono app that replicates the route
 * handlers with a tiny in-memory DB behind them. Since we test behaviour
 * (DB row inserted + event emitted) and not JWT wiring, this is the
 * right seam.
 *
 * To stay faithful to the production router we import the real router
 * file and bypass auth by signing a valid JWT with the shared secret
 * used in the test suite. See `../../middleware/auth` for generateToken.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Ensure a stable JWT secret BEFORE importing any router (which transitively
// pulls the auth middleware and captures the secret at module init).
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

import { generateToken } from '../../middleware/auth';
import { UserRole } from '../../types/user-role';

import docChatRouter from '../doc-chat.router';
import documentRenderRouter from '../document-render.router';
import scansRouter from '../scans.router';
import complianceRouter from '../compliance.router';
import interactiveReportsRouter from '../interactive-reports.router';

import {
  docChatSessions,
  docChatMessages,
  documentRenderJobs,
  scanBundles,
  scanBundlePages,
  complianceExports,
  interactiveReportVersions,
  interactiveReportActionAcks,
} from '@borjie/database';

// ---------------------------------------------------------------------------
// Fake Drizzle client — a minimal in-memory shape that supports exactly the
// .select / .insert / .update builders used by the routers under test.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function tableName(table: any): string {
  // Drizzle tables expose the symbol `Symbol(drizzle:Name)`. Walk the
  // own symbols + look for the table name.
  for (const s of Object.getOwnPropertySymbols(table)) {
    if (s.toString().includes('Name')) {
      return (table as any)[s];
    }
  }
  return '';
}

function createFakeDb() {
  const store = new Map<string, Row[]>();
  const eq = (left: string, right: unknown) => ({ kind: 'eq', left, right });

  // Record last-inserted rows by table name for test assertions.
  const inserted: Record<string, Row[]> = {};
  const updated: Record<string, Row[]> = {};

  // tiny eval: always reconstructs conditions as { kind: 'eq', ... } or
  // { kind: 'and', parts: [...] } — the router composes them via drizzle
  // helpers which serialize to opaque objects. Our fake walks the structure.
  function matchesCondition(row: Row, cond: any, tblName: string): boolean {
    if (!cond) return true;
    if (Array.isArray(cond)) return cond.every((c) => matchesCondition(row, c, tblName));
    const kind = (cond as any).kind || (cond as any).operator || '';
    if (kind === 'and' || (cond as any).op === 'and') {
      const parts = (cond as any).queries || (cond as any).parts || [];
      return parts.every((p: any) => matchesCondition(row, p, tblName));
    }
    // Real drizzle conditions wrap column metadata. We only need to check
    // eq(column, value); column carries a .name.
    const col =
      (cond as any).left ||
      (cond as any).column ||
      (cond as any).queries?.[0] ||
      (cond as any)._?.column;
    const value =
      (cond as any).right ??
      (cond as any).value ??
      (cond as any).queries?.[1];
    if (col && typeof col === 'object' && 'name' in col) {
      const k = (col as any).name;
      return row[k] === value || row[camelCase(k)] === value;
    }
    return true;
  }

  function camelCase(snake: string): string {
    return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  function insert(table: any) {
    const name = tableName(table);
    if (!store.has(name)) store.set(name, []);
    return {
      values(row: Row | Row[]) {
        const rows = Array.isArray(row) ? row : [row];
        store.get(name)!.push(...rows);
        inserted[name] = (inserted[name] ?? []).concat(rows);
        return {
          async returning() {
            return rows;
          },
          then(resolve: any) {
            resolve();
          },
        };
      },
    };
  }

  function select() {
    return {
      from(table: any) {
        const name = tableName(table);
        const list = store.get(name) ?? [];
        let filter: any = null;
        const qb: any = {
          where(cond: any) {
            filter = cond;
            return qb;
          },
          orderBy() {
            return qb;
          },
          limit() {
            return qb;
          },
          offset() {
            return qb;
          },
          then(resolve: any) {
            resolve(list.filter((r) => matchesCondition(r, filter, name)));
          },
          [Symbol.asyncIterator]: async function* () {
            for (const r of list) yield r;
          },
        };
        return qb;
      },
    };
  }

  function update(table: any) {
    const name = tableName(table);
    return {
      set(changes: Row) {
        return {
          where(cond: any) {
            const list = store.get(name) ?? [];
            const matched = list.filter((r) => matchesCondition(r, cond, name));
            for (const row of matched) Object.assign(row, changes);
            updated[name] = (updated[name] ?? []).concat(matched);
            return {
              async returning() {
                return matched;
              },
              then(resolve: any) {
                resolve();
              },
            };
          },
        };
      },
    };
  }

  return { store, inserted, updated, insert, select, update };
}

// ---------------------------------------------------------------------------
// Fake services registry
// ---------------------------------------------------------------------------

function createServices() {
  const db = createFakeDb();
  const events: any[] = [];
  const eventBus = {
    async publish(envelope: any) {
      events.push(envelope);
    },
    subscribe() {
      return () => {};
    },
  };
  return { db, events, eventBus };
}

function mountWithContext(router: any, services: any, ctx: {
  tenantId: string;
  userId: string;
}) {
  const app = new Hono();
  // Inject services/tenantId/userId/auth BEFORE the router runs. Because
  // the router's authMiddleware runs per-request inside the sub-app, we
  // can't pre-empt it unless we short-circuit. We install an outer
  // middleware that sets `auth` and then stub the Authorization header.
  app.use('*', async (c, next) => {
    c.set('services', services);
    c.set('tenantId', ctx.tenantId);
    c.set('userId', ctx.userId);
    c.set('auth', {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: 'TENANT_ADMIN',
      permissions: ['*'],
      propertyAccess: ['*'],
    });
    await next();
  });
  app.route('/', router);
  return app;
}

function authHeader(): Record<string, string> {
  const token = generateToken({
    userId: 'user-001',
    tenantId: 'tnt_1',
    role: UserRole.TENANT_ADMIN,
    permissions: ['*'],
    propertyAccess: ['*'],
  });
  return { Authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// 1) doc-chat
// ---------------------------------------------------------------------------

describe('POST /doc-chat', () => {
  it('POST /sessions persists a session row + emits DocChatSessionStarted', async () => {
    const services = createServices();
    const app = mountWithContext(docChatRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    const res = await app.request('/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        scope: 'single_document',
        documentIds: ['doc_1'],
        title: 'Lease Q&A',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.tenantId).toBe('tnt_1');
    expect(body.data.createdBy).toBe('user-001');
    const tbl = services.db.store.get('doc_chat_sessions') ?? [];
    expect(tbl.length).toBe(1);
    expect(tbl[0]?.tenantId).toBe('tnt_1');
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'DocChatSessionStarted'
    );
  });

  it('POST /sessions/:id/ask persists user + assistant messages', async () => {
    const services = createServices();
    const app = mountWithContext(docChatRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    // Pre-seed a session.
    services.db.store.set('doc_chat_sessions', [
      {
        id: 'dcs_fixture',
        tenantId: 'tnt_1',
        scope: 'single_document',
        documentIds: ['doc_1'],
        participants: ['user-001'],
        createdBy: 'user-001',
        createdAt: new Date(),
        lastMessageAt: null,
      },
    ]);

    const res = await app.request('/sessions/dcs_fixture/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ question: 'What is the rent?' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.userMessage.role).toBe('user');
    expect(body.data.assistantMessage.role).toBe('assistant');
    const messages = services.db.store.get('doc_chat_messages') ?? [];
    expect(messages.length).toBe(2);
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'DocChatQuestionAnswered'
    );
  });

  it('POST /sessions/:id/messages persists a peer message', async () => {
    const services = createServices();
    const app = mountWithContext(docChatRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    services.db.store.set('doc_chat_sessions', [
      {
        id: 'dcs_fixture',
        tenantId: 'tnt_1',
        scope: 'group_chat',
        documentIds: ['doc_1'],
        participants: ['user-001', 'user-002'],
        createdBy: 'user-001',
        createdAt: new Date(),
      },
    ]);
    const res = await app.request('/sessions/dcs_fixture/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ content: 'Any updates?' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.role).toBe('user');
    const messages = services.db.store.get('doc_chat_messages') ?? [];
    expect(messages.length).toBe(1);
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'DocChatMessagePosted'
    );
  });
});

// ---------------------------------------------------------------------------
// 2) document-render
// ---------------------------------------------------------------------------

describe('POST /document-render/jobs', () => {
  it('enqueues a render job + returns 202 + emits DocumentRenderRequested', async () => {
    const services = createServices();
    const app = mountWithContext(documentRenderRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    const res = await app.request('/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        templateId: 'tpl_lease_notice',
        templateVersion: '1',
        rendererKind: 'docxtemplater',
        inputs: { tenant: 'Mwanga' },
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('queued');
    expect(body.data.jobId).toMatch(/^drj_/);
    const tbl = services.db.store.get('document_render_jobs') ?? [];
    expect(tbl.length).toBe(1);
    expect(tbl[0]?.status).toBe('queued');
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'DocumentRenderRequested'
    );
  });
});

// ---------------------------------------------------------------------------
// 3) scans
// ---------------------------------------------------------------------------

describe('POST /scans', () => {
  it('POST /bundles creates a draft bundle + emits ScanBundleCreated', async () => {
    const services = createServices();
    const app = mountWithContext(scansRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    const res = await app.request('/bundles', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ title: 'Lease Kenya-2026-04' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('draft');
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'ScanBundleCreated'
    );
  });

  it('POST /bundles/:id/pages uploads a page, increments pageCount', async () => {
    const services = createServices();
    const app = mountWithContext(scansRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    services.db.store.set('scan_bundles', [
      {
        id: 'scb_1',
        tenantId: 'tnt_1',
        title: 'Seed',
        purpose: null,
        status: 'draft',
        assembledDocumentId: null,
        pageCount: 0,
        processingLog: [],
        errorMessage: null,
        createdBy: 'user-001',
        createdAt: new Date(),
        updatedAt: new Date(),
        submittedAt: null,
      },
    ]);
    const res = await app.request('/bundles/scb_1/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        dataUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.page.pageNumber).toBe(1);
    const pages = services.db.store.get('scan_bundle_pages') ?? [];
    expect(pages.length).toBe(1);
    const bundle = services.db.store.get('scan_bundles')?.[0];
    expect(bundle?.pageCount).toBe(1);
  });

  it('POST /bundles/:id/ocr queues OCR with 202 + emits ScanBundleOcrRequested', async () => {
    const services = createServices();
    const app = mountWithContext(scansRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    services.db.store.set('scan_bundles', [
      {
        id: 'scb_1',
        tenantId: 'tnt_1',
        title: 'Seed',
        purpose: null,
        status: 'draft',
        assembledDocumentId: null,
        pageCount: 1,
        processingLog: [],
        errorMessage: null,
        createdBy: 'user-001',
        createdAt: new Date(),
        updatedAt: new Date(),
        submittedAt: null,
      },
    ]);
    const res = await app.request('/bundles/scb_1/ocr', {
      method: 'POST',
      headers: authHeader(),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.workerWillProcess).toBe(true);
    const bundle = services.db.store.get('scan_bundles')?.[0];
    expect(bundle?.status).toBe('processing');
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'ScanBundleOcrRequested'
    );
  });

  it('POST /bundles/:id/submit finalizes the bundle', async () => {
    const services = createServices();
    const app = mountWithContext(scansRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    services.db.store.set('scan_bundles', [
      {
        id: 'scb_1',
        tenantId: 'tnt_1',
        title: 'Seed',
        purpose: null,
        status: 'ready',
        assembledDocumentId: null,
        pageCount: 1,
        processingLog: [],
        errorMessage: null,
        createdBy: 'user-001',
        createdAt: new Date(),
        updatedAt: new Date(),
        submittedAt: null,
      },
    ]);
    const res = await app.request('/bundles/scb_1/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ assetId: 'asset_1', customerId: 'cust_1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const bundle = services.db.store.get('scan_bundles')?.[0];
    expect(bundle?.status).toBe('submitted');
    expect(bundle?.submittedAt).toBeTruthy();
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'ScanBundleSubmitted'
    );
  });
});

// ---------------------------------------------------------------------------
// 4) compliance exports
// ---------------------------------------------------------------------------

describe('POST /compliance/exports', () => {
  it('schedules an export + returns 202 + emits ComplianceExportRequested', async () => {
    const services = createServices();
    const app = mountWithContext(complianceRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    const res = await app.request('/exports', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({
        exportType: 'tz_tra',
        periodStart: '2026-01-01T00:00:00Z',
        periodEnd: '2026-03-31T23:59:59Z',
        regulatorContext: { tin: '123456789' },
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('scheduled');
    expect(body.data.jobId).toMatch(/^cex_/);
    const tbl = services.db.store.get('compliance_exports') ?? [];
    expect(tbl.length).toBe(1);
    expect(tbl[0]?.exportType).toBe('tz_tra');
    expect(tbl[0]?.format).toBe('csv');
    expect(services.events.map((e: any) => e.event.eventType)).toContain(
      'ComplianceExportRequested'
    );
  });
});

// ---------------------------------------------------------------------------
// 5) interactive-reports ack
// ---------------------------------------------------------------------------

describe('POST /interactive-reports/:id/action-plans/:aid/ack', () => {
  it('persists an ack row + emits ActionPlanAcknowledged', async () => {
    const services = createServices();
    const app = mountWithContext(interactiveReportsRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    services.db.store.set('interactive_report_versions', [
      {
        id: 'irv_1',
        tenantId: 'tnt_1',
        reportInstanceId: 'rpt_1',
        version: 1,
        renderKind: 'html_bundle',
        mediaReferences: [],
        actionPlans: [
          {
            id: 'plan_1',
            title: 'Replace cracked window',
            createsWorkOrder: true,
            action: { kind: 'create_work_order', payload: {} },
          },
        ],
        signedUrl: null,
        signedUrlKey: null,
        expiresAt: null,
        contentHash: null,
        generatedAt: new Date(),
        generatedBy: 'user-001',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const res = await app.request(
      '/irv_1/action-plans/plan_1/ack',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          actionKind: 'create_work_order',
          metadata: { note: 'urgent' },
        }),
      }
    );
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.resolution).toBe('work_order_pending');
    const acks =
      services.db.store.get('interactive_report_action_acks') ?? [];
    expect(acks.length).toBe(1);
    expect(acks[0]?.acknowledgedBy).toBe('user-001');
    const events = services.events.map((e: any) => e.event.eventType);
    expect(events).toContain('ActionPlanAcknowledged');
    // payload carries the createsWorkOrder flag so a downstream subscriber
    // can route the ack into work-order creation.
    const ackEvent = services.events.find(
      (e: any) => e.event.eventType === 'ActionPlanAcknowledged'
    );
    expect(ackEvent.event.payload.createsWorkOrder).toBe(true);
  });

  it('returns 404 when the action plan is not found on the version', async () => {
    const services = createServices();
    const app = mountWithContext(interactiveReportsRouter, services, {
      tenantId: 'tnt_1',
      userId: 'user-001',
    });
    services.db.store.set('interactive_report_versions', [
      {
        id: 'irv_1',
        tenantId: 'tnt_1',
        reportInstanceId: 'rpt_1',
        version: 1,
        renderKind: 'html_bundle',
        mediaReferences: [],
        actionPlans: [],
        signedUrl: null,
        signedUrlKey: null,
        expiresAt: null,
        contentHash: null,
        generatedAt: new Date(),
        generatedBy: 'user-001',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const res = await app.request(
      '/irv_1/action-plans/plan_missing/ack',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeader() },
        body: JSON.stringify({}),
      }
    );
    expect(res.status).toBe(404);
  });
});
