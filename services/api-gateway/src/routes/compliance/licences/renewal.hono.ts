/**
 * Licence renewal routes — closes chain C-B (issue #194).
 *
 *   POST /licences/:id/start-renewal
 *   POST /licences/:id/submit-renewal
 *   GET  /licences/:id/renewal-status
 *
 * Mounted under `/api/v1/compliance` so callers reach this surface at
 * `/api/v1/compliance/licences/:id/start-renewal` etc. The licence
 * `id` is the row id from `licences` (mining title primary key).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { authMiddleware } from '../../../middleware/hono-auth';
import { routeCatch } from '../../../utils/safe-error';
import type { LicenceRenewalService } from '../../../services/regulator/licence-renewal-service';

const StartSchema = z.object({
  summary: z.string().min(1).max(500).optional(),
  draftBody: z.record(z.unknown()).optional(),
});

const SubmitSchema = z.object({
  submissionReference: z.string().min(1).max(200),
  evidenceDocId: z.string().min(1).max(200).optional(),
  renewalDocUrl: z.string().url().optional(),
});

export interface LicenceRenewalRouterDeps {
  readonly service: LicenceRenewalService;
}

export function createLicenceRenewalRouter(
  deps: LicenceRenewalRouterDeps,
): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/licences/:id/renewal-status', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const id = c.req.param('id');
    if (!tenantId || !id) {
      return c.json({ success: false, error: 'invalid-args' }, 400);
    }
    try {
      const view = await deps.service.renewalStatus(tenantId, id);
      if (!view) return c.json({ success: false, error: 'not-found' }, 404);
      return c.json({ success: true, data: view });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'LICENCE_RENEWAL_STATUS_FAILED',
        status: 503,
      });
    }
  });

  app.post(
    '/licences/:id/start-renewal',
    zValidator('json', StartSchema),
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId =
        (c.get('userId') as string | undefined) ?? 'unknown';
      const id = c.req.param('id');
      if (!tenantId || !id) {
        return c.json({ success: false, error: 'invalid-args' }, 400);
      }
      const body = c.req.valid('json');
      try {
        const event = await deps.service.startRenewal({
          tenantId,
          licenceId: id,
          actorId,
          ...(body.summary != null ? { summary: body.summary } : {}),
          ...(body.draftBody != null
            ? { draftBody: body.draftBody as Record<string, unknown> }
            : {}),
        });
        return c.json({ success: true, data: event }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'LICENCE_RENEWAL_START_FAILED',
          status: 500,
        });
      }
    },
  );

  app.post(
    '/licences/:id/submit-renewal',
    zValidator('json', SubmitSchema),
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId =
        (c.get('userId') as string | undefined) ?? 'unknown';
      const id = c.req.param('id');
      if (!tenantId || !id) {
        return c.json({ success: false, error: 'invalid-args' }, 400);
      }
      const body = c.req.valid('json');
      try {
        const event = await deps.service.submitRenewal({
          tenantId,
          licenceId: id,
          actorId,
          submissionReference: body.submissionReference,
          ...(body.evidenceDocId != null
            ? { evidenceDocId: body.evidenceDocId }
            : {}),
          ...(body.renewalDocUrl != null
            ? { renewalDocUrl: body.renewalDocUrl }
            : {}),
        });
        return c.json({ success: true, data: event });
      } catch (err) {
        return routeCatch(c, err, {
          code: 'LICENCE_RENEWAL_SUBMIT_FAILED',
          status: 409,
        });
      }
    },
  );

  return app;
}
