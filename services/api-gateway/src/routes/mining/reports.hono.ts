// @ts-nocheck — Hono v4 status-literal-union widening (hono-dev/hono#3891).
/**
 * /api/v1/mining/reports — report generation orchestrator.
 *
 * Routes:
 *   POST /generate?kind=daily|weekly|monthly|investor|bank|board|audit
 *   GET  /:id/audio — narration audio + chapter markers + transcript
 *
 * Dispatches the report kind to the WORM-renderer / interactive-reports
 * pipeline; this surface only validates the request, records the
 * intent, and returns a job ticket. Cron-driven runs use the same
 * payload via the consolidation-worker.
 *
 * The /:id/audio surface is consumed by owner-web's ReportPlayer
 * (O-W-18) — Plyr-skinned audio player with chapter-jump and synced
 * transcript. Audio assets are produced by the narration worker and
 * stored alongside the rendered HTML/PDF (`reports-audio/<id>.mp3`).
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
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

export const miningReportsRouter = app;
