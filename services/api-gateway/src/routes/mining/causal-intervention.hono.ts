/**
 * /api/v1/mining/causal — causal root-cause + counterfactual simulation.
 *
 * The gateway-side BFF for the chat Investigation Canvas's causal panel:
 *
 *   POST /root-cause   { metric, observedDeltaPct }
 *       Walk UPSTREAM the tenant's validated causal DAG from an observed
 *       KPI move to name its highest-leverage root cause + rule out the
 *       red herrings (delegates to `explainRootCause` from `causal-dag.ts`).
 *
 *   POST /simulate     { metric, intervention: { variable, newValue }, baseline? }
 *       Propagate a counterfactual perturbation along the DAG edges
 *       (strength × sign × lag) to compute the counterfactual value of the
 *       target KPI — "if we hedge USD now vs in 2 weeks, the difference is
 *       ~X" / "Pit-3 throughput +15% → runway +N days". Delegates to
 *       `simulateIntervention` from `counterfactual-sim.ts`. This is also
 *       the backend for the chat Investigation Canvas SIMULATION STRIP
 *       (factual vs counterfactual, delta propagated to the root KPI).
 *
 * HARD-RULE compliance (CLAUDE.md + WD2 invariants):
 *   - TENANT-SCOPED. `authMiddleware` + `databaseMiddleware` bind auth and
 *     the `app.current_tenant_id` RLS GUC. The causal DAG is built per the
 *     authenticated tenant (the brain's world-model is tenant-local); the
 *     pinned `c.get('db')` is the only series source — no cross-tenant read.
 *   - READ-ONLY. Both routes RETURN analysis. NOTHING here writes
 *     accounting truth, moves money, or touches a licence.
 *   - GOVERNED-ACTION SEAM. A "commit as plan" / intervention that ACTS is
 *     DELIBERATELY NOT executed here. `/simulate` returns the simulation;
 *     any real action MUST be routed by the caller through the existing
 *     governed action membrane (autonomy gate / four-eye / propose-only).
 *     We surface the seam in the response (`governedActionSeam`) but never
 *     auto-actuate. See `needsAttention` in the agent manifest.
 *   - HONEST-DEGRADE envelopes. An off-DAG variable, an unreachable target,
 *     a below-confidence path, or an unestablished cause returns an
 *     explicit low-confidence / cannot-simulate envelope — never a
 *     fabricated number. These are NOT HTTP errors: the brain renders the
 *     "cannot establish" honestly.
 *   - PINO logger only; immutable; zod-validated input.
 *
 * The DAG itself is built by `buildCausalDag` (Wave D sibling); this route
 * never redefines it. With no series in the window the DAG degrades to
 * data-less nodes + zero edges, and both routes return honest "cannot
 * establish" envelopes rather than inventing structure.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import {
  buildCausalDag,
  simulateIntervention,
} from '../../composition/knowledge-graph/counterfactual-sim';
import {
  explainRootCause,
  type CausalMetric,
} from '../../composition/knowledge-graph/causal-dag';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-causal-intervention');

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ─────────────────────────────────────────────────────────────────────
// Schemas — the metric is a closed union (the DAG's canonical node set).
// ─────────────────────────────────────────────────────────────────────

const causalMetricSchema = z.enum([
  'cash_runway',
  'sales_receipts',
  'production_tonnage',
  'royalty_filing_lateness',
]);

// Compile-time guard: the enum's inferred output MUST equal the canonical
// `CausalMetric` union from `causal-dag.ts` (bidirectional assignability).
// If a metric is added/renamed in the DAG and not here, this fails to build.
type _MetricInExact = z.infer<typeof causalMetricSchema> extends CausalMetric
  ? CausalMetric extends z.infer<typeof causalMetricSchema>
    ? true
    : never
  : never;
const _metricExhaustiveness: _MetricInExact = true;
void _metricExhaustiveness;

const rootCauseSchema = z
  .object({
    /** The KPI that was observed to move. */
    metric: causalMetricSchema,
    /** The observed fractional move of the KPI (e.g. −0.18 for a −18% dip). */
    observedDeltaPct: z.number().finite(),
  })
  .strict();

const interventionSchema = z
  .object({
    /** The metric node to perturb. */
    variable: causalMetricSchema,
    /** The counterfactual value to set the variable to. */
    newValue: z.number().finite(),
  })
  .strict();

const baselineSchema = z.record(causalMetricSchema, z.number().finite());

const simulateSchema = z
  .object({
    /** The KPI metric to read the simulated effect on. */
    metric: causalMetricSchema,
    intervention: interventionSchema,
    /** Observed factual values keyed by metric (incl. the variable). */
    baseline: baselineSchema.optional(),
    /** Refuse to emit below this multiplicative path-confidence. */
    confidenceFloor: z.number().min(0).max(1).optional(),
    /** Max hops to propagate. */
    maxDepth: z.number().int().positive().max(8).optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

async function readJson(c: { req: { json: () => Promise<unknown> } }) {
  try {
    return { ok: true as const, value: await c.req.json() };
  } catch {
    return { ok: false as const };
  }
}

/**
 * The governed-action seam descriptor returned alongside a simulation. The
 * FE renders a "commit as plan" affordance from this, but committing routes
 * through the EXISTING governed action membrane — never auto-actuated here.
 */
const GOVERNED_ACTION_SEAM = Object.freeze({
  executedHere: false,
  channel: 'governed-action-membrane',
  note: 'This is a read-only simulation. To act on it, route a proposal through the autonomy gate / four-eye / propose-only path; never auto-actuate from the causal route.',
});

// ─────────────────────────────────────────────────────────────────────
// POST /root-cause — name the highest-leverage upstream cause of a move.
// ─────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/root-cause', async (c: any) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');

  const body = await readJson(c);
  if (!body.ok) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' },
      },
      400,
    );
  }

  const parsed = rootCauseSchema.safeParse(body.value);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid root-cause request.',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  try {
    // Build the tenant's validated DAG from its own windowed series. With no
    // db (or no series) this degrades to data-less nodes + zero edges, and
    // explainRootCause returns { established: false } — an honest envelope.
    const dag = await buildCausalDag(db ?? null, tenantId);
    const result = explainRootCause(dag, {
      metric: parsed.data.metric,
      observedDeltaPct: parsed.data.observedDeltaPct,
      // Pass the SAME series the DAG was built from so ancestor scoring can run
      // (a node earns leverage only if it itself moved) — without this, scoring
      // degrades to edge-strength-only and never establishes a cause.
      series: dag.series,
    });
    return c.json({ success: true as const, data: result }, 200);
  } catch (err) {
    moduleLogger.error('causal root-cause failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
      metric: parsed.data.metric,
    });
    // Honest-degrade envelope — never a fabricated cause.
    return c.json(
      {
        success: false as const,
        error: {
          code: 'ROOT_CAUSE_FAILED',
          message: 'Root cause could not be established for this metric.',
        },
      },
      422,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /simulate — counterfactual intervention → effect on the KPI.
// ─────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post('/simulate', async (c: any) => {
  const { tenantId } = c.get('auth');
  const db = c.get('db');

  const body = await readJson(c);
  if (!body.ok) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_JSON', message: 'Request body must be JSON.' },
      },
      400,
    );
  }

  const parsed = simulateSchema.safeParse(body.value);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid simulation request.',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }

  let result;
  try {
    const dag = await buildCausalDag(db ?? null, tenantId);
    result = simulateIntervention(
      dag,
      parsed.data.baseline ?? {},
      parsed.data.intervention,
      parsed.data.metric,
      {
        ...(parsed.data.confidenceFloor !== undefined
          ? { confidenceFloor: parsed.data.confidenceFloor }
          : {}),
        ...(parsed.data.maxDepth !== undefined
          ? { maxDepth: parsed.data.maxDepth }
          : {}),
      },
    );
  } catch (err) {
    moduleLogger.error('causal simulate failed', {
      err: err instanceof Error ? err.message : String(err),
      tenantId,
      metric: parsed.data.metric,
      variable: parsed.data.intervention.variable,
    });
    return c.json(
      {
        success: false as const,
        error: {
          code: 'SIMULATE_FAILED',
          message: 'The intervention could not be simulated.',
        },
      },
      422,
    );
  }

  // A cannot-simulate / below-floor result is NOT an HTTP error — it is a
  // valid, honest low-confidence envelope. The brain renders it as an
  // explicit "cannot establish" rather than inventing a number.
  return c.json(
    {
      success: true as const,
      data: {
        simulation: result,
        // The seam: acting on this simulation is governed, never auto-run.
        governedActionSeam: GOVERNED_ACTION_SEAM,
      },
    },
    200,
  );
});

export const miningCausalInterventionRouter = app;
export default app;
