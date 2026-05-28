/**
 * Outcome predictor - Wave CLOSED-LOOP.
 *
 * Every WRITE brain tool runs through this wrapper at registration
 * time. The wrapper:
 *
 *   1. Before invoking the underlying tool, asks the brain (via the
 *      injected `predictor` port) to estimate predicted_outcome +
 *      confidence + horizon_days + rationale. If the predictor is
 *      unavailable or returns no usable forecast, the wrapper falls
 *      back to the explicit "unmodeled" envelope - never fabricates.
 *
 *   2. Inserts the outcome_predictions row.
 *
 *   3. Extends the AI hash-chain with the prediction so a mutation of
 *      either the prediction row or the audit chain breaks verify().
 *
 *   4. Calls the original tool handler. Whatever the handler returns
 *      flows through unchanged - the wrapper is observation-only on
 *      the success path.
 *
 *   5. The reconciliation worker (services/api-gateway/src/workers/
 *      outcome-reconciliation-worker.ts) walks the predictions table
 *      every 6h and closes the loop.
 *
 * The wrapper is composed at boot in services/api-gateway/src/index.ts
 * via `wrapWritesWithOutcomePrediction()` - we apply it AFTER
 * `buildPersonaToolHandlers()` so the descriptors themselves stay
 * untouched (sibling-owned). The original `ToolHandler.name` /
 * `parameters` / `description` are preserved verbatim.
 *
 * Tenant isolation: every prediction insert sets `tenant_id` from the
 * tool execution context. The wrapper never reads across tenants.
 */

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type {
  ToolHandler,
  ToolExecutionContext,
  ToolExecutionResult,
} from '@borjie/ai-copilot';

const DEFAULT_HORIZON_DAYS = 30;
const MAX_CONFIDENCE = 1.0;
const MIN_CONFIDENCE = 0.0;
const UNMODELED: Readonly<Record<string, unknown>> = Object.freeze({
  unmodeled: true,
});

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface PredictorInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly personaSlug: string;
  readonly toolId: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface PredictorOutput {
  readonly predictedOutcome: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly horizonDays: number;
  readonly predictedValueTzs?: number | null;
  readonly rationale: string;
  /**
   * The wrapper records this as the action_target_entity_type +
   * action_target_entity_id on the outcome_predictions row. The
   * predictor port should derive these from `params` whenever the tool
   * schema makes them resolvable. When the predictor cannot identify
   * the target, the wrapper falls back to ('unknown', toolId).
   */
  readonly targetEntityType?: string;
  readonly targetEntityId?: string;
}

/**
 * Predictor port. The composition root binds a real implementation
 * backed by whichever provider is alive (Claude/GPT/Gemini); tests
 * pass a deterministic stub. Returning `null` (or throwing) lands the
 * prediction as the explicit "unmodeled" envelope - never fabricated.
 */
export type Predictor = (
  input: PredictorInput,
) => Promise<PredictorOutput | null>;

export interface OutcomePredictorOptions {
  readonly db: DbLike | null;
  readonly logger: Logger;
  readonly predictor: Predictor;
  /** When true, predictions are skipped entirely (degraded mode). */
  readonly disabled?: boolean;
  readonly now?: () => Date;
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, value));
}

function clampHorizon(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_HORIZON_DAYS;
  }
  const rounded = Math.round(value);
  return Math.max(0, Math.min(365, rounded));
}

async function appendPredictionAudit(
  db: DbLike,
  payload: {
    readonly tenantId: string;
    readonly predictionId: string;
    readonly toolId: string;
    readonly actorId: string;
    readonly predictedOutcome: Readonly<Record<string, unknown>>;
    readonly confidence: number;
    readonly horizonDays: number;
  },
  logger: Logger,
): Promise<string | null> {
  const id = randomUUID();
  const canonical = JSON.stringify({
    tenantId: payload.tenantId,
    predictionId: payload.predictionId,
    toolId: payload.toolId,
    actorId: payload.actorId,
    predicted: payload.predictedOutcome,
    confidence: payload.confidence,
    horizonDays: payload.horizonDays,
  });
  try {
    const headRes = await db.execute(sql`
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
    await db.execute(sql`
      INSERT INTO ai_audit_chain (
        id, tenant_id, sequence_id, turn_id, action,
        prev_hash, this_hash, payload, created_at
      ) VALUES (
        ${id},
        ${payload.tenantId},
        ${sequenceId},
        ${`predict:${payload.predictionId}`},
        ${'closed_loop.predict'},
        ${lastHash},
        ${thisHash},
        ${JSON.stringify({
          predictionId: payload.predictionId,
          toolId: payload.toolId,
          actorId: payload.actorId,
          confidence: payload.confidence,
          horizonDays: payload.horizonDays,
          predictedOutcome: payload.predictedOutcome,
        })}::jsonb,
        ${new Date().toISOString()}
      )
    `);
    return id;
  } catch (err) {
    logger.warn(
      {
        worker: 'outcome-predictor',
        err: err instanceof Error ? err.message : String(err),
      },
      'outcome-predictor: audit append failed',
    );
    return null;
  }
}

async function insertPrediction(
  db: DbLike,
  payload: {
    readonly tenantId: string;
    readonly actorKind: string;
    readonly actorId: string;
    readonly toolId: string;
    readonly targetEntityType: string;
    readonly targetEntityId: string;
    readonly predictedOutcome: Readonly<Record<string, unknown>>;
    readonly confidence: number;
    readonly horizonDays: number;
    readonly predictedValueTzs: number | null;
    readonly rationale: string;
    readonly auditHashId: string | null;
    readonly now: Date;
  },
  logger: Logger,
): Promise<string | null> {
  const id = randomUUID();
  try {
    await db.execute(sql`
      INSERT INTO outcome_predictions (
        id, tenant_id, actor_kind, actor_id, action_kind,
        action_target_entity_type, action_target_entity_id,
        predicted_outcome, prediction_confidence, prediction_horizon_days,
        predicted_value_tzs, rationale, audit_hash_id, created_at
      ) VALUES (
        ${id},
        ${payload.tenantId},
        ${payload.actorKind},
        ${payload.actorId},
        ${payload.toolId},
        ${payload.targetEntityType},
        ${payload.targetEntityId},
        ${JSON.stringify(payload.predictedOutcome)}::jsonb,
        ${payload.confidence.toFixed(3)},
        ${payload.horizonDays},
        ${payload.predictedValueTzs},
        ${payload.rationale.slice(0, 4000)},
        ${payload.auditHashId},
        ${payload.now.toISOString()}
      )
    `);
    return id;
  } catch (err) {
    logger.warn(
      {
        worker: 'outcome-predictor',
        toolId: payload.toolId,
        err: err instanceof Error ? err.message : String(err),
      },
      'outcome-predictor: prediction insert failed',
    );
    return null;
  }
}

/**
 * Wrap a single ToolHandler so that the next time it is invoked, a
 * predicted outcome is recorded BEFORE the underlying handler runs.
 * The handler's name / description / parameters / return shape are
 * preserved verbatim. Pure factory - no closure-level state beyond
 * the injected options.
 */
export function withOutcomePrediction(
  handler: ToolHandler,
  options: OutcomePredictorOptions,
): ToolHandler {
  const now = options.now ?? (() => new Date());
  return {
    name: handler.name,
    description: handler.description,
    parameters: handler.parameters,
    async execute(
      params: Record<string, unknown>,
      context: ToolExecutionContext,
    ): Promise<ToolExecutionResult> {
      // Degraded mode (no DB) or explicit disable: skip prediction and
      // pass through to the underlying handler so the brain stays
      // functional.
      if (!options.db || options.disabled) {
        return handler.execute(params, context);
      }

      // Try to capture a prediction. NEVER fabricate - if the
      // predictor returns null / throws, we record the explicit
      // "unmodeled" envelope with confidence 0 so the row is auditable
      // but the reconciler skips it.
      let raw: PredictorOutput | null = null;
      try {
        const personaProbe = context as unknown as { personaSlug?: unknown };
        const personaSlug =
          typeof personaProbe.personaSlug === 'string' &&
          personaProbe.personaSlug.length > 0
            ? personaProbe.personaSlug
            : 'unknown';
        raw = await options.predictor({
          tenantId: context.tenant.tenantId,
          actorId: context.actor.id,
          personaSlug,
          toolId: handler.name,
          params,
        });
      } catch (err) {
        options.logger.warn(
          {
            worker: 'outcome-predictor',
            toolId: handler.name,
            err: err instanceof Error ? err.message : String(err),
          },
          'outcome-predictor: predictor threw - recording as unmodeled',
        );
        raw = null;
      }

      const predicted = raw ?? {
        predictedOutcome: UNMODELED,
        confidence: 0,
        horizonDays: DEFAULT_HORIZON_DAYS,
        predictedValueTzs: null,
        rationale: '',
      };

      const confidence = clampConfidence(predicted.confidence);
      const horizonDays = clampHorizon(predicted.horizonDays);
      const targetEntityType =
        typeof predicted.targetEntityType === 'string' &&
        predicted.targetEntityType.length > 0
          ? predicted.targetEntityType
          : 'unknown';
      const targetEntityId =
        typeof predicted.targetEntityId === 'string' &&
        predicted.targetEntityId.length > 0
          ? predicted.targetEntityId
          : handler.name;
      const predictedValueTzs =
        typeof predicted.predictedValueTzs === 'number' &&
        Number.isFinite(predicted.predictedValueTzs)
          ? predicted.predictedValueTzs
          : null;

      // Reserve the prediction id BEFORE the audit so the audit row
      // (payload) and the prediction row both quote the same id.
      const predictionId = randomUUID();
      const auditHashId = await appendPredictionAudit(
        options.db,
        {
          tenantId: context.tenant.tenantId,
          predictionId,
          toolId: handler.name,
          actorId: context.actor.id,
          predictedOutcome: predicted.predictedOutcome,
          confidence,
          horizonDays,
        },
        options.logger,
      );
      // Insert with the pre-reserved id so audit linkage holds.
      const stamp = now();
      try {
        if (options.db) {
          await options.db.execute(sql`
            INSERT INTO outcome_predictions (
              id, tenant_id, actor_kind, actor_id, action_kind,
              action_target_entity_type, action_target_entity_id,
              predicted_outcome, prediction_confidence, prediction_horizon_days,
              predicted_value_tzs, rationale, audit_hash_id, created_at
            ) VALUES (
              ${predictionId},
              ${context.tenant.tenantId},
              ${'brain'},
              ${context.actor.id},
              ${handler.name},
              ${targetEntityType},
              ${targetEntityId},
              ${JSON.stringify(predicted.predictedOutcome)}::jsonb,
              ${confidence.toFixed(3)},
              ${horizonDays},
              ${predictedValueTzs},
              ${(predicted.rationale ?? '').slice(0, 4000)},
              ${auditHashId},
              ${stamp.toISOString()}
            )
          `);
        }
      } catch (err) {
        // Fall back to the helper's auto-id insert if the reserved-id
        // path collides (vanishingly unlikely - randomUUID).
        options.logger.warn(
          {
            worker: 'outcome-predictor',
            toolId: handler.name,
            err: err instanceof Error ? err.message : String(err),
          },
          'outcome-predictor: reserved-id insert failed, retrying with helper',
        );
        await insertPrediction(
          options.db,
          {
            tenantId: context.tenant.tenantId,
            actorKind: 'brain',
            actorId: context.actor.id,
            toolId: handler.name,
            targetEntityType,
            targetEntityId,
            predictedOutcome: predicted.predictedOutcome,
            confidence,
            horizonDays,
            predictedValueTzs,
            rationale: predicted.rationale ?? '',
            auditHashId,
            now: stamp,
          },
          options.logger,
        );
      }

      // Invoke the underlying handler unchanged. The wrapper is
      // observation-only on the success path.
      return handler.execute(params, context);
    },
  };
}

/**
 * Identifier set for tool ids the wrapper should treat as WRITE. The
 * composition root pre-computes this from the persona descriptor
 * catalog (filtering by `isWrite: true`) and passes it in. We don't
 * import the descriptor type here so this module stays free of any
 * coupling to sibling-owned descriptor files.
 */
export type WriteToolIdSet = ReadonlySet<string>;

/**
 * Apply `withOutcomePrediction` to every handler whose `name` appears
 * in the WRITE set. Returns a new frozen array - never mutates the
 * input. Handlers outside the WRITE set pass through unchanged.
 */
export function wrapWritesWithOutcomePrediction(
  handlers: readonly ToolHandler[],
  writeToolIds: WriteToolIdSet,
  options: OutcomePredictorOptions,
): readonly ToolHandler[] {
  return Object.freeze(
    handlers.map((h) =>
      writeToolIds.has(h.name) ? withOutcomePrediction(h, options) : h,
    ),
  );
}

/**
 * Default predictor binding: returns the explicit unmodeled envelope.
 * Used when no LLM-backed predictor has been wired yet (degraded
 * mode). The wrapper STILL writes the row so the reconciliation
 * worker has the action recorded - it just skips the drift score
 * because confidence is 0.
 */
export const unmodeledPredictor: Predictor = async () => null;
