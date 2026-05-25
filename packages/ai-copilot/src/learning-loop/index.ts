/**
 * Learning-Loop — Wave 28.
 *
 * Closed self-improvement loop for the autonomous agent:
 *
 *   outcome → memory → pattern → policy proposal → dry-run → human → rollout
 *
 * Public surface:
 *   - Types:        OutcomeEvent, Reflection, PatternEvidence,
 *                   PolicyProposal, DryRunReport, ConfidenceScore.
 *   - Factories:    createOutcomeCapture, createConfidenceScorer,
 *                   createInMemoryOutcomeRepository,
 *                   createInMemoryProposalRepository,
 *                   createInMemoryHeadInbox.
 *   - Functions:    writeReflection, extractPatterns, proposeAdjustments,
 *                   runProposalThroughSimulator, requiresHumanReview.
 */

export * from './types.js';
export {
  createOutcomeCapture,
  createInMemoryOutcomeRepository,
} from './outcome-capture.js';
export type {
  OutcomeCapture,
  OutcomeCaptureDeps,
  RecordOutcomeInput,
} from './outcome-capture.js';
export { writeReflection } from './reflection.js';
export type { WriteReflectionDeps } from './reflection.js';
export { extractPatterns } from './pattern-extractor.js';
export type { PatternExtractorOptions } from './pattern-extractor.js';
export { proposeAdjustments } from './policy-proposer.js';
export type { PolicyProposerOptions } from './policy-proposer.js';
export {
  runProposalThroughSimulator,
  createInMemoryProposalRepository,
  createInMemoryHeadInbox,
} from './dry-run-gate.js';
export type {
  DryRunGateDeps,
  PolicySimulatorPort,
  CapturedHeadMessage,
} from './dry-run-gate.js';
export {
  createConfidenceScorer,
  requiresHumanReview,
  LOW_CONFIDENCE_THRESHOLD,
} from './confidence-scorer.js';
export type {
  ConfidenceScorer,
  ConfidenceScorerDeps,
} from './confidence-scorer.js';
