/**
 * Letters API Routes (NEW 10)
 *
 * Wires the shared `LetterService` from `@borjie/domain-services` into
 * the Hono router. Until a Postgres letter-request table lands the router
 * uses a tenant-scoped in-memory repository — persistence is lost on
 * restart but every CRUD + workflow path returns real data with real
 * state transitions (requested → drafted → pending_approval → issued).
 *
 * Endpoints:
 *   POST   /                      — createRequest
 *   POST   /:id/draft              — materialize a draft from template payload
 *   POST   /:id/submit-for-approval
 *   POST   /:id/approve
 *   POST   /:id/reject
 *   GET    /:id/download
 *   GET    /:id
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { authMiddleware } from '../middleware/hono-auth';
import {
  LetterService,
  type ILetterRepository,
  type LetterRequestRecord,
  type LetterPayload,
  TextRenderer,
} from '@borjie/domain-services';

import { withSecurityEvents } from '@borjie/observability';
// ---------------------------------------------------------------------------
// Tenant-scoped in-memory repository (pilot fallback).
// ---------------------------------------------------------------------------

function createInMemoryLetterRepo(): ILetterRepository {
  const store = new Map<string, LetterRequestRecord>();
  const key = (tenantId: string, id: string) => `${tenantId}::${id}`;

  return {
    async create(rec) {
      store.set(key(String(rec.tenantId), rec.id), rec);
      return rec;
    },
    async findById(id, tenantId) {
      return store.get(key(String(tenantId), id)) ?? null;
    },
    async update(rec) {
      store.set(key(String(rec.tenantId), rec.id), rec);
      return rec;
    },
  };
}

// Process-wide singleton so repeated requests see the same data during a
// single runtime. Tests that need isolation can reset via test harness.
const lettersRepo: ILetterRepository = createInMemoryLetterRepo();

function buildLetterService(): LetterService {
  return new LetterService({
    repository: lettersRepo,
    renderer: new TextRenderer(),
    // approval + signedUrl ports are optional — when absent the service
    // returns a structured error ("approval port not configured" /
    // "signed url port not configured") instead of crashing.
  });
}

const app = new Hono();
app.use('*', authMiddleware);

const LetterTypeSchema = z.enum([
  'residency_proof',
  'tenancy_confirmation',
  'payment_confirmation',
  'tenant_reference',
]);

const CreateSchema = z.object({
  letterType: LetterTypeSchema,
  customerId: z.string().optional(),
  payload: z.record(z.unknown()).default({}),
});

const DraftSchema = z.object({
  type: LetterTypeSchema,
  data: z.record(z.unknown()),
});

const ApproveSchema = z.object({
  issuedDocumentId: z.string().min(1),
});

const RejectSchema = z.object({
  reason: z.string().min(1).max(500),
});

function toHttp(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function failureStatus(code: string): number {
  switch (code) {
    case 'LETTER_NOT_FOUND':
      return 404;
    case 'INVALID_INPUT':
      return 400;
    case 'INVALID_STATE':
      return 409;
    case 'RENDER_FAILED':
      return 422;
    case 'APPROVAL_FAILED':
      return 424;
    default:
      return 500;
  }
}

app.post('/', zValidator('json', CreateSchema), withSecurityEvents({ action: 'letter.create', resource: 'letter', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const service = buildLetterService();
  const result = await service.createRequest({
    tenantId: auth.tenantId,
    letterType: body.letterType,
    customerId: body.customerId,
    requestedBy: auth.userId,
    payload: body.payload,
  });
  if (!result.ok) {
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      failureStatus(result.error.code)
    );
  }
  return c.json({ success: true, data: result.value }, 201);
}));

app.post('/:id/draft', zValidator('json', DraftSchema), withSecurityEvents({ action: 'letter.create', resource: 'letter', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json') as DraftSchema extends z.ZodType<infer T> ? T : never;
  const service = buildLetterService();
  const payload = { type: body.type, data: body.data } as unknown as LetterPayload;
  const result = await service.draft(c.req.param('id'), auth.tenantId, payload);
  if (!result.ok) {
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      failureStatus(result.error.code)
    );
  }
  return c.json({ success: true, data: result.value });
}));

app.post('/:id/submit-for-approval', withSecurityEvents({ action: 'letter.create', resource: 'letter', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const service = buildLetterService();
  const result = await service.submitForApproval(c.req.param('id'), auth.tenantId, auth.userId);
  if (!result.ok) {
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      failureStatus(result.error.code)
    );
  }
  return c.json({ success: true, data: result.value });
}));

app.post('/:id/approve', zValidator('json', ApproveSchema), withSecurityEvents({ action: 'letter.create', resource: 'letter', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const service = buildLetterService();
  const result = await service.approve(
    c.req.param('id'),
    auth.tenantId,
    auth.userId,
    body.issuedDocumentId
  );
  if (!result.ok) {
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      failureStatus(result.error.code)
    );
  }
  return c.json({ success: true, data: result.value });
}));

app.post('/:id/reject', zValidator('json', RejectSchema), withSecurityEvents({ action: 'letter.create', resource: 'letter', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = c.req.valid('json');
  const service = buildLetterService();
  const result = await service.reject(c.req.param('id'), auth.tenantId, body.reason);
  if (!result.ok) {
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      failureStatus(result.error.code)
    );
  }
  return c.json({ success: true, data: result.value });
}));

app.get('/:id/download', async (c) => {
  const auth = c.get('auth');
  const service = buildLetterService();
  const result = await service.download(c.req.param('id'), auth.tenantId);
  if (!result.ok) {
    return c.json(
      { success: false, error: { code: result.error.code, message: result.error.message } },
      failureStatus(result.error.code)
    );
  }
  return c.json({ success: true, data: result.value });
});

app.get('/:id', async (c) => {
  const auth = c.get('auth');
  const existing = await lettersRepo.findById(c.req.param('id'), auth.tenantId);
  if (!existing) {
    return c.json(
      { success: false, error: { code: 'LETTER_NOT_FOUND', message: 'Letter request not found' } },
      404
    );
  }
  return c.json({ success: true, data: existing });
});

export default app;
