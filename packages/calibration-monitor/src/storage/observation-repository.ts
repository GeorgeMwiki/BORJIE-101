/**
 * In-memory reference implementation of `ObservationRepository`
 * (Wave 18BB-gap). Production wires a Postgres-backed adapter using
 * the Drizzle schema in `@borjie/database`; this module exists for
 * tests and ephemeral worker contexts.
 *
 * Idempotency: `(tenant_id, prediction_kind, entity_id)` is the
 * uniqueness key. A second `insert` for the same triple is a
 * `DUPLICATE_OBSERVATION` error. Resolution is permitted exactly
 * once per triple — a re-resolution with a different outcome is a
 * `RESOLUTION_CONFLICT`.
 */

import {
  CalibrationMonitorError,
  type CalibrationObservation,
  type ObservationRepository,
} from '../types.js';

type ObservationKey = `${string}::${string}::${string}`;

const compositeKey = (
  tenant_id: string,
  prediction_kind: string,
  entity_id: string,
): ObservationKey =>
  `${tenant_id}::${prediction_kind}::${entity_id}` as ObservationKey;

export function createInMemoryObservationRepository(): ObservationRepository {
  const byKey = new Map<ObservationKey, CalibrationObservation>();

  return {
    async insert(row) {
      const k = compositeKey(row.tenant_id, row.prediction_kind, row.entity_id);
      if (byKey.has(k)) {
        throw new CalibrationMonitorError(
          `observation already exists for ${k}`,
          'DUPLICATE_OBSERVATION',
        );
      }
      byKey.set(k, row);
    },

    async findByEntity(tenant_id, prediction_kind, entity_id) {
      return (
        byKey.get(compositeKey(tenant_id, prediction_kind, entity_id)) ?? null
      );
    },

    async resolve(
      tenant_id,
      prediction_kind,
      entity_id,
      outcome_label,
      outcome_value,
      resolved_at,
    ) {
      const k = compositeKey(tenant_id, prediction_kind, entity_id);
      const existing = byKey.get(k);
      if (!existing) {
        throw new CalibrationMonitorError(
          `no observation to resolve for ${k}`,
          'OBSERVATION_NOT_FOUND',
        );
      }
      if (existing.resolved_at !== null) {
        if (
          existing.outcome_value !== outcome_value ||
          existing.outcome_label !== outcome_label
        ) {
          throw new CalibrationMonitorError(
            `conflicting resolution for ${k}`,
            'RESOLUTION_CONFLICT',
          );
        }
        return existing;
      }
      const resolved: CalibrationObservation = {
        ...existing,
        outcome_label,
        outcome_value,
        resolved_at,
      };
      byKey.set(k, resolved);
      return resolved;
    },

    async findResolvedInWindow(tenant_id, prediction_kind, from, to) {
      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      const out: Array<CalibrationObservation> = [];
      for (const row of byKey.values()) {
        if (
          row.tenant_id !== tenant_id ||
          row.prediction_kind !== prediction_kind ||
          row.resolved_at === null
        ) {
          continue;
        }
        const resolvedMs = new Date(row.resolved_at).getTime();
        if (resolvedMs >= fromMs && resolvedMs < toMs) {
          out.push(row);
        }
      }
      return out;
    },
  };
}
