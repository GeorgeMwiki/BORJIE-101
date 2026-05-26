/**
 * Document Render API Routes
 *
 *   GET  /              — list render jobs for the tenant (DB-backed)
 *   GET  /jobs          — alias for GET /
 *   GET  /jobs/:id      — fetch a single render job
 *   POST /jobs          — enqueue a render job (requires render worker wiring)
 *
 * Reads render jobs directly from `document_render_jobs` via the
 * composition-root Drizzle client so GET endpoints return real data.
 * POST /jobs returns 503 until the render worker + RendererFactory are
 * wired.
 *
 * Guardrail: rendererKind is restricted to document kinds (text,
 * docxtemplater, react-pdf, typst). Nano-banana imagery has its own route
 * and is NEVER accepted here.
 */


import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { documentRenderJobs } from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

const DocumentRendererKindSchema = z.enum([
  'text',
  'docxtemplater',
  'react-pdf',
  'typst',
]);

const EnqueueSchema = z.object({
  templateId: z.string().min(1),
  templateVersion: z.string().default('1'),
  rendererKind: DocumentRendererKindSchema,
  inputs: z.record(z.unknown()).default({}),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
});

const ListQuerySchema = z.object({
  status: z
    .enum(['queued', 'running', 'succeeded', 'failed', 'cancelled'])
    .optional(),
  templateId: z.string().optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error:
        'Document render database not configured — DATABASE_URL unset',
    },
    503
  );
}

async function listJobs(c: any) {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const query = c.req.valid?.('query') ?? {};
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const conditions = [eq(documentRenderJobs.tenantId, tenantId)];
  if (query.status) {
    conditions.push(eq(documentRenderJobs.status, query.status));
  }
  if (query.templateId) {
    conditions.push(eq(documentRenderJobs.templateId, query.templateId));
  }
  if (query.relatedEntityType) {
    conditions.push(
      eq(documentRenderJobs.relatedEntityType, query.relatedEntityType)
    );
  }
  if (query.relatedEntityId) {
    conditions.push(
      eq(documentRenderJobs.relatedEntityId, query.relatedEntityId)
    );
  }
  const rows = await db
    .select()
    .from(documentRenderJobs)
    .where(and(...conditions))
    .orderBy(desc(documentRenderJobs.requestedAt))
    .limit(limit)
    .offset(offset);
  return c.json({ success: true, data: rows });
}

app.get('/', zValidator('query', ListQuerySchema), listJobs);
app.get('/jobs', zValidator('query', ListQuerySchema), listJobs);

app.get('/jobs/:id', async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  const rows = await db
    .select()
    .from(documentRenderJobs)
    .where(
      and(
        eq(documentRenderJobs.id, id),
        eq(documentRenderJobs.tenantId, tenantId)
      )
    )
    .limit(1);
  if (!rows[0]) {
    return c.json({ success: false, error: 'Job not found' }, 404);
  }
  return c.json({ success: true, data: rows[0] });
});

/**
 * POST /jobs — enqueue a render job.
 *
 * Behaviour:
 *   - Persists a `document_render_jobs` row with status=queued.
 *   - Emits a `DocumentRenderRequested` domain event so subscribers (or the
 *     render worker) can pick it up.
 *   - Returns 202 Accepted + jobId. The real renderer runs asynchronously
 *     — clients poll GET /jobs/:id for status.
 *
 * The endpoint intentionally does NOT call the renderer inline so the
 * response stays fast and the request isn't coupled to the availability
 * of docx/pdf/typst deps. When the worker is offline the row still
 * persists and a follow-up pass will drain the queue.
 */
app.post('/jobs', zValidator('json', EnqueueSchema), withSecurityEvents({ action: 'document-render.create', resource: 'document-render', severity: 'info' }, async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const now = new Date();
  const jobId = `drj_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const row = {
    id: jobId,
    tenantId,
    templateId: body.templateId,
    templateVersion: body.templateVersion,
    rendererKind: body.rendererKind,
    status: 'queued' as const,
    inputPayload: body.inputs,
    outputDocumentId: null,
    outputMimeType: null,
    outputSizeBytes: null,
    pageCount: null,
    errorCode: null,
    errorMessage: null,
    relatedEntityType: body.relatedEntityType ?? null,
    relatedEntityId: body.relatedEntityId ?? null,
    requestedBy: userId,
    requestedAt: now,
    startedAt: null,
    completedAt: null,
  };

  try {
    const [inserted] = await db
      .insert(documentRenderJobs)
      .values(row)
      .returning();

    // Fire event so the render worker (or future subscribers) can pick up.
    try {
      await services.eventBus?.publish({
        event: {
          eventId: `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
          eventType: 'DocumentRenderRequested',
          timestamp: now.toISOString(),
          tenantId,
          correlationId: `cor_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
          causationId: null,
          metadata: {},
          payload: {
            jobId,
            templateId: body.templateId,
            templateVersion: body.templateVersion,
            rendererKind: body.rendererKind,
            relatedEntityType: body.relatedEntityType,
            relatedEntityId: body.relatedEntityId,
          },
        } as any,
        version: 1,
        aggregateId: jobId,
        aggregateType: 'DocumentRenderJob',
      });
    } catch (_e) {
      // Event publish never breaks the enqueue response.
    }

    return c.json(
      {
        success: true,
        data: {
          jobId,
          status: 'queued',
          job: inserted ?? row,
          workerWillProcess: true,
        },
      },
      202
    );
  } catch (error) {
    return routeCatch(c, error, {
      code: 'ENQUEUE_FAILED',
      status: 500,
      fallback: 'Enqueue failed',
    });
  }
}));

export default app;
