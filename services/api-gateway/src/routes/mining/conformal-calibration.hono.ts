/**
 * /api/v1/mining/conformal — online conformal calibration coverage-feedback API.
 *
 * Surfaces the REAL ACI loop (`@borjie/conformal-calibration-online`) wired onto
 * durable tenant-scoped state (migration 0299). This is the live home of the
 * prediction → outcome → coverage-feedback cycle:
 *
 *   POST /predictions   enroll an emitted prediction + its interval into the
 *                       loop; the response echoes the alpha in force at emit.
 *   POST /observations  record a landed outcome (covered or not); the loop folds
 *                       it through `updateConformal` and returns the new alpha.
 *   GET  /state         the persisted ACI state for a prediction type (alpha +
 *                       rolling window + observation count) PLUS the current
 *                       calibrated alpha, or a cold-start default when none
 *                       exists yet.
 *
 * CONSUMPTION (the load-bearing part): `getCalibratedAlpha(predictionType)` is
 * the value the brain's CONFIDENCE path consumes —
 * `@borjie/cognitive-engine`'s `calibrateConfidence({ ..., calibrated_alpha })`
 * shifts its high/medium/low thresholds by this alpha (see the cognitive-engine
 * `confidence-calibrator` edit + its unit tests, and the `cognitive-loop`
 * wiring instruction in the integration notes). This route persists + advances
 * the alpha; the cognitive-engine path turns it into a confidence-label change.
 * (The confidence demonstration lives in the cognitive-engine package, which is
 * intentionally NOT an api-gateway dependency, so it is not re-imported here.)
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; the store is built
 * from the request-scoped tenant-pinned Drizzle connection and every query also
 * passes `tenantId` (defence in depth). EVERY conformal_* table FORCE-enables
 * RLS on the canonical GUC (migration 0299).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { createDrizzleConformalStore } from '../../composition/conformal/drizzle-conformal-store';
import { createConformalCalibrationLoop } from '../../composition/conformal/conformal-calibration-loop';

const moduleLogger = createLogger('mining-conformal');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PREDICTION_TYPE = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9_.:-]+$/i, 'prediction_type must be a simple slug');

const enrollPredictionSchema = z.object({
  predictionId: z.string().min(1).max(200),
  predictionType: PREDICTION_TYPE,
  predictedValue: z.number().finite().optional(),
  predictedLower: z.number().finite().optional(),
  predictedUpper: z.number().finite().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const recordObservationSchema = z.object({
  predictionId: z.string().min(1).max(200),
  predictionType: PREDICTION_TYPE,
  observedValue: z.number().finite().optional(),
  covered: z.boolean().optional(),
  observedAtIso: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const stateQuerySchema = z.object({
  predictionType: PREDICTION_TYPE,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function validationError(c: any, message: string) {
  return c.json(
    { success: false as const, error: { code: 'VALIDATION_ERROR', message } },
    400,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLoop(c: any) {
  const db = c.get('db');
  if (!db) return null;
  const store = createDrizzleConformalStore(db);
  return createConformalCalibrationLoop({
    store,
    logger: {
      warn: (obj, msg) => moduleLogger.warn(obj, msg ?? 'conformal loop'),
    },
  });
}

// ---------------------------------------------------------------------------
// POST /predictions — enroll an emitted prediction into the loop.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/predictions', async (c: any) => {
  const { tenantId, userId } = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = enrollPredictionSchema.safeParse(body);
  if (!parsed.success) return validationError(c, 'Invalid prediction payload');
  const loop = buildLoop(c);
  if (!loop) {
    return c.json(
      { success: false as const, error: { code: 'DB_UNAVAILABLE', message: 'Database not available' } },
      503,
    );
  }
  const { alphaAtEmit } = await loop.recordPrediction({
    tenantId,
    predictionId: parsed.data.predictionId,
    predictionType: parsed.data.predictionType,
    ...(parsed.data.predictedValue !== undefined
      ? { predictedValue: parsed.data.predictedValue }
      : {}),
    ...(parsed.data.predictedLower !== undefined
      ? { predictedLower: parsed.data.predictedLower }
      : {}),
    ...(parsed.data.predictedUpper !== undefined
      ? { predictedUpper: parsed.data.predictedUpper }
      : {}),
    ...(parsed.data.metadata !== undefined
      ? { metadata: parsed.data.metadata }
      : {}),
    ...(typeof userId === 'string' ? { createdBy: userId } : {}),
  });
  return c.json(
    { success: true as const, data: { predictionId: parsed.data.predictionId, alphaAtEmit } },
    201,
  );
});

// ---------------------------------------------------------------------------
// POST /observations — record a landed outcome; advance the ACI state.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/observations', async (c: any) => {
  const { tenantId, userId } = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = recordObservationSchema.safeParse(body);
  if (!parsed.success) return validationError(c, 'Invalid observation payload');
  const loop = buildLoop(c);
  if (!loop) {
    return c.json(
      { success: false as const, error: { code: 'DB_UNAVAILABLE', message: 'Database not available' } },
      503,
    );
  }
  const result = await loop.recordOutcome({
    tenantId,
    predictionId: parsed.data.predictionId,
    predictionType: parsed.data.predictionType,
    ...(parsed.data.observedValue !== undefined
      ? { observedValue: parsed.data.observedValue }
      : {}),
    ...(parsed.data.covered !== undefined ? { covered: parsed.data.covered } : {}),
    ...(parsed.data.observedAtIso !== undefined
      ? { observedAtIso: parsed.data.observedAtIso }
      : {}),
    ...(parsed.data.metadata !== undefined
      ? { metadata: parsed.data.metadata }
      : {}),
    ...(typeof userId === 'string' ? { createdBy: userId } : {}),
  });
  if (result === null) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'UNRESOLVABLE_COVERAGE',
          message:
            'Observation needs an explicit `covered` flag (no interval to derive it from).',
        },
      },
      422,
    );
  }
  return c.json({ success: true as const, data: { alpha: result.alpha } }, 200);
});

// ---------------------------------------------------------------------------
// GET /state — persisted ACI state for a prediction type.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.get('/state', async (c: any) => {
  const { tenantId } = c.get('auth');
  const parsed = stateQuerySchema.safeParse({
    predictionType: c.req.query('predictionType'),
  });
  if (!parsed.success) return validationError(c, 'predictionType is required');
  const loop = buildLoop(c);
  if (!loop) {
    return c.json({ success: true as const, data: null }, 200);
  }
  const calibration = await loop.getCalibration(
    tenantId,
    parsed.data.predictionType,
  );
  const alpha = await loop.getCalibratedAlpha(
    tenantId,
    parsed.data.predictionType,
  );
  return c.json(
    {
      success: true as const,
      data: {
        predictionType: parsed.data.predictionType,
        alpha,
        coldStart: calibration === null,
        calibration,
      },
    },
    200,
  );
});

export const miningConformalRouter = app;
export default app;
