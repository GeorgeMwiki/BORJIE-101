/**
 * createThinkingMessage — the one and only entry point for sending a
 * thinking-enabled turn to Claude.
 *
 * Why a wrapper at all?
 *
 *   1. Opus 4.7 returns HTTP 400 on `thinking: { type: 'enabled', ... }`
 *      (the legacy manual shape). The L1 audit calls this out explicitly
 *      and BORJIE's MD must NEVER hit that 400 — losing a high-stakes
 *      eviction turn to a 400 is unacceptable. By making the param's
 *      `type` literal `'adaptive'`, this shape is unrepresentable.
 *
 *   2. Adaptive thinking + interleaved tool use REQUIRES the caller to
 *      pass the prior assistant turn's thinking blocks BACK alongside
 *      the tool_use blocks on the next request — otherwise reasoning
 *      continuity is lost. Callers can forget; the wrapper cannot.
 *      `prepareNextTurn(prior, userMsg)` in `../continuity/` enforces
 *      this when building the next `messages` array.
 *
 *   3. Telemetry on thinking-token usage per turn feeds the K-F budget
 *      UX. Every call emits exactly one telemetry event.
 *
 * This module never imports the Anthropic SDK directly. It accepts a
 * duck-typed `AnthropicClientLike` so tests inject in-memory stubs and
 * the package remains import-safe.
 */

import type {
  AdaptiveEffort,
  AdaptiveThinkingParam,
  AnthropicClientLike,
  AnthropicMessageResponse,
  Message,
  SystemMessage,
  ThinkingTelemetryEvent,
  ThinkingTelemetrySink,
  ToolSpec,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface CreateThinkingMessageArgs {
  readonly client: AnthropicClientLike;
  readonly model: string;
  readonly system: string | ReadonlyArray<SystemMessage>;
  readonly messages: ReadonlyArray<Message>;
  readonly maxTokens?: number;
  readonly tools?: ReadonlyArray<ToolSpec>;
  readonly effort?: AdaptiveEffort;
  readonly temperature?: number;
  readonly toolChoice?: { readonly type: 'auto' | 'any' | 'tool'; readonly name?: string };
  readonly metadata?: Record<string, unknown>;
  readonly telemetrySink?: ThinkingTelemetrySink;
  readonly correlationId?: string;
}

export interface CreateThinkingMessageResult {
  readonly response: AnthropicMessageResponse;
  readonly telemetry: ThinkingTelemetryEvent;
}

const DEFAULT_MAX_TOKENS = 8192;

/**
 * Wraps `client.messages.create` with adaptive thinking and emits a
 * telemetry event with thinking-token usage. Returns BOTH the raw
 * response and the telemetry, so the caller can pass the response
 * through to `prepareNextTurn(...)` and use the telemetry for budget
 * UX without touching the response payload again.
 *
 * Guarantees:
 *   - `thinking: { type: 'adaptive', effort? }` is the ONLY shape sent.
 *   - When the caller's `messages` already contains assistant turns
 *     with thinking blocks, those are passed through unchanged. The
 *     continuity validator in `../continuity/` is the place that
 *     enforces the ordering invariant; this function only delivers
 *     what it is given.
 *   - Telemetry is emitted EXACTLY ONCE per call, even when the
 *     response is empty or the sink throws (sink errors are swallowed).
 */
export async function createThinkingMessage(
  args: CreateThinkingMessageArgs,
): Promise<CreateThinkingMessageResult> {
  if (!args.client) {
    throw new Error('createThinkingMessage: client is required');
  }
  if (!args.model || typeof args.model !== 'string') {
    throw new Error('createThinkingMessage: model is required');
  }
  if (!Array.isArray(args.messages) || args.messages.length === 0) {
    throw new Error('createThinkingMessage: messages must be non-empty');
  }

  const thinking: AdaptiveThinkingParam =
    args.effort !== undefined
      ? { type: 'adaptive', effort: args.effort }
      : { type: 'adaptive' };

  const request = buildRequest({
    model: args.model,
    system: args.system,
    messages: args.messages,
    maxTokens: args.maxTokens ?? DEFAULT_MAX_TOKENS,
    thinking,
    ...(args.tools !== undefined ? { tools: args.tools } : {}),
    ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
    ...(args.toolChoice !== undefined ? { toolChoice: args.toolChoice } : {}),
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
  });

  const response = await args.client.messages.create(request);

  const telemetry = buildTelemetry({
    response,
    model: args.model,
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
    ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
  });

  if (args.telemetrySink) {
    try {
      args.telemetrySink.emit(telemetry);
    } catch {
      // Telemetry must never block the reasoning path.
    }
  }

  return { response, telemetry };
}

// ─────────────────────────────────────────────────────────────────────
// Internals — exported for tests
// ─────────────────────────────────────────────────────────────────────

interface BuildRequestArgs {
  readonly model: string;
  readonly system: string | ReadonlyArray<SystemMessage>;
  readonly messages: ReadonlyArray<Message>;
  readonly maxTokens: number;
  readonly thinking: AdaptiveThinkingParam;
  readonly tools?: ReadonlyArray<ToolSpec>;
  readonly temperature?: number;
  readonly toolChoice?: { readonly type: 'auto' | 'any' | 'tool'; readonly name?: string };
  readonly metadata?: Record<string, unknown>;
}

/**
 * Builds the exact request body sent to Anthropic. Pure function;
 * exported for fixture tests so we can assert on the wire shape.
 */
export function buildRequest(args: BuildRequestArgs): {
  readonly model: string;
  readonly max_tokens: number;
  readonly system: string | ReadonlyArray<SystemMessage>;
  readonly messages: ReadonlyArray<Message>;
  readonly thinking: AdaptiveThinkingParam;
  readonly tools?: ReadonlyArray<ToolSpec>;
  readonly temperature?: number;
  readonly tool_choice?: { readonly type: 'auto' | 'any' | 'tool'; readonly name?: string };
  readonly metadata?: Record<string, unknown>;
} {
  return {
    model: args.model,
    max_tokens: args.maxTokens,
    system: args.system,
    messages: args.messages,
    thinking: args.thinking,
    ...(args.tools !== undefined ? { tools: args.tools } : {}),
    ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
    ...(args.toolChoice !== undefined ? { tool_choice: args.toolChoice } : {}),
    ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
  };
}

interface BuildTelemetryArgs {
  readonly response: AnthropicMessageResponse;
  readonly model: string;
  readonly effort?: AdaptiveEffort;
  readonly correlationId?: string;
}

/**
 * Derive a telemetry event from a raw Anthropic response. Pure
 * function; exported for tests.
 *
 * Token-accounting note: adaptive thinking does not expose a per-block
 * thinking-token count. We estimate `thinkingTokens` as
 * `output_tokens - visibleOutputTokens`, where `visibleOutputTokens`
 * is the rough character count of emitted text blocks divided by 4
 * (Anthropic tokenizer rule-of-thumb). Adapters with richer telemetry
 * (the SDK-side billing webhook) may overwrite this in the sink.
 */
export function buildTelemetry(args: BuildTelemetryArgs): ThinkingTelemetryEvent {
  const blocks = args.response.content ?? [];
  let thinkingBlockCount = 0;
  let toolUseBlockCount = 0;
  let visibleChars = 0;
  for (const block of blocks) {
    if (block.type === 'thinking') thinkingBlockCount += 1;
    else if (block.type === 'tool_use') toolUseBlockCount += 1;
    else if (block.type === 'text') visibleChars += block.text.length;
  }
  const usage = args.response.usage ?? {};
  const totalOutput = usage.output_tokens ?? 0;
  const visibleOutputTokens = Math.ceil(visibleChars / 4);
  const thinkingTokens = Math.max(0, totalOutput - visibleOutputTokens);
  const event: ThinkingTelemetryEvent = {
    capturedAt: Date.now(),
    model: args.model,
    effort: args.effort ?? 'default',
    thinkingTokens,
    visibleOutputTokens,
    inputTokens: usage.input_tokens ?? 0,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    thinkingBlockCount,
    toolUseBlockCount,
    ...(args.response.stop_reason !== undefined ? { stopReason: args.response.stop_reason } : {}),
    ...(args.correlationId !== undefined ? { correlationId: args.correlationId } : {}),
  };
  return event;
}
