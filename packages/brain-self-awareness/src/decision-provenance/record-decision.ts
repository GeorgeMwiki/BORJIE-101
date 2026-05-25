// recordDecision / getProvenance — thin pure helpers over the append-only store.

import type {
  DecisionEvent,
  DecisionProvenanceDeps
} from './types.js'

/**
 * Validates a decision event before appending. Throws with a clear message
 * when a required field is missing or empty — this is the only place we
 * gatekeep what enters the audit log.
 */
export function validateDecisionEvent(event: DecisionEvent): void {
  const requiredStrFields: Array<keyof DecisionEvent> = [
    'decisionId',
    'actionKind',
    'actorRole',
    'autonomyScope',
    'modelId',
    'promptHash',
    'outcome',
    'createdAt'
  ]
  for (const k of requiredStrFields) {
    const v = event[k]
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`DecisionEvent.${String(k)} is required`)
    }
  }
  if (!Array.isArray(event.evidence)) {
    throw new Error('DecisionEvent.evidence must be an array')
  }
  if (!Array.isArray(event.alternativesConsidered)) {
    throw new Error('DecisionEvent.alternativesConsidered must be an array')
  }
}

/**
 * Appends a decision event to the store. Pure delegation — validation happens
 * here so every caller benefits without having to remember.
 */
export async function recordDecision(
  deps: DecisionProvenanceDeps,
  event: DecisionEvent
): Promise<DecisionEvent> {
  validateDecisionEvent(event)
  return deps.store.append(event)
}

/**
 * Fetches the full provenance chain for a decision ID. Returns events
 * sorted oldest-first (the order the store returns them in — port contract).
 *
 * Throws if no event with the given ID exists; otherwise returns a non-empty
 * readonly array.
 */
export async function getProvenance(
  deps: DecisionProvenanceDeps,
  decisionId: string
): Promise<readonly DecisionEvent[]> {
  const head = await deps.store.getById(decisionId)
  if (head === null) {
    throw new Error(`Decision not found: ${decisionId}`)
  }
  return deps.store.getChain(decisionId)
}
