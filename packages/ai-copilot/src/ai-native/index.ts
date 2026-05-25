/**
 * AI-Native capability suite — Agent PhG.
 *
 * Eight capabilities that leverage Anthropic/OpenAI + our heartbeat/memory/
 * event bus to do work that humans CANNOT do at scale:
 *
 *   1. sentiment-monitor      — real-time classification of every message
 *   2. market-surveillance    — daily percentile-band vs comparable listings
 *   3. multimodal-inspection  — vision-model defect detection from photos
 *   4. polyglot-support       — any-language conversational support
 *   5. predictive-interventions — nightly probability distributions per tenant
 *   6. policy-simulator       — Monte Carlo "what-if" on policy changes
 *   7. natural-language-query — question → typed AST → SQL → rows
 *   8. pattern-mining         — weekly privacy-preserving cross-tenant insights
 *
 * All 8 capabilities:
 *   - Wrap LLM calls in a budget-guard callback (wires to CostLedger).
 *   - Log a prompt-hash for audit reproducibility.
 *   - Return model_version + confidence + explanation for human audit.
 *   - Emit ISO-639 language codes + ISO-4217 currency codes — never hardcoded.
 *   - Degrade gracefully when an LLM port is missing (DEGRADED_MODEL_VERSION).
 */

export * from './shared.js';
export * from './sentiment-monitor/index.js';
export * from './market-surveillance/index.js';
export * from './multimodal-inspection/index.js';
export * from './polyglot-support/index.js';
export * from './predictive-interventions/index.js';
export * from './policy-simulator/index.js';
export * from './natural-language-query/index.js';
export * from './pattern-mining/index.js';

// -----------------------------------------------------------------------------
// Agent PhL capabilities — exported under namespaces to avoid `Citation` and
// other name collisions with Agent PhG's capabilities.
// -----------------------------------------------------------------------------
export * as PhlCommon from './phl-common/index.js';
export * as DynamicPricing from './dynamic-pricing/index.js';
export * as DocIntelligence from './doc-intelligence/index.js';
export * as LegalDrafter from './legal-drafter/index.js';
export * as VoiceAgent from './voice-agent/index.js';
