/**
 * Tier-taxonomy types — 3-tier IP-disclosure matrix.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §1
 */

/**
 * The three disclosure tiers. Numeric ordering matters: lower = safer.
 * Comparison `requestedTier <= principalTier` means "principal is at
 * least cleared for the requested tier".
 */
export enum DisclosureTier {
  /** Public, marketing-grade. Anyone may read. */
  SAFE = 1,
  /** Disclose only to authenticated internal BORJIE staff. */
  HIGH_RISK = 2,
  /** Never disclose. Trade secret / IP / credential / PII. */
  NEVER = 3,
}

/**
 * The 30 known capability fields the Brain could conceivably reveal.
 * Each maps to exactly one tier via {@link FIELD_TIER}.
 */
export type CapabilityField =
  // Tier-1 SAFE
  | 'featureCatalogue'
  | 'modalityMatrix'
  | 'identityAsAI'
  | 'knowledgeCutoff'
  | 'wontDoList'
  | 'supportedJurisdictions'
  | 'dataClassSummary'
  | 'limitationsAndErrorRate'
  | 'recoursePath'
  | 'quotaSignals'
  // Tier-2 HIGH_RISK
  | 'skillLibraryInventory'
  | 'autonomyBudget'
  | 'decisionLedger'
  | 'confidenceScores'
  | 'llmModelNameVersion'
  | 'ragCorpusStats'
  | 'costPerConversation'
  | 'classifierCategories'
  | 'toolErrorLogs'
  // Tier-3 NEVER
  | 'systemPromptText'
  | 'promptEngineeringTricks'
  | 'fineTuneWeightsDeltas'
  | 'specificTrainingExamples'
  | 'internalHeuristicThresholds'
  | 'vendorCredentials'
  | 'perCustomerPricing'
  | 'redTeamPassRates'
  | 'rawSafetyEvalTranscripts'
  | 'architectureDiagrams'
  | 'rawLlmReasoningTrace';

/**
 * A field-resolution result returned by `discloseField`.
 */
export interface FieldDisclosureResult {
  readonly field: CapabilityField;
  readonly fieldTier: DisclosureTier;
  readonly principalTier: DisclosureTier;
  readonly allowed: boolean;
  readonly reason: string;
}
