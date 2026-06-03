/**
 * `@borjie/brain-llm-router/cross-provider-auditor` (LP-11) — public surface.
 *
 * After-the-fact second-opinion auditor for numeric/regulatory claims. Samples
 * 5% of responses (100% for royalty/pricing/grade/licence/tax intents), re-routes
 * to a second provider via an injected port, and emits a divergence event via an
 * injected sink when numeric values differ by >5%.
 */

export {
  extractPrimaryClaim,
  compareClaims,
  type ExtractedClaim,
  type ClaimComparison,
} from './claim-extract.js';

export {
  shouldSampleForAudit,
  sampleRateForIntent,
  SAMPLE_RATE_BY_INTENT,
  DEFAULT_SAMPLE_RATE,
  ADVISORY_SAMPLE_RATE,
  FULL_SAMPLE_RATE,
  type SampleDecisionOptions,
} from './sampling.js';

export {
  auditResponse,
  NUMERIC_TOLERANCE,
  type AuditableResponse,
  type SecondOpinionPort,
  type ProviderAuditEvent,
  type ProviderAuditSink,
  type AuditorConfig,
  type AuditOutcome,
} from './auditor.js';
