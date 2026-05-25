/**
 * Shared types for @borjie/brain-llm-router (Phase N-C).
 *
 * Design: ALL request shapes use Anthropic-style messages + content blocks
 * (the most expressive of the three families). Adapters translate OUT to the
 * native provider format. Responses come back in the same Anthropic-style
 * shape regardless of provider — this is the "soul-portability layer".
 *
 * Every type is `Readonly<...>` to enforce immutability across the router.
 */

// ───────────────────────────── Task kinds ─────────────────────────────

export type TaskKind =
  | 'plan' // multi-step planning, ambiguous goals
  | 'tool-use' // MCP / CRUD / action execution
  | 'critic' // CoVe / Constitutional critic
  | 'classify' // intent / routing / lint
  | 'chat' // tenant-facing conversation
  | 'longdoc' // ≥150K context legal/policy
  | 'codegen'; // self-code-writing

// ─────────────────────────── Model tiers ─────────────────────────────

/** Canonical model identifier — provider/model[@cloud]. */
export type ModelTier = string;

export type ProviderName =
  | 'anthropic'
  | 'anthropic-bedrock'
  | 'anthropic-vertex'
  | 'openai'
  | 'google'
  | 'ollama'
  | 'vllm';

// ──────────────────────── Content blocks (Anthropic shape) ────────────

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
  /** Anthropic emits cryptographic signature; other providers leave undefined. */
  readonly signature?: string;
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

export interface BrainLLMMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: readonly ContentBlock[];
}

// ───────────────────────────── Request / response ──────────────────────

export interface BrainLLMRequest {
  readonly model: ModelTier;
  readonly messages: readonly BrainLLMMessage[];
  readonly system?: string;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly stopSequences?: readonly string[];
  readonly tools?: readonly BrainLLMToolDef[];
  /** Anthropic extended-thinking parameter. Other adapters stub. */
  readonly thinking?: { readonly budgetTokens: number };
  /** Per-call timeout (ms). Defaults to provider default. */
  readonly timeoutMs?: number;
}

export interface BrainLLMToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface BrainLLMResponse {
  readonly id: string;
  readonly model: ModelTier;
  readonly provider: ProviderName;
  readonly content: readonly ContentBlock[];
  readonly stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  readonly usage: BrainLLMUsage;
  readonly latencyMs: number;
}

export interface BrainLLMUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

// ───────────────────────────── Pricing ─────────────────────────────────

export interface ModelPricing {
  readonly inputPerMillion: number; // USD / 1M input tokens
  readonly outputPerMillion: number; // USD / 1M output tokens
  readonly cacheReadPerMillion?: number;
  readonly cacheWritePerMillion?: number;
}

// ───────────────────────────── Confidence / eval ───────────────────────

export interface ResponseQuality {
  readonly response: BrainLLMResponse;
  /** Self-Consistency vote agreement [0..1] (1.0 = unanimous). */
  readonly consistency?: number;
  /** CoVe verifier judgement [0..1]. */
  readonly verification?: number;
  /** Composite confidence [0..1]. */
  readonly confidence: number;
}

// ───────────────────────────── Brain call options ──────────────────────

export interface BrainCallOptions {
  /** Sample count for Self-Consistency vote (M-B). 1 = no vote. */
  readonly consistencyN?: number;
  /** Wrap output with CoVe critic (M-B). */
  readonly cove?: boolean;
  /** Fire hedged request after p90 latency window. */
  readonly hedged?: boolean;
  /** Per-call hard fail above this USD amount. */
  readonly costCapUsd?: number;
  /** Override TASK_LADDER per-tenant. */
  readonly ladderOverride?: readonly ModelTier[];
}

export interface BrainCallRequest {
  readonly task: TaskKind;
  readonly prompt: string;
  readonly tenantId: string;
  readonly options?: BrainCallOptions;
}

// ───────────────────────────── Adapter interface ───────────────────────

export interface BrainLLMClient {
  readonly provider: ProviderName;
  invoke(req: BrainLLMRequest): Promise<BrainLLMResponse>;
}

// ───────────────────────────── Errors ──────────────────────────────────

export class BrainLLMError extends Error {
  public readonly code: string;
  public readonly provider?: ProviderName;
  public readonly retryable: boolean;

  constructor(opts: {
    readonly code: string;
    readonly message: string;
    readonly provider?: ProviderName;
    readonly retryable?: boolean;
  }) {
    super(opts.message);
    this.name = 'BrainLLMError';
    this.code = opts.code;
    if (opts.provider !== undefined) {
      this.provider = opts.provider;
    }
    this.retryable = opts.retryable ?? false;
  }
}

export type ProviderHealth = 'healthy' | 'degraded' | 'open';
