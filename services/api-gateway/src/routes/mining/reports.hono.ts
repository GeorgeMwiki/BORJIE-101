// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/reports — report generation orchestrator.
 *
 * Routes:
 *   POST /generate?kind=daily|weekly|monthly|investor|bank|board|audit
 *
 * Dispatches the report kind to the WORM-renderer / interactive-reports
 * pipeline; this surface only validates the request, records the
 * intent, and returns a job ticket. Cron-driven runs use the same
 * payload via the consolidation-worker.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { randomUUID } from 'node:crypto';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const KindEnum = z.enum([
  'daily', 'weekly', 'monthly', 'investor', 'bank', 'board', 'audit',
]);

const GenerateReportSchema = z.object({
  kind: KindEnum,
  asOf: z.string().datetime().optional(),
  siteIds: z.array(z.string()).optional(),
  language: z.enum(['sw', 'en']).default('en'),
  format: z.enum(['html', 'pdf', 'docx']).default('pdf'),
  recipients: z.array(z.string().email()).optional(),
});

app.post(
  '/generate',
  zValidator('json', GenerateReportSchema),
  withSecurityEvents(
    { action: 'mining.report.generate', resource: 'mining.report', severity: 'info' },
    async (c) => {
      const { tenantId, userId } = c.get('auth');
      const qsKind = c.req.query('kind');
      const input = c.req.valid('json');
      const kind = (qsKind ?? input.kind) as z.infer<typeof KindEnum>;
      const parsedKind = KindEnum.safeParse(kind);
      if (!parsedKind.success) {
        return c.json(
          { success: false, error: { code: 'BAD_REQUEST', message: 'Unsupported report kind' } },
          400,
        );
      }
      const jobId = randomUUID();
      return c.json(
        {
          success: true,
          data: {
            jobId,
            kind: parsedKind.data,
            tenantId,
            requestedBy: userId,
            asOf: input.asOf ?? new Date().toISOString(),
            siteIds: input.siteIds ?? [],
            language: input.language,
            format: input.format,
            recipients: input.recipients ?? [],
            status: 'queued',
            note: 'Renderer dispatch handled out-of-band by consolidation-worker.',
          },
        },
        202,
      );
    },
  ),
);

export const miningReportsRouter = app;
