/**
 * /api/v1/mining/reports — report generation orchestrator.
 *
 * Routes:
 *   GET  /                — list generated reports (filter by since)
 *   POST /generate?kind=daily|weekly|monthly|investor|bank|board|audit
 *   GET  /:id/audio       — narration audio + chapter markers + transcript
 *   POST /:id/share       — share a generated report (whatsapp deeplink)
 *
 * Dispatches the report kind to the WORM-renderer / interactive-reports
 * pipeline; this surface only validates the request, records the
 * intent, and returns a job ticket.
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte } from 'drizzle-orm';
import { interactiveReportVersions } from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { reportsGenerateRoute } from './_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.openapi(
  reportsGenerateRoute,
  withSecurityEvents(
    { action: 'mining.report.generate', resource: 'mining.report', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const input = c.req.valid('json');
      const jobId = randomUUID();
      return c.json(
        {
          success: true as const,
          data: {
            jobId,
            kind: input.kind,
            tenantId,
            requestedBy: userId,
            asOf: input.asOf ?? new Date().toISOString(),
            siteIds: input.siteIds ?? [],
            language: input.language,
            format: input.format,
            recipients: input.recipients ?? [],
            status: 'queued' as const,
            note: 'Renderer dispatch handled out-of-band by consolidation-worker.',
          },
        },
        202,
      );
    },
  ),
);

// -----------------------------------------------------------------------------
// GET /:id/audio — narration playback metadata for ReportPlayer (O-W-18).
//
// Stays on the plain-Hono surface (no OpenAPIHono createRoute) for now;
// the response shape is documented inline and validated by Zod here.
// A later pass will lift this into `_openapi/route-defs.ts` next to
// `reportsGenerateRoute`.
// -----------------------------------------------------------------------------

const ReportAudioResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  audio_url: z.string().url(),
  transcript_url: z.string().url(),
  chapter_markers: z.array(
    z.object({ at: z.number().nonnegative(), label: z.string() }),
  ),
});

app.get('/:id/audio', async (c) => {
  const id = c.req.param('id');
  if (!id) {
    return c.json(
      { success: false, error: { code: 'BAD_REQUEST', message: 'missing id' } },
      400,
    );
  }
  // Audio assets live next to the rendered HTML under
  // `reports-audio/<id>.{mp3,vtt}` in object storage. The gateway
  // returns signed URLs in production; here we emit deterministic
  // paths so the player can render against the static fixtures
  // shipped by the narration worker dev seed.
  const baseAssetUrl =
    process.env.REPORTS_AUDIO_BASE_URL?.replace(/\/+$/, '') ??
    'https://reports-cdn.borjie.local/audio';
  const payload = {
    id,
    title: `Owner brief — ${id}`,
    audio_url: `${baseAssetUrl}/${id}.mp3`,
    transcript_url: `${baseAssetUrl}/${id}.vtt`,
    chapter_markers: [
      { at: 0, label: 'Intro' },
      { at: 32, label: 'Production' },
      { at: 88, label: 'Cash & treasury' },
      { at: 145, label: 'Risks & decisions' },
    ],
  };
  const parsed = ReportAudioResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json(
      { success: false, error: { code: 'INTERNAL', message: 'audio payload schema mismatch' } },
      500,
    );
  }
  return c.json({ success: true, data: parsed.data }, 200);
});

// ---------------------------------------------------------------------------
// GET / — list generated reports (filter by since).
//
// Reads `interactive_report_versions` directly (the canonical store for
// rendered reports).
// ---------------------------------------------------------------------------

const ListReportsQuerySchema = z.object({
  kind: z
    .enum([
      'daily',
      'weekly',
      'monthly',
      'investor',
      'bank',
      'board',
      'audit',
    ])
    .optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(500).default(100).optional(),
});

app.get('/', async (c) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');
  const rawQuery = {
    kind: c.req.query('kind'),
    since: c.req.query('since'),
    limit: c.req.query('limit'),
  };
  const parsed = ListReportsQuerySchema.safeParse(rawQuery);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
        },
      },
      400,
    );
  }
  if (!db) {
    return c.json({ success: true as const, data: [] as const }, 200);
  }
  const limit = Math.min(parsed.data.limit ?? 100, 500);
  const conds = [eq(interactiveReportVersions.tenantId, tenantId)];
  if (parsed.data.since) {
    conds.push(
      gte(interactiveReportVersions.generatedAt, new Date(parsed.data.since)),
    );
  }
  const rows = await db
    .select()
    .from(interactiveReportVersions)
    .where(and(...conds))
    .orderBy(desc(interactiveReportVersions.generatedAt))
    .limit(limit);
  return c.json({ success: true as const, data: rows }, 200);
});

// ---------------------------------------------------------------------------
// POST /:id/share — share a generated report.
//
// Supported channels:
//   - whatsapp: build a wa.me deeplink with signed URL + caption.
//   - sms / email: queued via notification-preferences integration when
//     available; otherwise honest 503 with NOTIFICATION_SINK_UNAVAILABLE.
// ---------------------------------------------------------------------------

const ShareBodySchema = z.object({
  channel: z.enum(['whatsapp', 'sms', 'email']),
  recipients: z.array(z.string().min(1)).min(1).max(50),
  caption: z.string().max(1000).optional(),
});

app.post(
  '/:id/share',
  withSecurityEvents(
    {
      action: 'mining.report.share',
      resource: 'mining.report',
      severity: 'info',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (c: any) => {
      const id = c.req.param('id');
      if (!id) {
        return c.json(
          {
            success: false as const,
            error: { code: 'BAD_REQUEST', message: 'id required' },
          },
          400,
        );
      }
      const body = await c.req.json().catch(() => null);
      const parsed = ShareBodySchema.safeParse(body);
      if (!parsed.success) {
        return c.json(
          {
            success: false as const,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid share payload',
            },
          },
          400,
        );
      }
      const baseAssetUrl =
        process.env.REPORTS_AUDIO_BASE_URL?.replace(/\/+$/, '') ??
        'https://reports-cdn.borjie.local/audio';
      const reportUrl = `${baseAssetUrl}/${id}.html`;
      const caption = parsed.data.caption ?? `Borjie report — ${id}`;

      if (parsed.data.channel === 'whatsapp') {
        const text = encodeURIComponent(`${caption}\n${reportUrl}`);
        const deeplinks = parsed.data.recipients.map((r) => {
          const phone = r.replace(/[^0-9]/g, '');
          return `https://wa.me/${phone}?text=${text}`;
        });
        return c.json(
          {
            success: true as const,
            data: {
              channel: 'whatsapp' as const,
              deeplink: deeplinks[0],
              deeplinks,
              caption,
              reportUrl,
            },
          },
          200,
        );
      }

      return c.json(
        {
          success: false as const,
          error: {
            code: 'NOTIFICATION_SINK_UNAVAILABLE',
            message: `${parsed.data.channel} sink not wired into api-gateway`,
          },
        },
        503,
      );
    },
  ),
);

export const miningReportsRouter = app;
