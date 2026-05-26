/**
 * Extended-Thinking types — Wave 28 Agent THINK.
 *
 * Decision-stakes primitives that let every BORJIE service deliberately
 * engage Claude's extended-thinking mode (with an appropriately-sized token
 * budget) for high-stakes autonomous actions, and skip it cleanly for
 * routine / low-stakes work.
 *
 * The classifier is pure — it yields a deterministic classification for a
 * given context. The router (see `thinking-router.ts`) consumes that
 * classification to pick a provider, engage thinking, and capture the raw
 * thinking trace into the audit trail for regulatory / compliance review.
 *
 * Type contract ONLY — no runtime code lives here.
 */

import type { AutonomyDomain } from '../autonomy/types.js';

// ---------------------------------------------------------------------------
// Stakes scale
// ---------------------------------------------------------------------------

/**
 * Four-tier stakes scale. Rising stakes unlock larger thinking budgets and
 * more powerful models. `critical` is reserved for decisions that are
 * simultaneously irreversible, regulated, and affect housing or a
 * vulnerable counterparty — the narrow class where deep deliberation
 * is genuinely required and cost is irrelevant compared to regret.
 */
export type DecisionStakes = 'low' | 'medium' | 'high' | 'critical';

export const DECISION_STAKES: readonly DecisionStakes[] = [
  'low',
  'medium',
  'high',
  'critical',
] as const;

// ---------------------------------------------------------------------------
// Decision context — what the caller passes in
// ---------------------------------------------------------------------------

/**
 * Everything the classifier needs to know about a decision to place it on
 * the stakes scale. Fields are intentionally flat so the caller can build
 * one from disparate inputs without a nested schema.
 */
export interface DecisionContext {
  readonly domain: AutonomyDomain;
  /** Stable verb identifying the decision, e.g. `lease.terminate`. */
  readonly actionType: string;
  /** Money amount in minor units (cents / shillings cents), if applicable. */
  readonly amountMinorUnits?: number;
  /** True if the action cannot be undone by a follow-up action. */
  readonly reversible: boolean;
  /** True if the decision falls under tribunal / tax / housing-authority rules. */
  readonly regulated: boolean;
  /** True if a wrong outcome could leave someone without shelter. */
  readonly affectsHousing: boolean;
  /** True if the decision output appears in public listings, tenders, etc. */
  readonly publiclyVisible: boolean;
  /** True if the counterparty is a vulnerable household or minor tenant. */
  readonly counterpartyIsVulnerable: boolean;
  /** Optional correlation id for audit tracing. */
  readonly correlationId?: string;
}

// ---------------------------------------------------------------------------
// Classifier output
// ---------------------------------------------------------------------------

/**
 * Three model tiers matching `ModelTier` in `anthropic-client.ts`. We keep
 * the names friendly (haiku/sonnet/opus) and let the router resolve each
 * to a concrete model id.
 */
export type ThinkingModelTier = 'haiku' | 'sonnet' | 'opus';

export interface StakesClassification {
  readonly stakes: DecisionStakes;
  /** Human-readable justification — surfaced in audit + admin UI. */
  readonly reasoning: string;
  /** Anthropic extended-thinking budget (tokens). 0 disables thinking. */
  readonly thinkingBudgetTokens: number;
  /** Recommended model tier for the call. */
  readonly recommendedModel: ThinkingModelTier;
  /** Policy rule id that fired — stable string, useful for analytics. */
  readonly ruleId: string;
}

// ---------------------------------------------------------------------------
// Router output
// ---------------------------------------------------------------------------

export interface ThinkingResult {
  /** The concise decision produced by the model. */
  readonly decision: string;
  /** Short human-readable reasoning summary (separate from raw trace). */
  readonly reasoning: string;
  /**
   * The raw thinking block captured for the audit trail. May be empty if
   * the model did not emit extended-thinking (e.g. fallback on low stakes
   * or extended-thinking unavailable on the selected model).
   */
  readonly thinkingTrace: string;
  readonly thinkingTokensUsed: number;
  /** 0-1 confidence score reported by the model or inferred from retries. */
  readonly confidence: number;
  readonly stakesClassification: StakesClassification;
  /** Concrete model id that actually served the decision. */
  readonly modelIdUsed: string;
  /** True if extended-thinking was genuinely engaged (vs skipped/unavailable). */
  readonly thinkingEngaged: boolean;
}

// ---------------------------------------------------------------------------
// Thinking-capable client surface (minimal so it's trivial to mock)
// ---------------------------------------------------------------------------

/**
 * Optional thinking block returned by the Anthropic SDK when
 * `thinking: { type: 'enabled', budget_tokens: N }` is supplied on the
 * request. We only depend on the text contents for audit capture.
 */
export interface ThinkingContentBlock {
  readonly type: 'thinking';
  readonly thinking: string;
}

export interface ThinkingTextBlock {
  readonly type: 'text';
  readonly text: string;
}

export type ThinkingResponseBlock =
  | ThinkingContentBlock
  | ThinkingTextBlock
  | { readonly type: string; readonly [k: string]: unknown };

export interface ThinkingMessageRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system?: string | undefined;
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
  /** When present, the SDK engages extended-thinking. */
  readonly thinking?: {
    readonly type: 'enabled';
    readonly budget_tokens: number;
  } | undefined;
  readonly temperature?: number | undefined;
}

export interface ThinkingMessageResponse {
  readonly content: ReadonlyArray<ThinkingResponseBlock>;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly stop_reason?: string;
}

export interface ThinkingCapableClient {
  messages: {
    create(request: ThinkingMessageRequest): Promise<ThinkingMessageResponse>;
  };
}

// ---------------------------------------------------------------------------
// Fallback — used when extended-thinking is not available for the chosen
// model, when the client is offline, or for low-stakes decisions.
// ---------------------------------------------------------------------------

/**
 * Minimal shape of a non-thinking fallback LLM. Returns a decision + short
 * reasoning string. Intentionally narrow so the existing multi-LLM-router
 * can be adapted with a tiny shim.
 */
export interface FallbackLLM {
  decide(prompt: string, systemPrompt?: string): Promise<{
    readonly decision: string;
    readonly reasoning: string;
    readonly modelId: string;
    readonly confidence?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Audit port — the router records high-stakes thinking traces through this.
// Kept narrow so the autonomous-action-audit module AND the new audit-trail
// v2 module can both satisfy it with tiny adapters.
// ---------------------------------------------------------------------------

export interface ReasoningAuditRecord {
  readonly tenantId: string;
  readonly context: DecisionContext;
  readonly classification: StakesClassification;
  /** Trace as captured — adapter is responsible for PII redaction. */
  readonly thinkingTrace: string;
  readonly decision: string;
  readonly reasoning: string;
  readonly modelIdUsed: string;
  readonly thinkingTokensUsed: number;
  readonly occurredAt: Date;
}

export interface ReasoningAuditRecorder {
  record(record: ReasoningAuditRecord): Promise<void>;
}

// ---------------------------------------------------------------------------
// Thinking-router dependencies
// ---------------------------------------------------------------------------

export interface ModelTierResolver {
  resolve(tier: ThinkingModelTier): string;
}

export interface ThinkingRouterDeps {
  /** Anthropic (or mock) client capable of extended-thinking. */
  readonly anthropic: ThinkingCapableClient;
  /** Non-thinking fallback (e.g. OpenAI or Haiku) for low-stakes calls. */
  readonly fallbackLLM: FallbackLLM;
  /** Audit recorder — engaged only for `high` and `critical` stakes by default. */
  readonly auditRecorder?: ReasoningAuditRecorder;
  /** Resolves tier → concrete model id. Falls back to built-in defaults. */
  readonly modelTierResolver?: ModelTierResolver;
  /** Clock — injected for deterministic tests. */
  readonly now?: () => Date;
  /**
   * When set to true, the router records traces for `medium` stakes too.
   * Default: false (only `high` + `critical` trigger audit writes).
   */
  readonly auditMediumStakes?: boolean;
}

export interface ThinkingRouter {
  thinkAndDecide(
    prompt: string,
    context: DecisionContext,
    options?: ThinkAndDecideOptions,
  ): Promise<ThinkingResult>;
}

export interface ThinkAndDecideOptions {
  readonly tenantId?: string;
  readonly systemPrompt?: string;
  /** Override the automatic classification (caller knows better). */
  readonly classificationOverride?: StakesClassification;
  /**
   * Max wall-clock the router may spend on the call, ms. If both the
   * primary and fallback exceed this, an error is thrown.
   */
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Default budget table — exported so admin UIs can render the policy.
// ---------------------------------------------------------------------------

export const DEFAULT_THINKING_BUDGETS: Readonly<
  Record<DecisionStakes, number>
> = Object.freeze({
  low: 0,
  medium: 1500,
  high: 4000,
  critical: 8000,
});

export const DEFAULT_MODEL_TIERS: Readonly<
  Record<DecisionStakes, ThinkingModelTier>
> = Object.freeze({
  low: 'haiku',
  medium: 'sonnet',
  high: 'opus',
  critical: 'opus',
});
