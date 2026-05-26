/**
 * Observation recorder (Wave 18BB-gap).
 *
 * Builds and writes a `CalibrationObservation` at decision time.
 * Pure orchestration: the host wires in the repository + audit
 * chain. Validation rejects out-of-range confidences and empty
 * fields. The `(tenant_id, prediction_kind, entity_id)` triple is
 * unique — a duplicate observe surfaces a `DUPLICATE_OBSERVATION`
 * error.
 */

import {
  CalibrationMonitorError,
  observationInsertSchema,
  type AuditChainPort,
  type CalibrationObservation,
  type CalibrationWriteContext,
  type ObservationInsert,
  type ObservationRepository,
} from '../types.js';

export interface ObservationRecorderDeps {
  readonly repo: ObservationRepository;
  readonly audit: AuditChainPort;
}

export type ObservationRecorderFn = (
  ctx: CalibrationWriteContext,
  input: ObservationInsert,
) => Promise<CalibrationObservation>;

export function createObservationRecorder(
  deps: ObservationRecorderDeps,
): ObservationRecorderFn {
  return async (ctx, rawInput) => {
    if (!ctx.tenant_id) {
      throw new CalibrationMonitorError(
        'tenant_id required',
        'MISSING_TENANT',
      );
    }

    const parsed = observationInsertSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new CalibrationMonitorError(
        `invalid observation input: ${parsed.error.message}`,
        'INVALID_INPUT',
      );
    }
    const input: ObservationInsert = parsed.data;

    const now = ctx.now();
    const id = generateId('obs');

    const auditHash = await deps.audit.append({
      tenant_id: ctx.tenant_id,
      event_kind: 'calibration.observe',
      entity_id: input.entity_id,
      recorded_at: now.toISOString(),
      payload_digest: digest(
        `${input.prediction_kind}|${input.entity_id}|${input.predicted_confidence}|${input.predicted_label}`,
      ),
    });

    const row: CalibrationObservation = {
      id,
      tenant_id: ctx.tenant_id,
      prediction_kind: input.prediction_kind,
      entity_id: input.entity_id,
      predicted_confidence: input.predicted_confidence,
      predicted_label: input.predicted_label,
      outcome_label: null,
      outcome_value: null,
      resolved_at: null,
      created_at: now.toISOString(),
      audit_hash: auditHash,
    };

    await deps.repo.insert(row);
    return row;
  };
}

function generateId(prefix: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  const t = Date.now().toString(16);
  return `${prefix}-${t}-${rnd}`;
}

function digest(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `d-${(h >>> 0).toString(16).padStart(8, '0')}`;
}
