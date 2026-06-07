/**
 * /api/v1/mining/progressive — progressive-intelligence live coaching.
 *
 * Surfaces `@borjie/progressive-intelligence`'s live-coaching subsystem bound to
 * a REAL brain port. The package is pure + dependency-injected: its `coach()`
 * runs deterministic heuristics ALWAYS, and (when a `Brain` is supplied) appends
 * LLM-generated hints. This route is the package's live home — it constructs the
 * brain port from the gateway's per-tenant budget-guarded Anthropic client
 * (`anthropic-brain-port.ts` → `buildBudgetGuardedAnthropicClient`) and CONSUMES
 * the coaching output in the response.
 *
 * Routes:
 *   POST /coach   given a partial form (`workInProgress`) + its `schema`,
 *                 return the merged heuristic + brain-assisted coaching hints.
 *
 * Honest degradation (matches the package's documented contract):
 *   - No `ANTHROPIC_API_KEY` (registry's `buildBudgetGuardedAnthropicClient` is
 *     null) → heuristics-only hints; `brainAssisted: false`. Real, not faked.
 *   - Brain throws / budget exceeded → the adapter yields an `error` chunk and
 *     `coach()` falls back to heuristics-only. The route still returns 200 with
 *     the heuristic hints.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`. This route reads no
 * tenant tables directly (coaching operates on the caller-supplied form), but
 * the brain port is tenant-scoped via the budget guard so per-tenant cost
 * accounting + budget enforcement still apply.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  coach,
  type CoachingSchema,
  type CoachingSchemaField,
} from '@borjie/progressive-intelligence';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { createAnthropicBrainPort } from '../../composition/progressive/anthropic-brain-port';
import type { GuardedAnthropicFactory } from '../../composition/ai-native/llm-client';

const moduleLogger = createLogger('mining-progressive');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const MAX_COACH_TOKENS = 1024;

// ---------------------------------------------------------------------------
// Validation — mirrors CoachingSchema / CoachingSchemaField from the package.
// ---------------------------------------------------------------------------

const fieldSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['string', 'number', 'date', 'enum', 'boolean', 'json']),
  required: z.boolean().optional(),
  expectedRange: z
    .object({ min: z.number().optional(), max: z.number().optional() })
    .optional(),
  allowedValues: z.array(z.string()).max(200).optional(),
  label: z.string().max(200).optional(),
});

const coachRequestSchema = z.object({
  entityKind: z.string().min(1).max(120),
  fields: z.array(fieldSchema).min(1).max(200),
  workInProgress: z.record(z.unknown()),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(8000),
      }),
    )
    .max(50)
    .optional(),
  /** Skip the brain call and run heuristics-only (cheap path). */
  heuristicsOnly: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// POST /coach — merged heuristic + brain coaching hints.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/coach', async (c: any) => {
  const { tenantId } = c.get('auth');
  const body = await c.req.json().catch(() => null);
  const parsed = coachRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid coaching request' },
      },
      400,
    );
  }

  const schema: CoachingSchema = {
    entityKind: parsed.data.entityKind,
    fields: parsed.data.fields as ReadonlyArray<CoachingSchemaField>,
  };

  // Resolve the brain port from the registry's budget-guarded Anthropic client.
  const services = (c.get('services') ?? {}) as {
    buildBudgetGuardedAnthropicClient?: GuardedAnthropicFactory | null;
  };
  const buildClient = services.buildBudgetGuardedAnthropicClient ?? null;
  const useBrain = !parsed.data.heuristicsOnly && buildClient !== null;

  const brain = useBrain
    ? createAnthropicBrainPort({
        buildClient: buildClient as GuardedAnthropicFactory,
        tenantId,
        operation: 'progressive.coaching',
      })
    : undefined;

  try {
    const hints = await coach({
      workInProgress: parsed.data.workInProgress,
      schema,
      ...(parsed.data.history !== undefined
        ? { history: parsed.data.history }
        : {}),
      ...(brain !== undefined ? { brain } : {}),
      maxTokens: MAX_COACH_TOKENS,
    });
    return c.json(
      {
        success: true as const,
        data: {
          brainAssisted: useBrain,
          hints,
        },
      },
      200,
    );
  } catch (err) {
    // coach() already degrades brain failures to heuristics internally; a throw
    // here is unexpected (e.g. malformed schema slipping past zod). Surface a
    // clean 500 rather than leaking the stack.
    moduleLogger.warn(
      {
        route: 'progressive.coach',
        error: err instanceof Error ? err.message : String(err),
      },
      'progressive: coach failed',
    );
    return c.json(
      {
        success: false as const,
        error: { code: 'COACH_ERROR', message: 'Coaching failed' },
      },
      500,
    );
  }
});

export const miningProgressiveRouter = app;
export default app;
