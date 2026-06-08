/**
 * Pure observation-fold for the situational model.
 *
 * `mergeObservation` is THE load-bearing write op shared by every store
 * adapter (in-memory, blackboard, Drizzle). It folds a new observation into an
 * existing entity row WITHOUT erasing the ACT-R reference series:
 *   - reference count increments (frequency);
 *   - lastReferencedAt advances to the observation time (recency);
 *   - firstReferencedAt is preserved (the span the base level decays over);
 *   - attributes are shallow-merged (new measurements win, old keys survive);
 *   - associations are shallow-merged the same way.
 *
 * A blind overwrite would reset the recency×frequency history every tick,
 * collapsing activation to a constant — so every adapter MUST route writes
 * through this function. Immutable: returns a NEW frozen entity.
 */

import { z } from 'zod';
import type { RecordEntityInput, SituationEntity } from './types.js';
import { SITUATION_ENTITY_KINDS } from './types.js';

const recordSchema = z.object({
  tenantId: z.string().min(1),
  entityId: z.string().min(1),
  kind: z.enum(SITUATION_ENTITY_KINDS),
  label: z.string().min(1),
  attributes: z.record(z.string(), z.unknown()),
  associations: z.record(z.string(), z.number()).optional(),
  observedAtMs: z.number().finite().nonnegative().optional(),
});

/** Validate a record input; throws a precise error on a malformed write. */
export function parseRecordInput(input: RecordEntityInput): RecordEntityInput {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      `situational-model: invalid record input (${JSON.stringify(parsed.error.issues)})`,
    );
  }
  return input;
}

/**
 * Fold an observation into `prev` (or create a fresh row when prev is null).
 * `nowMs` is the store clock (used when the input omits `observedAtMs`).
 */
export function mergeObservation(
  prev: SituationEntity | null,
  input: RecordEntityInput,
  nowMs: number,
): SituationEntity {
  const observedAtMs =
    typeof input.observedAtMs === 'number' && Number.isFinite(input.observedAtMs)
      ? input.observedAtMs
      : nowMs;

  if (prev === null) {
    return Object.freeze({
      tenantId: input.tenantId,
      entityId: input.entityId,
      kind: input.kind,
      label: input.label,
      attributes: Object.freeze({ ...input.attributes }),
      referenceCount: 1,
      firstReferencedAtMs: observedAtMs,
      lastReferencedAtMs: observedAtMs,
      associations: Object.freeze({ ...(input.associations ?? {}) }),
      updatedAtMs: nowMs,
    });
  }

  // Recency only advances forward; an out-of-order (older) observation still
  // counts as a reference (frequency) but never rewinds the recency clock.
  const lastReferencedAtMs = Math.max(prev.lastReferencedAtMs, observedAtMs);
  const firstReferencedAtMs = Math.min(prev.firstReferencedAtMs, observedAtMs);

  return Object.freeze({
    tenantId: prev.tenantId,
    entityId: prev.entityId,
    kind: prev.kind,
    // The freshest label wins (an entity can be relabelled).
    label: input.label,
    attributes: Object.freeze({ ...prev.attributes, ...input.attributes }),
    referenceCount: prev.referenceCount + 1,
    firstReferencedAtMs,
    lastReferencedAtMs,
    associations: Object.freeze({
      ...prev.associations,
      ...(input.associations ?? {}),
    }),
    updatedAtMs: nowMs,
  });
}
