/**
 * Adaptive-thinking wrapper — shared types.
 *
 * BORJIE's MD agent runs on Claude Opus 4.7 / Sonnet 4.6+ which
 * accept ONLY the adaptive thinking shape:
 *
 *   thinking: { type: 'adaptive' }
 *   // optional on Opus 4.7+:
 *   thinking: { type: 'adaptive', effort: 'low' | 'medium' | 'high' }
 *
 * The legacy `{ type: 'enabled', budget_tokens: N }` shape returns 400
 * on Opus 4.7 (per L1 audit §1.1). This wrapper exists so callers
 * cannot construct the wrong shape by accident: the only way to send a
 * thinking turn is through `createThinkingMessage(...)`.
 *
 * The types here are duck-typed to the Anthropic SDK so the package
 * remains import-safe whether `@anthropic-ai/sdk` is installed or not.
 */

// ─────────────────────────────────────────────────────────────────────
// Adaptive-thinking parameters
// ─────────────────────────────────────────────────────────────────────

export type AdaptiveEffort = 'low' | 'medium' | 'high';

/**
 * The exact API parameter shape accepted by Opus 4.7 + Sonnet 4.6+.
 * Other shapes (`enabled`, `omitted`, undefined) are intentionally
 * inexpressible.
 */
export interface AdaptiveThinkingParam {
  readonly type: 'adaptive';
  readonly effort?: AdaptiveEffort;
}

// ─────────────────────────────────────────────────────────────────────
// Content blocks — Anthropic's `messages.create` content types,
// duck-typed.
// ─────────────────────────────────────────────────────────────────────

export interface ThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
  /** Cryptographic signature returned by Anthropic. Opaque; pass back as-is. */
  readonly signature?: string;
}

export interface RedactedThinkingBlock {
  readonly type: 'redacted_thinking';
  readonly data: string;
}

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string | ReadonlyArray<TextBlock>;
  readonly is_error?: boolean;
}

export type AssistantBlock =
  | ThinkingBlock
  | RedactedThinkingBlock
  | TextBlock
  | ToolUseBlock;

export type AnyBlock = AssistantBlock | ToolResultBlock;

// ─────────────────────────────────────────────────────────────────────
// Messages
// ─────────────────────────────────────────────────────────────────────

export interface SystemMessage {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: { readonly type: 'ephemeral' };
}

export interface UserMessage {
  readonly role: 'user';
  readonly content: string | ReadonlyArray<ToolResultBlock | TextBlock>;
}

export interface AssistantMessage {
  readonly role: 'assistant';
  readonly content: ReadonlyArray<AssistantBlock>;
}

export type Message = UserMessage | AssistantMessage;

// ─────────────────────────────────────────────────────────────────────
// Tool spec
// ─────────────────────────────────────────────────────────────────────

export interface ToolSpec {
  readonly name: string;
  readonly description?: string;
  readonly input_schema: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────
// Anthropic client (duck-typed)
// ─────────────────────────────────────────────────────────────────────

export interface AnthropicMessageRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly system?: string | ReadonlyArray<SystemMessage>;
  readonly messages: ReadonlyArray<Message>;
  readonly tools?: ReadonlyArray<ToolSpec>;
  readonly thinking?: AdaptiveThinkingParam;
  readonly tool_choice?: { readonly type: 'auto' | 'any' | 'tool'; readonly name?: string };
  readonly temperature?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

export interface AnthropicMessageResponse {
  readonly id?: string;
  readonly model?: string;
  readonly role: 'assistant';
  readonly content: ReadonlyArray<AssistantBlock>;
  readonly stop_reason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | string;
  readonly usage?: AnthropicUsage;
}

export interface AnthropicClientLike {
  readonly messages: {
    create(req: AnthropicMessageRequest): Promise<AnthropicMessageResponse>;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Telemetry — K-F budget UX feeds on this
// ─────────────────────────────────────────────────────────────────────

export interface ThinkingTelemetryEvent {
  /** When the response landed (epoch ms). */
  readonly capturedAt: number;
  readonly model: string;
  readonly effort: AdaptiveEffort | 'default';
  /**
   * Tokens spent THINKING in this turn. Adaptive thinking does not
   * surface a per-block budget, so we use `output_tokens` as the upper
   * bound and subtract visible text tokens when we can; the sink may
   * tighten this in adapters that have richer telemetry.
   */
  readonly thinkingTokens: number;
  readonly visibleOutputTokens: number;
  readonly inputTokens: number;
  readonly cacheCreationTokens: number;
  readonly cacheReadTokens: number;
  /** Number of distinct thinking blocks in the response. */
  readonly thinkingBlockCount: number;
  /** Tool calls emitted in the same turn (relevant for interleaved thinking). */
  readonly toolUseBlockCount: number;
  /** Stop reason — useful for K-F UX. */
  readonly stopReason?: string;
  /** Caller-supplied correlation tag (turnId, taskClass, ...). */
  readonly correlationId?: string;
}

export interface ThinkingTelemetrySink {
  emit(event: ThinkingTelemetryEvent): void;
}
