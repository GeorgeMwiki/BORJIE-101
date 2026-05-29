/**
 * Inspection narrative routes — closes chain C-C (issue #194).
 *
 *   POST /inspections/:id/generate-narrative
 *   POST /inspections/:id/sign-narrative
 *   POST /inspections/:id/submit-to-regulator
 *   GET  /inspections/:id/narratives
 *
 * Mounted under `/api/v1/compliance` so the canonical paths look
 * like `/api/v1/compliance/inspections/:id/generate-narrative`.
 *
 * The inspection `:id` references `pre_shift_inspections.id` (or any
 * future inspection-shaped table that supplies the LLM-input
 * snapshot via the injected `loadInspection` callback).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createHash } from 'node:crypto';

import { authMiddleware } from '../../../middleware/hono-auth';
import { routeCatch } from '../../../utils/safe-error';
import {
  INSPECTION_NARRATIVE_KINDS,
  INSPECTION_NARRATIVE_REGULATORS,
} from '@borjie/database/schemas';
import type {
  InspectionInputForLlm,
  InspectionNarrativeService,
} from '../../../services/inspection-narrative/generator';
import type {
  InspectionNarrativeKind,
  InspectionNarrativeRegulator,
} from '@borjie/database/schemas';

const GenerateSchema = z.object({
  inspectionKind: z
    .enum(INSPECTION_NARRATIVE_KINDS as unknown as [string, ...string[]])
    .default('safety'),
  notes: z.string().max(4000).optional(),
});

const SignSchema = z.object({
  /** Hex SHA-256 of the canonical PDF the owner signed. */
  canonicalPdfSha256: z.string().regex(/^[a-f0-9]{64}$/, {
    message: 'Expected hex SHA-256 (64 chars)',
  }),
});

const SubmitSchema = z.object({
  regulator: z.enum(
    INSPECTION_NARRATIVE_REGULATORS as unknown as [string, ...string[]],
  ),
  regulatorRef: z.string().min(1).max(200).optional(),
});

export interface InspectionNarrativeRouterDeps {
  readonly service: InspectionNarrativeService;
  /**
   * Resolves the upstream inspection (pre_shift_inspection etc.) into
   * the LLM input snapshot. Falls back to a stub when unbound so tests
   * can exercise the route surface without standing up DB fixtures.
   */
  readonly loadInspection?: (
    tenantId: string,
    inspectionId: string,
  ) => Promise<InspectionInputForLlm | null>;
}

export function createInspectionNarrativeRouter(
  deps: InspectionNarrativeRouterDeps,
): Hono {
  const app = new Hono();
  app.use('*', authMiddleware);

  app.get('/inspections/:id/narratives', async (c) => {
    const tenantId = c.get('tenantId') as string | undefined;
    const id = c.req.param('id');
    if (!tenantId || !id) {
      return c.json({ success: false, error: 'invalid-args' }, 400);
    }
    try {
      const rows = await deps.service.listForInspection(tenantId, id);
      return c.json({ success: true, data: rows });
    } catch (err) {
      return routeCatch(c, err, {
        code: 'INSPECTION_NARRATIVE_LIST_FAILED',
        status: 503,
      });
    }
  });

  app.post(
    '/inspections/:id/generate-narrative',
    zValidator('json', GenerateSchema),
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
        const fallbackInput: InspectionInputForLlm = {
          inspectionId: id,
          inspectionKind: body.inspectionKind as InspectionNarrativeKind,
          checklist: [],
          evidenceIds: [],
          observedAt: new Date(),
          ...(body.notes != null ? { notes: body.notes } : {}),
        };
        const llmInput =
          (await deps.loadInspection?.(tenantId, id)) ?? fallbackInput;
        const mergedNotes = body.notes ?? llmInput.notes;
        const llmWithNotes: InspectionInputForLlm = {
          ...llmInput,
          ...(mergedNotes != null ? { notes: mergedNotes } : {}),
        };

        const narrative = await deps.service.generateForInspection({
          tenantId,
          inspectionId: id,
          inspectionKind: body.inspectionKind as InspectionNarrativeKind,
          actorId,
          llm: llmWithNotes,
        });
        return c.json({ success: true, data: narrative }, 201);
      } catch (err) {
        return routeCatch(c, err, {
          code: 'INSPECTION_NARRATIVE_GENERATE_FAILED',
          status: 500,
        });
      }
    },
  );

  app.post(
    '/inspections/:id/narratives/:narrativeId/manager-approve',
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId =
        (c.get('userId') as string | undefined) ?? 'unknown';
      const narrativeId = c.req.param('narrativeId');
      if (!tenantId || !narrativeId) {
        return c.json({ success: false, error: 'invalid-args' }, 400);
      }
      try {
        const next = await deps.service.managerApprove(
          tenantId,
          narrativeId,
          actorId,
        );
        return c.json({ success: true, data: next });
      } catch (err) {
        return routeCatch(c, err, {
          code: 'INSPECTION_NARRATIVE_MANAGER_APPROVE_FAILED',
          status: 409,
        });
      }
    },
  );

  app.post(
    '/inspections/:id/narratives/:narrativeId/sign-narrative',
    zValidator('json', SignSchema),
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId =
        (c.get('userId') as string | undefined) ?? 'unknown';
      const narrativeId = c.req.param('narrativeId');
      if (!tenantId || !narrativeId) {
        return c.json({ success: false, error: 'invalid-args' }, 400);
      }
      const body = c.req.valid('json');
      try {
        const next = await deps.service.ownerSign({
          tenantId,
          narrativeId,
          actorId,
          canonicalPdfSha256: body.canonicalPdfSha256,
        });
        return c.json({ success: true, data: next });
      } catch (err) {
        return routeCatch(c, err, {
          code: 'INSPECTION_NARRATIVE_SIGN_FAILED',
          status: 409,
        });
      }
    },
  );

  app.post(
    '/inspections/:id/narratives/:narrativeId/submit-to-regulator',
    zValidator('json', SubmitSchema),
    async (c) => {
      const tenantId = c.get('tenantId') as string | undefined;
      const actorId =
        (c.get('userId') as string | undefined) ?? 'unknown';
      const narrativeId = c.req.param('narrativeId');
      if (!tenantId || !narrativeId) {
        return c.json({ success: false, error: 'invalid-args' }, 400);
      }
      const body = c.req.valid('json');
      try {
        const next = await deps.service.submitToRegulator({
          tenantId,
          narrativeId,
          actorId,
          regulator: body.regulator as InspectionNarrativeRegulator,
          ...(body.regulatorRef != null
            ? { regulatorRef: body.regulatorRef }
            : {}),
        });
        return c.json({ success: true, data: next });
      } catch (err) {
        return routeCatch(c, err, {
          code: 'INSPECTION_NARRATIVE_SUBMIT_FAILED',
          status: 409,
        });
      }
    },
  );

  return app;
}

/**
 * Helper exported for downstream callers (e.g. PDF generation) — keeps
 * the SHA-256 hashing logic in one place so the route + the brain
 * tool always produce byte-identical signatures.
 */
export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
