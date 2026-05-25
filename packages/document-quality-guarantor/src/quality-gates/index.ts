/**
 * Quality gates barrel. Each gate exported here is independently
 * composable + testable.
 */

export { confidenceGate, type ConfidenceGateOptions } from './confidence-gate.js';
export {
  schemaCompletenessGate,
  type SchemaCompletenessGateOptions,
} from './schema-completeness-gate.js';
export {
  citationCoverageGate,
  type CitationCoverageGateOptions,
} from './citation-coverage-gate.js';
export {
  roundtripFidelityGate,
  type RoundtripFidelityGateOptions,
} from './roundtrip-fidelity-gate.js';
export { visualDiffGate, type VisualDiffGateOptions } from './visual-diff-gate.js';
export { fontEmbeddingGate } from './font-embedding-gate.js';
export { accessibilityGate } from './accessibility-gate.js';
export { composeGates, type ComposedGateInput, type ComposeGatesOptions } from './compose.js';
export type {
  AccessibilityGateInput,
  CitationCoverageGateInput,
  ConfidenceGateInput,
  FontEmbeddingGateInput,
  Gate,
  RoundtripFidelityGateInput,
  SchemaCompletenessGateInput,
  VisualDiffGateInput,
} from './types.js';
