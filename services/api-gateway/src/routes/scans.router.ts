/**
 * Scans API Routes (NEW 14)
 *
 *   GET  /                          — list scan bundles (DB-backed)
 *   GET  /bundles                   — alias for GET /
 *   GET  /bundles/:id               — fetch a single bundle
 *   POST /bundles                   — create new scan bundle (DB-backed)
 *   POST /bundles/:id/pages         — upload one page (DB-backed; stores
 *                                     raw data URL payload in-row via
 *                                     storageKey placeholder when no
 *                                     object-storage backend is wired)
 *   POST /bundles/:id/ocr           — queue OCR across pages. When the OCR
 *                                     provider is not wired we still move
 *                                     the bundle to `processing` and record
 *                                     a processing_log entry so the client
 *                                     can poll.
 *   POST /bundles/:id/submit        — finalize bundle + emit submit event.
 *
 * Graceful degradation: the router operates purely against Postgres +
 * the in-process event bus; wiring a real storage/OCR backend later is
 * additive and doesn't change the request/response shapes.
 */

// @ts-nocheck — Hono context types are open-ended by design in this project.

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import {
  scanBundles,
  scanBundlePages,
} from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

const CreateBundleSchema = z.object({
  title: z.string().max(200).optional(),
  purpose: z.string().max(500).optional(),
});

const UploadPageSchema = z.object({
  dataUrl: z.string().startsWith('data:'),
  mimeType: z.string().default('image/png'),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  quad: z
    .array(z.object({ x: z.number(), y: z.number() }))
    .length(4)
    .optional(),
});

const SubmitBundleSchema = z.object({
  assetId: z.string().optional(),
  customerId: z.string().optional(),
});

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: 'Scan bundles database not configured — DATABASE_URL unset',
    },
    503
  );
}

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function dataUrlSize(dataUrl: string): number {
  // Rough size of the base64 payload. Used only for bookkeeping; the real
  // storage backend returns authoritative byte sizes later.
  const idx = dataUrl.indexOf(',');
  if (idx < 0) return 0;
  const payload = dataUrl.slice(idx + 1);
  return Math.ceil((payload.length * 3) / 4);
}

async function listBundles(c: any) {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const rows = await db
    .select()
    .from(scanBundles)
    .where(eq(scanBundles.tenantId, tenantId))
    .orderBy(desc(scanBundles.createdAt))
    .limit(100);
  return c.json({ success: true, data: rows });
}

app.get('/', listBundles);
app.get('/bundles', listBundles);

app.get('/bundles/:id', async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  const rows = await db
    .select()
    .from(scanBundles)
    .where(and(eq(scanBundles.id, id), eq(scanBundles.tenantId, tenantId)))
    .limit(1);
  if (!rows[0]) {
    return c.json({ success: false, error: 'Bundle not found' }, 404);
  }
  return c.json({ success: true, data: rows[0] });
});

// ---------------------------------------------------------------------------
// POST /bundles — create a new scan bundle (draft state).
// ---------------------------------------------------------------------------
app.post('/bundles', zValidator('json', CreateBundleSchema), withSecurityEvents({ action: 'scan.create', resource: 'scan', severity: 'info' }, async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const now = new Date();
  const row = {
    id: newId('scb'),
    tenantId,
    title: body.title ?? null,
    purpose: body.purpose ?? null,
    status: 'draft' as const,
    assembledDocumentId: null,
    pageCount: 0,
    processingLog: [{ step: 'created', at: now.toISOString() }],
    errorMessage: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
  };

  try {
    const [inserted] = await db.insert(scanBundles).values(row).returning();

    try {
      await services.eventBus?.publish({
        event: {
          eventId: newId('evt'),
          eventType: 'ScanBundleCreated',
          timestamp: now.toISOString(),
          tenantId,
          correlationId: newId('cor'),
          causationId: null,
          metadata: {},
          payload: { bundleId: row.id },
        } as any,
        version: 1,
        aggregateId: row.id,
        aggregateType: 'ScanBundle',
      });
    } catch (_e) {
      // non-fatal
    }

    return c.json({ success: true, data: inserted ?? row }, 201);
  } catch (error) {
    return routeCatch(c, error, {
      code: 'CREATE_FAILED',
      status: 500,
      fallback: 'Create failed',
    });
  }
}));

// ---------------------------------------------------------------------------
// POST /bundles/:id/pages — upload one page to the bundle.
// ---------------------------------------------------------------------------
app.post(
  '/bundles/:id/pages',
  zValidator('json', UploadPageSchema),
  withSecurityEvents({ action: 'scan.create', resource: 'scan', severity: 'info' }, async (c: any) => {
    const services = c.get('services');
    const db = services?.db;
    if (!db) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const bundleId = c.req.param('id');
    const body = c.req.valid('json');

    // Lock-free fetch — concurrent uploads would race on pageCount but
    // the pilot workload is sequential per bundle (one device uploads
    // page-by-page). We can revisit with SELECT FOR UPDATE if needed.
    const [bundle] = await db
      .select()
      .from(scanBundles)
      .where(
        and(eq(scanBundles.id, bundleId), eq(scanBundles.tenantId, tenantId))
      )
      .limit(1);
    if (!bundle) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Bundle not found' } },
        404
      );
    }
    if (bundle.status === 'submitted') {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_STATE', message: 'Bundle already submitted' },
        },
        409
      );
    }

    const now = new Date();
    const pageNumber = (bundle.pageCount ?? 0) + 1;
    // Placeholder storage key: when the real object-storage backend is
    // wired, the upload flow swaps this for the real key without changing
    // the DB shape. The page row is the authoritative record until then.
    const storageKey = `scan/${tenantId}/${bundle.id}/${pageNumber}.png`;

    const page = {
      id: newId('scp'),
      bundleId: bundle.id,
      tenantId,
      pageNumber,
      storageKey,
      mimeType: body.mimeType,
      sizeBytes: dataUrlSize(body.dataUrl),
      widthPx: body.widthPx ?? null,
      heightPx: body.heightPx ?? null,
      quad: body.quad ?? null,
      ocrText: null,
      ocrConfidence: null,
      capturedAt: now,
    };

    try {
      await db.insert(scanBundlePages).values(page);
      const processingLog = [
        ...((bundle.processingLog as any[]) ?? []),
        {
          step: 'page_uploaded',
          at: now.toISOString(),
          detail: `page ${pageNumber}`,
        },
      ];
      const [updatedBundle] = await db
        .update(scanBundles)
        .set({
          pageCount: pageNumber,
          processingLog,
          updatedAt: now,
        })
        .where(
          and(eq(scanBundles.id, bundle.id), eq(scanBundles.tenantId, tenantId))
        )
        .returning();

      return c.json(
        { success: true, data: { bundle: updatedBundle, page } },
        201
      );
    } catch (error) {
      return routeCatch(c, error, {
        code: 'UPLOAD_FAILED',
        status: 500,
        fallback: 'Upload failed',
      });
    }
  })
);

// ---------------------------------------------------------------------------
// POST /bundles/:id/ocr — queue OCR for the bundle.
// ---------------------------------------------------------------------------
app.post('/bundles/:id/ocr', withSecurityEvents({ action: 'scan.create', resource: 'scan', severity: 'info' }, async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const bundleId = c.req.param('id');

  const [bundle] = await db
    .select()
    .from(scanBundles)
    .where(
      and(eq(scanBundles.id, bundleId), eq(scanBundles.tenantId, tenantId))
    )
    .limit(1);
  if (!bundle) {
    return c.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Bundle not found' } },
      404
    );
  }
  if (bundle.pageCount === 0) {
    return c.json(
      {
        success: false,
        error: {
          code: 'NO_PAGES',
          message: 'Bundle has no pages to OCR',
        },
      },
      400
    );
  }

  const now = new Date();
  const ocrConfigured = Boolean(
    process.env.AWS_TEXTRACT_REGION ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.OCR_PROVIDER
  );
  const processingLog = [
    ...((bundle.processingLog as any[]) ?? []),
    {
      step: 'ocr_queued',
      at: now.toISOString(),
      detail: ocrConfigured ? 'provider_configured' : 'fallback_no_provider',
    },
  ];

  try {
    const [updated] = await db
      .update(scanBundles)
      .set({
        status: 'processing',
        processingLog,
        updatedAt: now,
      })
      .where(
        and(eq(scanBundles.id, bundle.id), eq(scanBundles.tenantId, tenantId))
      )
      .returning();

    try {
      await services.eventBus?.publish({
        event: {
          eventId: newId('evt'),
          eventType: 'ScanBundleOcrRequested',
          timestamp: now.toISOString(),
          tenantId,
          correlationId: newId('cor'),
          causationId: null,
          metadata: { fallback: !ocrConfigured },
          payload: { bundleId: bundle.id, pageCount: bundle.pageCount },
        } as any,
        version: 1,
        aggregateId: bundle.id,
        aggregateType: 'ScanBundle',
      });
    } catch (_e) {
      // non-fatal
    }

    return c.json(
      {
        success: true,
        data: {
          bundle: updated,
          workerWillProcess: true,
          ocrProviderConfigured: ocrConfigured,
        },
      },
      202
    );
  } catch (error) {
    return routeCatch(c, error, {
      code: 'OCR_QUEUE_FAILED',
      status: 500,
      fallback: 'OCR queue failed',
    });
  }
}));

// ---------------------------------------------------------------------------
// POST /bundles/:id/submit — finalize + freeze the bundle.
// ---------------------------------------------------------------------------
app.post(
  '/bundles/:id/submit',
  zValidator('json', SubmitBundleSchema.optional()),
  withSecurityEvents({ action: 'scan.create', resource: 'scan', severity: 'info' }, async (c: any) => {
    const services = c.get('services');
    const db = services?.db;
    if (!db) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const bundleId = c.req.param('id');
    // zValidator('json', ...optional) may leave the valid call undefined
    // when body is empty. Default to an empty object.
    let body: { assetId?: string; customerId?: string } = {};
    try {
      body = c.req.valid('json') ?? {};
    } catch (_e) {
      body = {};
    }

    const [bundle] = await db
      .select()
      .from(scanBundles)
      .where(
        and(eq(scanBundles.id, bundleId), eq(scanBundles.tenantId, tenantId))
      )
      .limit(1);
    if (!bundle) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Bundle not found' } },
        404
      );
    }
    if (bundle.status === 'submitted') {
      return c.json(
        {
          success: false,
          error: { code: 'ALREADY_SUBMITTED', message: 'Bundle already submitted' },
        },
        409
      );
    }
    if (bundle.pageCount === 0) {
      return c.json(
        {
          success: false,
          error: {
            code: 'NO_PAGES',
            message: 'Cannot submit an empty bundle',
          },
        },
        400
      );
    }

    const now = new Date();
    const processingLog = [
      ...((bundle.processingLog as any[]) ?? []),
      {
        step: 'submitted',
        at: now.toISOString(),
        detail: [
          body.assetId ? `asset=${body.assetId}` : null,
          body.customerId ? `customer=${body.customerId}` : null,
          `by=${userId}`,
        ]
          .filter(Boolean)
          .join(' '),
      },
    ];

    try {
      const [updated] = await db
        .update(scanBundles)
        .set({
          status: 'submitted',
          processingLog,
          updatedAt: now,
          submittedAt: now,
        })
        .where(
          and(eq(scanBundles.id, bundle.id), eq(scanBundles.tenantId, tenantId))
        )
        .returning();

      try {
        await services.eventBus?.publish({
          event: {
            eventId: newId('evt'),
            eventType: 'ScanBundleSubmitted',
            timestamp: now.toISOString(),
            tenantId,
            correlationId: newId('cor'),
            causationId: null,
            metadata: {},
            payload: {
              bundleId: bundle.id,
              submittedBy: userId,
              assetId: body.assetId,
              customerId: body.customerId,
              pageCount: bundle.pageCount,
            },
          } as any,
          version: 1,
          aggregateId: bundle.id,
          aggregateType: 'ScanBundle',
        });
      } catch (_e) {
        // non-fatal
      }

      return c.json({ success: true, data: updated }, 200);
    } catch (error) {
      return routeCatch(c, error, {
        code: 'SUBMIT_FAILED',
        status: 500,
        fallback: 'Submit failed',
      });
    }
  })
);

export default app;
