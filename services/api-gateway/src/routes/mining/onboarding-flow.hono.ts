/**
 * /api/v1/mining/onboarding — FLOW-2 stepped orchestrator handlers.
 *
 * The owner-web onboarding wizard drives three verbs
 * (apps/owner-web/src/lib/queries/onboarding.ts):
 *   POST /start     — create a fresh onboarding run.
 *   POST /advance   — persist a step payload + advance to the next step.
 *   POST /complete  — finalise the run + seed the cockpit.
 *
 * State persists in `mining_onboarding_runs` (migration 0286) so a reload
 * resumes where the owner left off. Each step's payload — INCLUDING uploaded
 * file references — is recorded in the run's `steps` jsonb (not discarded).
 *
 * These are registered onto the SAME Hono app as /ingest + /commit (which
 * already mounts authMiddleware + databaseMiddleware), via
 * `registerOnboardingFlowRoutes(app)`, so the wizard verbs share the
 * `/onboarding` mount and the existing middleware chain. Split into this file
 * to keep onboarding.hono.ts under the 800-line budget (CONTRIBUTING.md).
 *
 * HONESTY (CLAUDE.md): the wizard uploads only file NAMES for the licences /
 * sites / drill_holes steps, so those refs are persisted but their BYTES are
 * not ingested here (`bytesPersisted:false` is returned). Real bytes-and-OCR →
 * domain-row insertion is the SEPARATE /ingest + /commit recipe path, which
 * needs a `sample` or `ocr_extraction_id`. We never fabricate inserts.
 *
 * Money: NONE — onboarding never moves money. RLS GUC-bound by the middleware;
 * every statement also binds tenant_id (belt-and-braces).
 */

import type { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import {
  startRun,
  loadRun,
  advanceRun,
  completeRun,
  validateStepPayload,
  ONBOARDING_STEP_ORDER,
  type OnboardingDb,
  type OnboardingStep,
} from './onboarding-orchestrator';

const advanceBodySchema = z.object({
  sessionId: z.string().uuid(),
  step: z.enum(ONBOARDING_STEP_ORDER),
  payload: z.unknown(),
});

const completeBodySchema = z.object({
  sessionId: z.string().uuid(),
});

function dbUnavailable(c: {
  json: (body: unknown, status: number) => Response;
}): Response {
  return c.json(
    {
      success: false as const,
      error: { code: 'LIVE_DATA_NOT_CONFIGURED', message: 'Database unavailable.' },
    },
    503,
  );
}

/**
 * Register the three FLOW-2 handlers onto an existing Hono app that already
 * carries authMiddleware + databaseMiddleware. `c.get('auth')` and
 * `c.get('db')` are provided by that chain.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerOnboardingFlowRoutes(app: Hono<any>): void {
  // ── POST /start ──────────────────────────────────────────────────────────
  app.post('/start', async (c) => {
    const { tenantId, userId } = c.get('auth');
    const db = c.get('db') as OnboardingDb | null;
    if (!db) return dbUnavailable(c);
    try {
      const state = await startRun(db, tenantId, userId);
      logger.info({ tenantId, sessionId: state.sessionId }, 'onboarding run started');
      return c.json(
        {
          success: true as const,
          data: { sessionId: state.sessionId, currentStep: state.currentStep },
        },
        201,
      );
    } catch (error) {
      logger.error({ err: error, tenantId }, 'onboarding start failed');
      return c.json(
        {
          success: false as const,
          error: { code: 'START_FAILED', message: 'Could not start onboarding.' },
        },
        500,
      );
    }
  });

  // ── POST /advance ────────────────────────────────────────────────────────
  app.post('/advance', async (c) => {
    const { tenantId } = c.get('auth');
    const db = c.get('db') as OnboardingDb | null;
    if (!db) return dbUnavailable(c);

    let body: z.infer<typeof advanceBodySchema>;
    try {
      body = advanceBodySchema.parse(await c.req.json());
    } catch (error) {
      return c.json(
        {
          success: false as const,
          error: { code: 'INVALID_BODY', message: (error as Error).message },
        },
        400,
      );
    }

    const run = await loadRun(db, tenantId, body.sessionId);
    if (!run) {
      return c.json(
        {
          success: false as const,
          error: { code: 'SESSION_NOT_FOUND', message: 'Onboarding session not found.' },
        },
        404,
      );
    }
    if (run.status !== 'in_progress') {
      return c.json(
        {
          success: false as const,
          error: { code: 'SESSION_CLOSED', message: `Onboarding session is ${run.status}.` },
        },
        409,
      );
    }

    let validated: unknown;
    try {
      validated = validateStepPayload(body.step as OnboardingStep, body.payload);
    } catch (error) {
      return c.json(
        {
          success: false as const,
          error: { code: 'INVALID_STEP_PAYLOAD', message: (error as Error).message },
        },
        400,
      );
    }

    try {
      const result = await advanceRun({
        db,
        tenantId,
        run,
        step: body.step as OnboardingStep,
        payload: validated,
      });
      logger.info(
        {
          tenantId,
          sessionId: run.sessionId,
          step: body.step,
          fileRefsPersisted: result.fileRefsPersisted,
          bytesPersisted: result.bytesPersisted,
        },
        'onboarding step advanced',
      );
      return c.json(
        {
          success: true as const,
          data: {
            sessionId: result.sessionId,
            currentStep: result.currentStep,
            persistedStep: result.persistedStep,
            fileRefsPersisted: result.fileRefsPersisted,
            // Surfaced honestly: file-bearing steps record refs only here; the
            // bytes-and-OCR → domain-rows path is /ingest + /commit.
            bytesPersisted: result.bytesPersisted,
          },
        },
        200,
      );
    } catch (error) {
      logger.error(
        { err: error, tenantId, sessionId: run.sessionId, step: body.step },
        'onboarding advance failed',
      );
      return c.json(
        {
          success: false as const,
          error: { code: 'ADVANCE_FAILED', message: 'Could not persist the step.' },
        },
        500,
      );
    }
  });

  // ── POST /complete ───────────────────────────────────────────────────────
  app.post('/complete', async (c) => {
    const { tenantId } = c.get('auth');
    const db = c.get('db') as OnboardingDb | null;
    if (!db) return dbUnavailable(c);

    let body: z.infer<typeof completeBodySchema>;
    try {
      body = completeBodySchema.parse(await c.req.json());
    } catch (error) {
      return c.json(
        {
          success: false as const,
          error: { code: 'INVALID_BODY', message: (error as Error).message },
        },
        400,
      );
    }

    const run = await loadRun(db, tenantId, body.sessionId);
    if (!run) {
      return c.json(
        {
          success: false as const,
          error: { code: 'SESSION_NOT_FOUND', message: 'Onboarding session not found.' },
        },
        404,
      );
    }

    try {
      const result = await completeRun({ db, tenantId, run });
      logger.info(
        { tenantId, sessionId: run.sessionId },
        'onboarding run completed + cockpit seeded',
      );
      return c.json(
        {
          success: true as const,
          data: {
            sessionId: result.sessionId,
            currentStep: result.currentStep,
            status: result.status,
            cockpitSeed: result.cockpitSeed,
          },
        },
        200,
      );
    } catch (error) {
      logger.error(
        { err: error, tenantId, sessionId: run.sessionId },
        'onboarding complete failed',
      );
      return c.json(
        {
          success: false as const,
          error: { code: 'COMPLETE_FAILED', message: 'Could not finalise onboarding.' },
        },
        500,
      );
    }
  });
}
