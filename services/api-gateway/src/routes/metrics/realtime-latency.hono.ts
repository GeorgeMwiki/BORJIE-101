/**
 * POST /api/v1/metrics/realtime-latency — RT-3.
 *
 * Cockpit-event SSE consumers POST one or more round-trip
 * measurements here. The body shape mirrors what a client computes:
 *
 *   { samples: [{ kind: 'task.assigned', latencyMs: 123 }, ...] }
 *
 * latencyMs = Date.now() at receipt − new Date(event.emittedAt).valueOf()
 *
 * Auth: any signed-in tenant user. Measurements are tenant-scoped via
 * `auth.tenantId`; we never accept a tenantId from the body.
 *
 * Rate posture: batched on the client side (the SSE handler flushes
 * every ~5 s or 25 events, whichever comes first). The route accepts
 * up to MAX_SAMPLES per request and rejects anything beyond.
 *
 * The aggregated stats are exposed via GET
 * `/api/v1/observability/realtime`.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { authMiddleware } from '../../middleware/hono-auth';
import { recordLatency } from '../../services/realtime-latency';

const MAX_SAMPLES = 50;

const SampleSchema = z.object({
  kind: z.string().min(1).max(80),
  latencyMs: z.number().int().min(0).max(60_000),
});

const BodySchema = z.object({
  samples: z.array(SampleSchema).min(1).max(MAX_SAMPLES),
});

export const realtimeLatencyRouter = new Hono();
realtimeLatencyRouter.use('*', authMiddleware);

realtimeLatencyRouter.post(
  '/realtime-latency',
  zValidator('json', BodySchema),
  (c) => {
    const auth = c.get('auth') as { tenantId?: string } | undefined;
    const tenantId = auth?.tenantId;
    if (!tenantId) {
      return c.json(
        {
          success: false as const,
          error: {
            code: 'TENANT_REQUIRED',
            message: 'auth.tenantId missing',
          },
        },
        401,
      );
    }
    const body = c.req.valid('json');
    for (const sample of body.samples) {
      recordLatency(tenantId, sample.latencyMs);
    }
    return c.json(
      {
        success: true as const,
        data: { accepted: body.samples.length },
      },
      202,
    );
  },
);

export default realtimeLatencyRouter;
