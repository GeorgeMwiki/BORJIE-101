/**
 * Outcome Reconciliation Worker - Wave CLOSED-LOOP.
 *
 * Ticks every 6 hours. For each row in `outcome_predictions` where:
 *   - `created_at + prediction_horizon_days <= now()` (the horizon has
 *     elapsed)
 *   - no companion row in `outcome_reconciliations` yet
 *   - `prediction_confidence > 0` (skip the explicit "unmodeled" rows -
 *     the wrapper writes those when it honestly cannot forecast)
 *
 * the worker:
 *   1. Resolves the target entity's CURRENT state via a per-entity
 *      resolver (closed-loop: the worker observes reality through the
 *      same data plane the brain reads from).
 *   2. Shapes the `observed_outcome` jsonb to mirror the prediction's
 *      envelope.
 *   3. Inserts the `outcome_observations` row.
 *   4. Computes `drift_score`:
 *        - scalar predictions (predicted_value_tzs set): abs(% delta)
 *          clamped to [0,1].
 *        - vector predictions (jsonb shape): cosine-like distance over
 *          shared keys; 0 = identical, 1 = no overlap.
 *   5. Inserts the `outcome_reconciliations` row with status:
 *        - matched      drift < 0.15
 *        - divergent    drift > 0.40
 *        - undetermined 0.15 <= drift <= 0.40
 *        - expired      observation could not be computed
 *   6. Generates a `learning_signal` jsonb capturing which features
 *      predicted well or poorly.
 *   7. Extends the AI hash-chain with the reconciliation record so a
 *      tamper of either table breaks chain verification.
 *
 * Lifecycle:
 *   - `start()` arms an interval (default 6h - tunable via env).
 *   - `tickOnce()` exposed for tests.
 *   - `stop()` clears the timer.
 *
 * Failure containment:
 *   - No DB → no-op + warn once.
 *   - Per-row failures isolated; loop continues.
 *   - All errors logged via Pino.
 */

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';
import { withWorkerTenantContext } from './with-tenant-context.js';
import { withServiceRoleContext } from '@borjie/database';
import { feedReconciliationToConformal } from '../composition/conformal/reconciliation-conformal-feed.js';
import { reflexion as kernelReflexion } from '@borjie/central-intelligence';

type ReflexionRecorderPort = kernelReflexion.ReflexionRecorderPort;

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_BATCH = 50;
const MATCHED_DRIFT_BAND = 0.15;
const DIVERGENT_DRIFT_BAND = 0.40;

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * The db type accepted by `withServiceRoleContext`. The worker's `db` satisfies
 * both this and the lightweight `DbLike.execute` shim; the cross-tenant claim
 * scan binds `app.is_service_role='true'` through this port so FORCE-RLS does
 * not silently filter the discovery SELECT to zero rows over the shared pool.
 */
type ServiceRoleDb = Parameters<typeof withServiceRoleContext>[0];

interface PendingPrediction {
  readonly id: string;
  readonly tenantId: string;
  readonly actorKind: string;
  readonly actionKind: string;
  readonly actionTargetEntityType: string;
  readonly actionTargetEntityId: string;
  readonly predictedOutcome: Record<string, unknown>;
  readonly predictedValueTzs: number | null;
  readonly predictionConfidence: number;
  readonly rationale: string;
}

export interface ObservationResolverInput {
  readonly tenantId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly predictedOutcome: Readonly<Record<string, unknown>>;
}

export interface ObservationResolverResult {
  readonly observedOutcome: Readonly<Record<string, unknown>>;
  readonly observedValueTzs: number | null;
  readonly narrative: string;
}

/**
 * Resolver port. The production composition root binds one resolver per
 * `entityType` (licence / royalty_filing / shipment / counterparty / ...);
 * tests can pass an in-memory map. Returning `null` lands the
 * reconciliation in `expired` status so the prediction is closed out
 * cleanly rather than dangling forever.
 */
export type ObservationResolver = (
  input: ObservationResolverInput,
) => Promise<ObservationResolverResult | null>;

export interface ReconciliationWorkerOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  /** Per-entity-type observation resolvers. */
  readonly resolvers: Readonly<Record<string, ObservationResolver>>;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
  /**
   * WIN-2 — self-correcting memory. When bound, a `divergent` reconciliation
   * whose drift exceeds {@link reflexionDriftFloor} is synthesised into a durable
   * reflexion lesson (the SAME `reflexion_buffer` the chat path writes), so the
   * nightly sleep pass can cluster recurring surprises into a guideline the next
   * inference reads back. When omitted the worker behaves exactly as before
   * (honest-degrade — the surprise is still recorded in the audit chain + the
   * conformal loop). Best-effort: a recorder fault never fails the reconciliation.
   */
  readonly reflexionRecorder?: ReflexionRecorderPort | null;
  /**
   * Drift floor (0..1) above which a divergent reconciliation becomes a lesson.
   * Below it, a small miss is noise — not worth a durable reflexion. Default 0.5.
   */
  readonly reflexionDriftFloor?: number;
}

export interface ReconciliationWorkerHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<ReconciliationTickResult>;
}

export interface ReconciliationTickResult {
  readonly claimed: number;
  readonly matched: number;
  readonly divergent: number;
  readonly undetermined: number;
  readonly expired: number;
  readonly errored: number;
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function rowToPrediction(r: Record<string, unknown>): PendingPrediction | null {
  const id = typeof r.id === 'string' ? r.id : null;
  const tenantId = typeof r.tenant_id === 'string' ? r.tenant_id : null;
  const actorKind = typeof r.actor_kind === 'string' ? r.actor_kind : null;
  const actionKind = typeof r.action_kind === 'string' ? r.action_kind : null;
  const entityType =
    typeof r.action_target_entity_type === 'string'
      ? r.action_target_entity_type
      : null;
  const entityId =
    typeof r.action_target_entity_id === 'string'
      ? r.action_target_entity_id
      : null;
  if (!id || !tenantId || !actorKind || !actionKind || !entityType || !entityId) {
    return null;
  }
  const confidence = toNumber(r.prediction_confidence) ?? 0;
  return {
    id,
    tenantId,
    actorKind,
    actionKind,
    actionTargetEntityType: entityType,
    actionTargetEntityId: entityId,
    predictedOutcome: toJsonRecord(r.predicted_outcome),
    predictedValueTzs: toNumber(r.predicted_value_tzs),
    predictionConfidence: confidence,
    rationale: typeof r.rationale === 'string' ? r.rationale : '',
  };
}

/**
 * Scalar drift: abs(% delta) clamped to [0,1]. Returns 1 when the
 * predicted value is 0 and observed is non-zero (no proportional
 * baseline). Returns 0 when both are 0.
 */
export function scalarDrift(predicted: number, observed: number): number {
  if (predicted === 0 && observed === 0) return 0;
  if (predicted === 0) return 1;
  const ratio = Math.abs((observed - predicted) / predicted);
  return Math.min(1, ratio);
}

/**
 * Vector drift over jsonb envelopes: 1 - cosine-similarity-like score
 * over shared scalar keys. Booleans count as 0/1, strings as exact
 * match (1/0). Unknown keys reduce the similarity but never raise
 * drift above 1.
 */
export function vectorDrift(
  predicted: Readonly<Record<string, unknown>>,
  observed: Readonly<Record<string, unknown>>,
): number {
  const keys = new Set<string>([
    ...Object.keys(predicted),
    ...Object.keys(observed),
  ]);
  if (keys.size === 0) return 0;
  let agree = 0;
  let total = 0;
  for (const key of keys) {
    total += 1;
    const a = predicted[key];
    const b = observed[key];
    if (a === undefined || b === undefined) continue;
    if (typeof a === 'number' && typeof b === 'number') {
      agree += 1 - scalarDrift(a, b);
      continue;
    }
    if (typeof a === 'boolean' && typeof b === 'boolean') {
      agree += a === b ? 1 : 0;
      continue;
    }
    if (typeof a === 'string' && typeof b === 'string') {
      agree += a === b ? 1 : 0;
      continue;
    }
  }
  const sim = total === 0 ? 0 : agree / total;
  return Math.max(0, Math.min(1, 1 - sim));
}

function classify(drift: number): 'matched' | 'divergent' | 'undetermined' {
  if (drift < MATCHED_DRIFT_BAND) return 'matched';
  if (drift > DIVERGENT_DRIFT_BAND) return 'divergent';
  return 'undetermined';
}

function buildLearningSignal(
  prediction: PendingPrediction,
  observed: Readonly<Record<string, unknown>>,
  drift: number,
  status: 'matched' | 'divergent' | 'undetermined',
): Record<string, unknown> {
  const wellPredictedKeys: string[] = [];
  const poorlyPredictedKeys: string[] = [];
  for (const key of Object.keys(prediction.predictedOutcome)) {
    const a = prediction.predictedOutcome[key];
    const b = observed[key];
    if (a === undefined || b === undefined) continue;
    if (typeof a === 'number' && typeof b === 'number') {
      if (scalarDrift(a, b) < MATCHED_DRIFT_BAND) wellPredictedKeys.push(key);
      else poorlyPredictedKeys.push(key);
    } else if (a === b) {
      wellPredictedKeys.push(key);
    } else {
      poorlyPredictedKeys.push(key);
    }
  }
  return Object.freeze({
    action_kind: prediction.actionKind,
    actor_kind: prediction.actorKind,
    entity_type: prediction.actionTargetEntityType,
    status,
    drift_score: Number(drift.toFixed(4)),
    confidence: prediction.predictionConfidence,
    well_predicted_keys: wellPredictedKeys,
    poorly_predicted_keys: poorlyPredictedKeys,
    rationale_excerpt: prediction.rationale.slice(0, 400),
  });
}

const DEFAULT_REFLEXION_DRIFT_FLOOR = 0.5;

/**
 * WIN-2 — surprise → reflexion adapter.
 *
 * Map a DIVERGENT reconciliation's learning_signal into the recorder's critique
 * string + importance, then write it through `recordReflexion`. This makes the
 * reconciliation worker a SECOND writer into `reflexion_buffer` — keyed on
 * model-vs-reality surprise rather than conversation. The correction hint mirrors
 * the forecasting-engine `lessonFromDelta` synthesis (widen-band on a scalar
 * miss, re-tune-central-estimate on a directional one) so the lesson the nightly
 * sleep pass consolidates carries an actionable bias direction, not just "I was
 * wrong". Importance = drift so the prune pass keeps the biggest surprises.
 *
 * Best-effort + fail-soft: the reconciliation row + audit chain + conformal feed
 * are already durably committed before this runs; a recorder fault is swallowed.
 */
async function recordSurpriseAsReflexion(
  recorder: ReflexionRecorderPort,
  p: PendingPrediction,
  predictedValueTzs: number | null,
  observedValueTzs: number | null,
  drift: number,
  poorlyPredictedKeys: readonly string[],
  logger: Logger,
): Promise<void> {
  try {
    const critique = synthesiseSurpriseLesson(
      p,
      predictedValueTzs,
      observedValueTzs,
      drift,
      poorlyPredictedKeys,
    );
    await kernelReflexion.recordReflexion(recorder, {
      tenantId: p.tenantId,
      taskId: `reconcile:${p.id}`,
      success: false,
      critique,
      importance: Math.max(0, Math.min(1, drift)),
    });
  } catch (err) {
    logger.warn(
      {
        worker: 'outcome-reconciliation',
        predictionId: p.id,
        err: err instanceof Error ? err.message : String(err),
      },
      'outcome-reconciliation: surprise→reflexion write failed (reconciliation already committed)',
    );
  }
}

/**
 * Synthesise the durable lesson text from the divergence. Pure. Carries the
 * action-kind, the entity-type, the predicted-vs-observed scalar (when present),
 * the keys that missed, and the correction direction (bias high/low / widen
 * band) so the next forecast prompt reads an actionable hint.
 */
function synthesiseSurpriseLesson(
  p: PendingPrediction,
  predictedValueTzs: number | null,
  observedValueTzs: number | null,
  drift: number,
  poorlyPredictedKeys: readonly string[],
): string {
  const driftPct = (drift * 100).toFixed(0);
  let xy = '';
  let correction: string;
  if (predictedValueTzs !== null && observedValueTzs !== null && predictedValueTzs !== 0) {
    const direction = observedValueTzs > predictedValueTzs ? 'underestimated' : 'overestimated';
    xy = `predicted ${predictedValueTzs.toFixed(0)} vs observed ${observedValueTzs.toFixed(0)}`;
    // Mirrors lessonFromDelta: a directional miss re-tunes the central estimate;
    // a large miss widens the band. Drift over the matched band = "outside band".
    correction =
      drift > DIVERGENT_DRIFT_BAND
        ? `widen the confidence band for ${p.actionKind} on ${p.actionTargetEntityType} — residual variance exceeds the model; and re-tune the central estimate (bias ${direction === 'underestimated' ? 'low' : 'high'})`
        : `re-tune the ${p.actionKind} central estimate — bias ${direction === 'underestimated' ? 'low' : 'high'}`;
  } else {
    const missed = poorlyPredictedKeys.slice(0, 6).join(', ') || 'multiple fields';
    xy = `envelope keys diverged: ${missed}`;
    correction = `widen the confidence band for ${p.actionKind} on ${p.actionTargetEntityType} — these fields are less predictable than the model assumes`;
  }
  return (
    `${p.actionKind} on ${p.actionTargetEntityType}: surprise (drift ${driftPct}%). ` +
    `${xy}. Correction: ${correction}.`
  );
}

async function appendReconciliationAudit(
  db: DbLike,
  payload: {
    readonly tenantId: string;
    readonly predictionId: string;
    readonly status: string;
    readonly driftScore: number;
    readonly learningSignal: Readonly<Record<string, unknown>>;
  },
  logger: Logger,
): Promise<string | null> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    predictionId: payload.predictionId,
    status: payload.status,
    drift: payload.driftScore,
    learning: payload.learningSignal,
  });
  try {
    // G8 — wrap the GUC bind + SELECT-head + INSERT in BEGIN/COMMIT so
    // the tenant GUC binding is transaction-local. Without the txn
    // wrap, the previous `set_config(..., false)` left the GUC on the
    // pooled connection; if Supabase reaped the connection between
    // the set_config and the INSERT, the INSERT ran with NULL GUC and
    // RLS rejected. The helper sets BOTH `app.current_tenant_id` and
    // legacy `app.tenant_id` via SET LOCAL so policies on either
    // migration generation accept the call.
    await withWorkerTenantContext(db, payload.tenantId, async (tx) => {
      const headRes = await tx.execute(sql`
        SELECT COALESCE(MAX(sequence_id), 0)::bigint AS max_seq,
               (SELECT this_hash FROM ai_audit_chain
                 WHERE tenant_id = ${payload.tenantId}
                 ORDER BY sequence_id DESC LIMIT 1) AS last_hash
          FROM ai_audit_chain
         WHERE tenant_id = ${payload.tenantId}
      `);
      const rows = asRows(headRes);
      const head = rows[0] ?? {};
      const maxSeq = Number((head as Record<string, unknown>).max_seq ?? 0);
      const lastHashRaw = (head as Record<string, unknown>).last_hash;
      const lastHash =
        typeof lastHashRaw === 'string' && lastHashRaw.length > 0
          ? lastHashRaw
          : '';
      const sequenceId = maxSeq + 1;
      const thisHash = createHash('sha256')
        .update(lastHash + canonical)
        .digest('hex');
      await tx.execute(sql`
        INSERT INTO ai_audit_chain (
          id, tenant_id, sequence_id, turn_id, action,
          prev_hash, this_hash, payload, created_at
        ) VALUES (
          ${id},
          ${payload.tenantId},
          ${sequenceId},
          ${`reconcile:${payload.predictionId}`},
          ${'closed_loop.reconcile'},
          ${lastHash},
          ${thisHash},
          ${JSON.stringify({
            predictionId: payload.predictionId,
            status: payload.status,
            driftScore: payload.driftScore,
            learningSignal: payload.learningSignal,
          })}::jsonb,
          ${new Date().toISOString()}
        )
      `);
    });
    return id;
  } catch (err) {
    logger.warn(
      { worker: 'outcome-reconciliation', err: err instanceof Error ? err.message : String(err) },
      'outcome-reconciliation: audit append failed',
    );
    return null;
  }
}

export function createOutcomeReconciliationWorker(
  options: ReconciliationWorkerOptions,
): ReconciliationWorkerHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => new Date());
  const enabled = options.enabled !== false;
  let timer: ReturnType<typeof setInterval> | null = null;

  // The claim() scan is CROSS-TENANT (NOT EXISTS across all tenants, no tenant
  // filter) over the shared service pool. `outcome_predictions` /
  // `outcome_reconciliations` carry FORCE RLS, so every statement must bind
  // `app.is_service_role='true'` or the scan matches ZERO rows and the loop goes
  // dark. Wrap when the db is transactional; the unit-test mock injects a fake
  // db with `.execute` but no `.transaction`, so fall through to a direct
  // execute to keep those tests green.
  function runStmt(q: unknown): Promise<unknown> {
    const dbAny = options.db as { transaction?: unknown };
    if (typeof dbAny.transaction === 'function') {
      return withServiceRoleContext(
        options.db as unknown as ServiceRoleDb,
        (tx) => (tx as unknown as DbLike).execute(q),
      );
    }
    return options.db.execute(q);
  }

  async function claim(): Promise<readonly PendingPrediction[]> {
    const ts = now().toISOString();
    try {
      const res = await runStmt(sql`
        SELECT id, tenant_id, actor_kind, action_kind,
               action_target_entity_type, action_target_entity_id,
               predicted_outcome, predicted_value_tzs,
               prediction_confidence, rationale
          FROM outcome_predictions p
         WHERE p.prediction_confidence > 0
           AND (p.created_at + (p.prediction_horizon_days || ' days')::interval) <= ${ts}
           AND NOT EXISTS (
             SELECT 1 FROM outcome_reconciliations r
              WHERE r.prediction_id = p.id
                AND r.tenant_id     = p.tenant_id
           )
         ORDER BY p.created_at ASC
         LIMIT ${DEFAULT_BATCH}
      `);
      const out: PendingPrediction[] = [];
      for (const row of asRows(res)) {
        const p = rowToPrediction(row);
        if (p) out.push(p);
      }
      return out;
    } catch (err) {
      options.logger.warn(
        {
          worker: 'outcome-reconciliation',
          err: err instanceof Error ? err.message : String(err),
        },
        'outcome-reconciliation: claim failed',
      );
      return [];
    }
  }

  async function insertObservation(
    p: PendingPrediction,
    res: ObservationResolverResult,
  ): Promise<string | null> {
    const observationId = randomUUID();
    const gapPct =
      p.predictedValueTzs !== null && res.observedValueTzs !== null
        ? scalarDrift(p.predictedValueTzs, res.observedValueTzs)
        : null;
    try {
      // Bind the per-tenant RLS context: under FORCE RLS (BORJIE_ENFORCE_RLS)
      // a bare cross-tenant write satisfies neither the tenant-isolation nor
      // the service-role bypass policy and is silently filtered — the same
      // darkness the rest of this worker already wraps against (see :425/:760).
      await withWorkerTenantContext(options.db, p.tenantId, (tx) =>
        tx.execute(sql`
        INSERT INTO outcome_observations (
          id, tenant_id, prediction_id, observed_outcome,
          observed_value_tzs, observed_at, gap_pct, calibrated, narrative
        ) VALUES (
          ${observationId},
          ${p.tenantId},
          ${p.id},
          ${JSON.stringify(res.observedOutcome)}::jsonb,
          ${res.observedValueTzs},
          ${now().toISOString()},
          ${gapPct},
          ${true},
          ${res.narrative.slice(0, 4000)}
        )
        ON CONFLICT (tenant_id, prediction_id) DO NOTHING
      `),
      );
      return observationId;
    } catch (err) {
      options.logger.warn(
        {
          worker: 'outcome-reconciliation',
          predictionId: p.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'outcome-reconciliation: observation insert failed',
      );
      return null;
    }
  }

  async function insertReconciliation(payload: {
    readonly tenantId: string;
    readonly predictionId: string;
    readonly observationId: string | null;
    readonly status: 'matched' | 'divergent' | 'undetermined' | 'expired';
    readonly driftScore: number;
    readonly learningSignal: Readonly<Record<string, unknown>>;
    readonly auditHashId: string | null;
  }): Promise<boolean> {
    try {
      // Per-tenant RLS context (see insertObservation) — bare cross-tenant
      // writes go dark under FORCE RLS.
      await withWorkerTenantContext(options.db, payload.tenantId, (tx) =>
        tx.execute(sql`
        INSERT INTO outcome_reconciliations (
          id, tenant_id, prediction_id, observation_id, status,
          drift_score, learning_signal, audit_hash_id, reconciled_at
        ) VALUES (
          ${randomUUID()},
          ${payload.tenantId},
          ${payload.predictionId},
          ${payload.observationId},
          ${payload.status},
          ${payload.driftScore.toFixed(4)},
          ${JSON.stringify(payload.learningSignal)}::jsonb,
          ${payload.auditHashId},
          ${now().toISOString()}
        )
        ON CONFLICT (tenant_id, prediction_id) DO NOTHING
      `),
      );
      return true;
    } catch (err) {
      options.logger.warn(
        {
          worker: 'outcome-reconciliation',
          predictionId: payload.predictionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'outcome-reconciliation: reconciliation insert failed',
      );
      return false;
    }
  }

  async function reconcileOne(
    p: PendingPrediction,
  ): Promise<'matched' | 'divergent' | 'undetermined' | 'expired' | 'errored'> {
    const resolver = options.resolvers[p.actionTargetEntityType];
    if (!resolver) {
      // No resolver wired - close out as expired so we don't loop on
      // the row forever. Auditable: the reconciliation row records the
      // status with a learning_signal that names the missing resolver.
      const learning = Object.freeze({
        action_kind: p.actionKind,
        actor_kind: p.actorKind,
        entity_type: p.actionTargetEntityType,
        status: 'expired',
        reason: 'no_observation_resolver',
      });
      const auditHashId = await appendReconciliationAudit(
        options.db,
        {
          tenantId: p.tenantId,
          predictionId: p.id,
          status: 'expired',
          driftScore: 0,
          learningSignal: learning,
        },
        options.logger,
      );
      await insertReconciliation({
        tenantId: p.tenantId,
        predictionId: p.id,
        observationId: null,
        status: 'expired',
        driftScore: 0,
        learningSignal: learning,
        auditHashId,
      });
      return 'expired';
    }

    let observation: ObservationResolverResult | null = null;
    try {
      observation = await resolver({
        tenantId: p.tenantId,
        entityType: p.actionTargetEntityType,
        entityId: p.actionTargetEntityId,
        predictedOutcome: p.predictedOutcome,
      });
    } catch (err) {
      options.logger.warn(
        {
          worker: 'outcome-reconciliation',
          predictionId: p.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'outcome-reconciliation: resolver threw',
      );
      observation = null;
    }

    if (!observation) {
      const learning = Object.freeze({
        action_kind: p.actionKind,
        actor_kind: p.actorKind,
        entity_type: p.actionTargetEntityType,
        status: 'expired',
        reason: 'observation_unavailable',
      });
      const auditHashId = await appendReconciliationAudit(
        options.db,
        {
          tenantId: p.tenantId,
          predictionId: p.id,
          status: 'expired',
          driftScore: 0,
          learningSignal: learning,
        },
        options.logger,
      );
      await insertReconciliation({
        tenantId: p.tenantId,
        predictionId: p.id,
        observationId: null,
        status: 'expired',
        driftScore: 0,
        learningSignal: learning,
        auditHashId,
      });
      return 'expired';
    }

    const observationId = await insertObservation(p, observation);

    // Compute drift. Scalar predictions take precedence when a monetary
    // forecast was made; otherwise we fall back to the vector envelope.
    const drift =
      p.predictedValueTzs !== null && observation.observedValueTzs !== null
        ? scalarDrift(p.predictedValueTzs, observation.observedValueTzs)
        : vectorDrift(p.predictedOutcome, observation.observedOutcome);
    const status = classify(drift);
    const learning = buildLearningSignal(
      p,
      observation.observedOutcome,
      drift,
      status,
    );
    const auditHashId = await appendReconciliationAudit(
      options.db,
      {
        tenantId: p.tenantId,
        predictionId: p.id,
        status,
        driftScore: drift,
        learningSignal: learning,
      },
      options.logger,
    );
    const inserted = await insertReconciliation({
      tenantId: p.tenantId,
      predictionId: p.id,
      observationId,
      status,
      driftScore: drift,
      learningSignal: learning,
      auditHashId,
    });
    if (!inserted) return 'errored';

    // Online-ACI coverage feed: a finalized matched/divergent reconciliation is
    // a REAL coverage observation (matched = the observed value fell inside the
    // prediction's tolerance → covered; divergent → not). Fold it through the
    // conformal loop so the calibrated alpha LEARNS from this outcome — the same
    // alpha the live chat path consumes to shift its confidence tiers. Run it in
    // a tenant-pinned tx so RLS FORCE sees the GUC on the conformal_* writes
    // (the store uses the Drizzle query builder, unlike this worker's raw SQL).
    // Fully fail-soft: a calibration write must never fail the reconciliation it
    // follows (the row is already durably committed above).
    if (status === 'matched' || status === 'divergent') {
      try {
        await withWorkerTenantContext(options.db, p.tenantId, (tx) =>
          feedReconciliationToConformal(
            tx,
            {
              tenantId: p.tenantId,
              predictionId: p.id,
              actionKind: p.actionKind,
              status,
              predictedValueTzs: p.predictedValueTzs,
              observedValueTzs: observation.observedValueTzs,
              driftScore: drift,
              reconciledAtIso: now().toISOString(),
            },
            options.logger,
          ),
        );
      } catch (err) {
        options.logger.warn(
          {
            worker: 'outcome-reconciliation',
            predictionId: p.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'outcome-reconciliation: conformal feed failed (reconciliation already committed)',
        );
      }
    }

    // WIN-2 — self-correcting memory: a BIG surprise (divergent + drift over the
    // lesson floor) becomes a durable reflexion the next inference reads back.
    // The lesson was previously synthesised then DISCARDED; this closes the loop.
    // The recorder port owns its own RLS-safe write path (the row carries an
    // explicit tenantId; workers connect service_role), so no tenant-context wrap
    // is needed here — it would pin a connection the recorder doesn't use. The
    // recorder is best-effort and the reconciliation is already committed, so a
    // write fault is harmless.
    const driftFloor = options.reflexionDriftFloor ?? DEFAULT_REFLEXION_DRIFT_FLOOR;
    if (
      status === 'divergent' &&
      drift > driftFloor &&
      options.reflexionRecorder
    ) {
      const poorlyPredictedKeys = Array.isArray(
        (learning as { poorly_predicted_keys?: unknown }).poorly_predicted_keys,
      )
        ? (learning as { poorly_predicted_keys: unknown[] }).poorly_predicted_keys.filter(
            (k): k is string => typeof k === 'string',
          )
        : [];
      await recordSurpriseAsReflexion(
        options.reflexionRecorder,
        p,
        p.predictedValueTzs,
        observation.observedValueTzs,
        drift,
        poorlyPredictedKeys,
        options.logger,
      );
    }

    return status;
  }

  async function tickOnce(): Promise<ReconciliationTickResult> {
    try {
      const claimed = await claim();
      let matched = 0;
      let divergent = 0;
      let undetermined = 0;
      let expired = 0;
      let errored = 0;
      for (const p of claimed) {
        try {
          const verdict = await reconcileOne(p);
          if (verdict === 'matched') matched += 1;
          else if (verdict === 'divergent') divergent += 1;
          else if (verdict === 'undetermined') undetermined += 1;
          else if (verdict === 'expired') expired += 1;
          else errored += 1;
        } catch (err) {
          errored += 1;
          options.logger.warn(
            {
              worker: 'outcome-reconciliation',
              predictionId: p.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'outcome-reconciliation: reconcile threw',
          );
        }
      }
      if (claimed.length > 0) {
        options.logger.info(
          {
            worker: 'outcome-reconciliation',
            claimed: claimed.length,
            matched,
            divergent,
            undetermined,
            expired,
            errored,
          },
          'outcome-reconciliation: tick done',
        );
      }
      // G6 — robustness 2026-05-29. Heartbeat AFTER the tick body so
      // /health/deep can distinguish "ticking but failing" from "stuck".
      workerHeartbeat('outcome-reconciliation');
      return {
        claimed: claimed.length,
        matched,
        divergent,
        undetermined,
        expired,
        errored,
      };
    } catch (err) {
      workerHeartbeatFailure('outcome-reconciliation', err);
      throw err;
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info(
        { worker: 'outcome-reconciliation' },
        'outcome-reconciliation: disabled by config',
      );
      return;
    }
    if (timer) return;
    // G6 — register before the first tick so /health/deep can flag
    // "registered but not yet ticked > 2 × interval" as stuck.
    registerWorker({ name: 'outcome-reconciliation', intervalMs });
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.error(
          {
            worker: 'outcome-reconciliation',
            err: err instanceof Error ? err.message : String(err),
          },
          'outcome-reconciliation: tick threw',
        );
      });
    }, intervalMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    options.logger.info(
      { worker: 'outcome-reconciliation', intervalMs },
      'outcome-reconciliation: started',
    );
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}
