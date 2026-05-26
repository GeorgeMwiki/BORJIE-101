/**
 * Outcome resolver (Wave 18BB-gap).
 *
 * Ties an existing `CalibrationObservation` to its eventual
 * resolution (owner approve / reject, real-world outcome, manual
 * backfill). The resolver is **idempotent**: repeating the same
 * resolution is a no-op; resolving with a conflicting outcome
 * raises `RESOLUTION_CONFLICT`.
 *
 * The resolver MUST receive its outcome label from an external
 * source — never from the model itself (anti-pattern §6.1
 * "Self-resolution").
 */

import {
  CalibrationMonitorError,
  outcomeResolutionSchema,
  type AuditChainPort,
  type CalibrationObservation,
  type CalibrationWriteContext,
  type ObservationRepository,
  type OutcomeResolutionInput,
} from '../types.js';

export interface OutcomeResolverDeps {
  readonly repo: ObservationRepository;
  readonly audit: AuditChainPort;
}

export type OutcomeResolverFn = (
  ctx: CalibrationWriteContext,
  input: OutcomeResolutionInput,
) => Promise<CalibrationObservation>;

export function createOutcomeResolver(
  deps: OutcomeResolverDeps,
): OutcomeResolverFn {
  return async (ctx, rawInput) => {
    if (!ctx.tenant_id) {
      throw new CalibrationMonitorError(
        'tenant_id required',
        'MISSING_TENANT',
      );
    }

    const parsed = outcomeResolutionSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new CalibrationMonitorError(
        `invalid resolution input: ${parsed.error.message}`,
        'INVALID_INPUT',
      );
    }
    const input: OutcomeResolutionInput = parsed.data;

    const now = ctx.now();

    const updated = await deps.repo.resolve(
      ctx.tenant_id,
      input.prediction_kind,
      input.entity_id,
      input.outcome_label,
      input.outcome_value,
      now.toISOString(),
    );

    await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'calibration.resolve',
      entity_id: input.entity_id,
      recorded_at: now.toISOString(),
      payload_digest: `${input.prediction_kind}|${input.outcome_label}|${input.outcome_value}`,
    });

    return updated;
  };
}
