// Decision Provenance — types
// Schema follows Tian Pan's decision-event model: append-only, full chain.

/**
 * A reference to a piece of evidence (tool output, retrieved doc, prior message).
 */
export interface EvidenceRef {
  readonly kind: 'tool-output' | 'document' | 'message' | 'memory'
  readonly id: string
  readonly summary?: string
}

/**
 * One alternative the brain considered before deciding.
 */
export interface AlternativeConsidered {
  readonly summary: string
  readonly estimatedCostUsd?: number
  readonly rejectedBecause: string
}

/**
 * A decision event — append-only. New facts produce a NEW event with
 * `supersedes` set; we never edit a stored event in place.
 */
export interface DecisionEvent {
  readonly decisionId: string
  readonly actionKind: string
  readonly actorRole: string
  readonly tenantId?: string
  readonly autonomyScope: string
  readonly inputs: Readonly<Record<string, unknown>>
  readonly outputs?: Readonly<Record<string, unknown>>
  readonly evidence: readonly EvidenceRef[]
  readonly alternativesConsidered: readonly AlternativeConsidered[]
  readonly modelId: string
  readonly promptHash: string
  readonly outcome: 'approved' | 'rejected' | 'self-blocked' | 'executed'
  readonly createdAt: string
  /** If non-null, this event supersedes an earlier one. Forms an append-only chain. */
  readonly supersedes?: string
}

/**
 * Decision store port — append-only contract by design.
 * Note there is NO `update` method. To "revise" a decision the caller appends
 * a new event with `supersedes` set.
 */
export interface IAppendOnlyDecisionStore {
  append(event: DecisionEvent): Promise<DecisionEvent>
  getById(decisionId: string): Promise<DecisionEvent | null>
  /** Returns the full chain by following `supersedes` links from any decision in it. */
  getChain(decisionId: string): Promise<readonly DecisionEvent[]>
}

/**
 * Dependencies for the decision-provenance helpers.
 */
export interface DecisionProvenanceDeps {
  readonly store: IAppendOnlyDecisionStore
}
