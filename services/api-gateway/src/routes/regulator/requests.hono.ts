/**
 * Regulator requests router — closes chain C-A (issue #194).
 *
 *   POST /requests                         — admin captures inbound request
 *   GET  /requests                         — list for tenant (admin / owner)
 *   GET  /requests/:id                     — fetch one
 *   POST /requests/:id/parse               — mark as parsed
 *   POST /requests/:id/approve-disclosure  — owner approves scope (WRITE)
 *   POST /requests/:id/export-redacted     — admin runs redactor + signs URL
 *   POST /requests/:id/deliver             — admin marks delivered
 *   POST /requests/:id/reject              — abort with reason
 *
 * All endpoints require auth; tenant id is bound by middleware (RLS
 * scope). Disclosure approval is owner-only (tier-T1+); export and
 * delivery require admin tier. Audit + cockpit-event emission happens
 * inside the service layer — no router-level audit calls.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createHash } from 'node:crypto';

import { authMiddleware } from '../../middleware/hono-auth';
import { routeCatch } from '../../utils/safe-error';
import {
  REGULATOR_KINDS,
  REGULATOR_REQUEST_SUBJECT_KINDS,
} from '@borjie/database/schemas';
import {
  redactSubject,
  type DisclosureScope,
  type RegulatorRequestService,
  type SubjectSnapshot,
} from '../../services/regulator/request-service';
import type {
  RegulatorKind,
  RegulatorRequestSubjectKind,
} from '@borjie/database/schemas';

// --------------------------------------------------------------------------
// Schemas
// --------------------------------------------------------------------------

const CreateRequestSchema = z.object({
  regulator: z.enum(REGULATOR_KINDS as unknown as [string, ...string[]]),
  regulatorRef: z.string().min(1).max(120).optional(),
  subjectKind: z.enum(
    REGULATOR_REQUEST_SUBJECT_KINDS as unknown as [string, ...string[]],
  ),
  subjectRef: z.string().min(1).max(200),
  summarySw: z.string().min(1).max(2000).optional(),
  summaryEn: z.string().min(1).max(2000).optional(),
  rawRequest: z.string().max(20000).optional(),
  dueAt: z.string().datetime().optional(),
});

const DisclosureScopeSchema = z.object({
  identity: z.boolean().optional(),
  contact: z.boolean().optional(),
  employment: z.boolean().optional(),
  compensation: z.boolean().optional(),
  geo: z.boolean().optional(),
});

const ApproveDisclosureSchema = z.object({
  approvedScope: DisclosureScopeSchema,
});

const RejectSchema = z.object({
  reason: z.string().min(3).max(1000),
});

// --------------------------------------------------------------------------
// Router
// --------------------------------------------------------------------------

export interface RegulatorRouterDeps {
  readonly service: RegulatorRequestService;
  readonly resolveSubject?: (
    tenantId: string,
    subjectKind: string,
    subjectRef: string,
  ) => Promise<SubjectSnapshot | null>;
  readonly buildSignedUrl?: (key: string) => Promise<string>;
}

export function createRegulatorRequestsRouter(
  deps: RegulatorRouterDeps,
): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    if (!tenantId) {
      return c.json({ success: false, error: 'tenant-unbound' }, 401);
    }
    try {
      const rows = await deps.service.list(tenantId);
      return c.json({ success: true, data: rows });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'REGULATOR_REQUESTS_LIST_FAILED',
        status: 503,
      });
    }
  });

  app.get('/:id', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const id = c.req.param('id');
    if (!tenantId || !id) {
      return c.json({ success: false, error: 'invalid-args' }, 400);
    }
    try {
      const row = await deps.service.byId(tenantId, id);
      if (!row) return c.json({ success: false, error: 'not-found' }, 404);
      return c.json({ success: true, data: row });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'REGULATOR_REQUEST_FETCH_FAILED',
        status: 503,
      });
    }
  });

  app.post(
    '/',
    zValidator('json', CreateRequestSchema),
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId = (c.get('userId') as string | undefined) ?? 'unknown';
      if (!tenantId) {
        return c.json({ success: false, error: 'tenant-unbound' }, 401);
      }
      const body = c.req.valid('json');
      try {
        const created = await deps.service.create({
          tenantId,
          regulator: body.regulator as RegulatorKind,
          subjectKind: body.subjectKind as RegulatorRequestSubjectKind,
          subjectRef: body.subjectRef,
          createdBy: actorId,
          ...(body.regulatorRef != null
            ? { regulatorRef: body.regulatorRef }
            : {}),
          ...(body.summarySw != null ? { summarySw: body.summarySw } : {}),
          ...(body.summaryEn != null ? { summaryEn: body.summaryEn } : {}),
          ...(body.rawRequest != null ? { rawRequest: body.rawRequest } : {}),
          ...(body.dueAt ? { dueAtOverride: new Date(body.dueAt) } : {}),
        });
        return c.json({ success: true, data: created }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'REGULATOR_REQUEST_CREATE_FAILED',
          status: 500,
        });
      }
    },
  );

  app.post('/:id/parse', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const actorId = (c.get('userId') as string | undefined) ?? 'unknown';
    const id = c.req.param('id');
    if (!tenantId || !id) {
      return c.json({ success: false, error: 'invalid-args' }, 400);
    }
    try {
      const parsed = await deps.service.markParsed(tenantId, id, actorId);
      // Auto-advance to owner-review so the cockpit pulses immediately.
      const ready = await deps.service.openForOwnerReview(
        tenantId,
        id,
        actorId,
      );
      void parsed;
      return c.json({ success: true, data: ready });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'REGULATOR_REQUEST_PARSE_FAILED',
        status: 409,
      });
    }
  });

  app.post(
    '/:id/approve-disclosure',
    zValidator('json', ApproveDisclosureSchema),
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId = (c.get('userId') as string | undefined) ?? 'unknown';
      const id = c.req.param('id');
      if (!tenantId || !id) {
        return c.json({ success: false, error: 'invalid-args' }, 400);
      }
      const body = c.req.valid('json');
      try {
        const next = await deps.service.approveDisclosure({
          tenantId,
          requestId: id,
          approvedScope: body.approvedScope as DisclosureScope,
          ownerId: actorId,
        });
        return c.json({ success: true, data: next });
      } catch (err) {
        return routeCatch(c, err, {
          code: 'REGULATOR_REQUEST_APPROVE_FAILED',
          status: 409,
        });
      }
    },
  );

  app.post('/:id/export-redacted', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const actorId = (c.get('userId') as string | undefined) ?? 'unknown';
    const id = c.req.param('id');
    if (!tenantId || !id) {
      return c.json({ success: false, error: 'invalid-args' }, 400);
    }
    try {
      const row = await deps.service.byId(tenantId, id);
      if (!row) return c.json({ success: false, error: 'not-found' }, 404);

      await deps.service.markExporting(tenantId, id, actorId);

      const subject =
        (await deps.resolveSubject?.(
          tenantId,
          row.subjectKind,
          row.subjectRef,
        )) ?? {
          id: row.subjectRef,
        };

      const scope = (row.approvedScope ?? {}) as DisclosureScope;
      const payload = redactSubject(subject, scope);
      const canonicalJson = JSON.stringify({
        request: {
          id: row.id,
          regulator: row.regulator,
          subjectKind: row.subjectKind,
          subjectRef: row.subjectRef,
        },
        scope,
        subject: payload,
        exportedAt: new Date().toISOString(),
      });
      const sha256 = createHash('sha256').update(canonicalJson).digest('hex');
      const docKey = `regulator-exports/${tenantId}/${row.id}.json`;
      const signedUrl =
        (await deps.buildSignedUrl?.(docKey)) ??
        `https://artifacts.borjie.local/${docKey}?sig=${sha256.slice(0, 16)}`;

      const updated = await deps.service.attachExport({
        tenantId,
        requestId: id,
        responseDocKey: docKey,
        responseDocUrl: signedUrl,
        responseDocSha256: sha256,
        actorId,
      });

      return c.json({
        success: true,
        data: {
          request: updated,
          artifact: {
            key: docKey,
            url: signedUrl,
            sha256,
            payload,
          },
        },
      });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'REGULATOR_REQUEST_EXPORT_FAILED',
        status: 500,
      });
    }
  });

  app.post('/:id/deliver', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const actorId = (c.get('userId') as string | undefined) ?? 'unknown';
    const id = c.req.param('id');
    if (!tenantId || !id) {
      return c.json({ success: false, error: 'invalid-args' }, 400);
    }
    try {
      const next = await deps.service.markDelivered({
        tenantId,
        requestId: id,
        actorId,
      });
      return c.json({ success: true, data: next });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'REGULATOR_REQUEST_DELIVER_FAILED',
        status: 409,
      });
    }
  });

  app.post(
    '/:id/reject',
    zValidator('json', RejectSchema),
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId = (c.get('userId') as string | undefined) ?? 'unknown';
      const id = c.req.param('id');
      if (!tenantId || !id) {
        return c.json({ success: false, error: 'invalid-args' }, 400);
      }
      const body = c.req.valid('json');
      try {
        const next = await deps.service.reject({
          tenantId,
          requestId: id,
          reason: body.reason,
          actorId,
        });
        return c.json({ success: true, data: next });
      } catch (err) {
        return routeCatch(c, err, {
          code: 'REGULATOR_REQUEST_REJECT_FAILED',
          status: 409,
        });
      }
    },
  );

  return app;
}
