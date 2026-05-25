/**
 * Field → tier mapping. Source of truth for the 3-tier taxonomy.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §1
 */

import { type CapabilityField, DisclosureTier } from './types.js';

/**
 * 10 SAFE fields — public marketing-grade. Anyone may read.
 */
export const SAFE_FIELDS: readonly CapabilityField[] = Object.freeze([
  'featureCatalogue',
  'modalityMatrix',
  'identityAsAI',
  'knowledgeCutoff',
  'wontDoList',
  'supportedJurisdictions',
  'dataClassSummary',
  'limitationsAndErrorRate',
  'recoursePath',
  'quotaSignals',
]);

/**
 * 9 HIGH_RISK fields — internal staff only.
 */
export const HIGH_RISK_FIELDS: readonly CapabilityField[] = Object.freeze([
  'skillLibraryInventory',
  'autonomyBudget',
  'decisionLedger',
  'confidenceScores',
  'llmModelNameVersion',
  'ragCorpusStats',
  'costPerConversation',
  'classifierCategories',
  'toolErrorLogs',
]);

/**
 * 11 NEVER fields — refuse to anyone external; security team only.
 */
export const NEVER_FIELDS: readonly CapabilityField[] = Object.freeze([
  'systemPromptText',
  'promptEngineeringTricks',
  'fineTuneWeightsDeltas',
  'specificTrainingExamples',
  'internalHeuristicThresholds',
  'vendorCredentials',
  'perCustomerPricing',
  'redTeamPassRates',
  'rawSafetyEvalTranscripts',
  'architectureDiagrams',
  'rawLlmReasoningTrace',
]);

/**
 * Constant-time lookup from field name to tier.
 * Immutable; never mutate at runtime.
 */
export const FIELD_TIER: Readonly<Record<CapabilityField, DisclosureTier>> = Object.freeze({
  // SAFE (10)
  featureCatalogue: DisclosureTier.SAFE,
  modalityMatrix: DisclosureTier.SAFE,
  identityAsAI: DisclosureTier.SAFE,
  knowledgeCutoff: DisclosureTier.SAFE,
  wontDoList: DisclosureTier.SAFE,
  supportedJurisdictions: DisclosureTier.SAFE,
  dataClassSummary: DisclosureTier.SAFE,
  limitationsAndErrorRate: DisclosureTier.SAFE,
  recoursePath: DisclosureTier.SAFE,
  quotaSignals: DisclosureTier.SAFE,
  // HIGH_RISK (9)
  skillLibraryInventory: DisclosureTier.HIGH_RISK,
  autonomyBudget: DisclosureTier.HIGH_RISK,
  decisionLedger: DisclosureTier.HIGH_RISK,
  confidenceScores: DisclosureTier.HIGH_RISK,
  llmModelNameVersion: DisclosureTier.HIGH_RISK,
  ragCorpusStats: DisclosureTier.HIGH_RISK,
  costPerConversation: DisclosureTier.HIGH_RISK,
  classifierCategories: DisclosureTier.HIGH_RISK,
  toolErrorLogs: DisclosureTier.HIGH_RISK,
  // NEVER (11)
  systemPromptText: DisclosureTier.NEVER,
  promptEngineeringTricks: DisclosureTier.NEVER,
  fineTuneWeightsDeltas: DisclosureTier.NEVER,
  specificTrainingExamples: DisclosureTier.NEVER,
  internalHeuristicThresholds: DisclosureTier.NEVER,
  vendorCredentials: DisclosureTier.NEVER,
  perCustomerPricing: DisclosureTier.NEVER,
  redTeamPassRates: DisclosureTier.NEVER,
  rawSafetyEvalTranscripts: DisclosureTier.NEVER,
  architectureDiagrams: DisclosureTier.NEVER,
  rawLlmReasoningTrace: DisclosureTier.NEVER,
});
