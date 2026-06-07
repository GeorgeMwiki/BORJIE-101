/**
 * Anthropic LLM router adapter (Item-5).
 *
 * Implements the orchestrator's `LLMRouter` port over an injected
 * Anthropic Messages client. It is the SDK-coupling seam the main loop
 * deliberately refuses to own: the loop calls `router.call({ system,
 * tools, messages })` and gets back a closed `Decision`; this adapter
 * is the only place that knows the Anthropic content-block shape.
 *
 * Mapping (Anthropic response → Decision):
 *   - a `tool_use` block          → `{ kind: 'tool_call', call: {...} }`
 *     (the FIRST tool_use block wins; the loop dispatches one tool per
 *     tick, then re-enters with the result folded into the transcript)
 *   - text-only blocks            → `{ kind: 'respond_to_owner', text }`
 *   - empty / unparseable content → `{ kind: 'final', text: '' }`
 *
 * Provider-agnostic at the port boundary: the adapter accepts the same
 * duck-typed `AnthropicMessagesClient` the kernel sensors already use,
 * so the composition root can pass a budget-guarded client's `.sdk`
 * unchanged. No `@anthropic-ai/sdk` import — the package compiles in a
 * workspace that has not installed the SDK.
 *
 * Fail-safe: any thrown error from the client is caught and collapsed to
 * a `final` decision carrying the error text, so the main loop always
 * sees a closed shape (it never throws out of `router.call`).
 *
 * @module kernel/orchestrator/anthropic-router
 */

import type { AnthropicMessagesClient } from '../sensors/anthropic-sensor.js';
import type { Decision } from './decision.js';
import type { LLMRouter, LLMRouterCall } from './main-loop.js';
import type { ToolDescriptor } from './context-budget.js';

export interface AnthropicRouterConfig {
  /** Anthropic model id (e.g. a Sonnet/Opus id supplied by the gateway). */
  readonly model: string;
  /** Max output tokens per router call. Default 1024. */
  readonly maxTokens?: number;
  /**
   * Optional callId generator so dispatch + hook layers can correlate.
   * Defaults to a monotonic per-router counter (`call_<n>`); production
   * may inject `() => randomUUID()`.
   */
  readonly callIdGenerator?: () => string;
  /**
   * Optional Zod-free input-schema provider. Given a tool name, returns
   * the JSON-schema `input_schema` the Anthropic tool definition needs.
   * When omitted, tools are advertised with a permissive open-object
   * schema so the model can still call them. The composition root wires
   * the real per-tool schemas from the BrainTool registry.
   */
  readonly inputSchemaFor?: (toolName: string) => Record<string, unknown>;
  /** Optional logger (Pino-style). No console.* per the hard rules. */
  readonly logger?: {
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

const DEFAULT_MAX_TOKENS = 1024;
const OPEN_OBJECT_SCHEMA: Record<string, unknown> = Object.freeze({
  type: 'object',
  properties: {},
  additionalProperties: true,
});

/**
 * Build a real `LLMRouter` backed by an Anthropic Messages client.
 */
export function createAnthropicRouter(
  client: AnthropicMessagesClient,
  config: AnthropicRouterConfig,
): LLMRouter {
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  let callSeq = 0;
  const nextCallId =
    config.callIdGenerator ??
    ((): string => {
      callSeq += 1;
      return `call_${callSeq}`;
    });

  return {
    async call(args: LLMRouterCall): Promise<Decision> {
      try {
        const response = await client.messages.create({
          model: config.model,
          max_tokens: maxTokens,
          system: args.system,
          messages: toAnthropicMessages(args.messages),
          // `tools` is a passthrough field on the duck-typed client; the
          // SDK accepts it and the type's trailing-comment contract says
          // unknown fields are ignored by adapters that don't read them.
          ...(args.tools.length > 0
            ? { tools: toAnthropicTools(args.tools, config.inputSchemaFor) }
            : {}),
        } as Parameters<AnthropicMessagesClient['messages']['create']>[0]);
        return responseToDecision(response, nextCallId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'anthropic router error';
        config.logger?.warn('anthropic-router call failed', { reason: message });
        // Closed shape — never throw out of the port.
        return { kind: 'final', text: '' };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Internal — request/response mapping. Pure + deterministic.
// ─────────────────────────────────────────────────────────────────────

/**
 * Map the orchestrator's role-tagged messages onto Anthropic request
 * messages. Anthropic accepts only `user` / `assistant` roles, so we
 * fold `tool` and `system` turns into `user` turns (tool results and
 * mid-loop system injections are presented to the model as user-visible
 * context, prefixed so the model can tell them apart). This keeps the
 * loop's `additional-context` injections + tool-result folding intact.
 */
function toAnthropicMessages(
  messages: LLMRouterCall['messages'],
): ReadonlyArray<{ role: 'user' | 'assistant'; content: string }> {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      return { role: 'assistant' as const, content: m.content };
    }
    if (m.role === 'tool') {
      return { role: 'user' as const, content: `[tool result]\n${m.content}` };
    }
    if (m.role === 'system') {
      return { role: 'user' as const, content: `[context]\n${m.content}` };
    }
    return { role: 'user' as const, content: m.content };
  });
}

interface AnthropicToolDef {
  readonly name: string;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
}

/** Map orchestrator `ToolDescriptor`s onto Anthropic tool definitions. */
function toAnthropicTools(
  tools: ReadonlyArray<ToolDescriptor>,
  inputSchemaFor?: (toolName: string) => Record<string, unknown>,
): ReadonlyArray<AnthropicToolDef> {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchemaFor ? inputSchemaFor(t.name) : OPEN_OBJECT_SCHEMA,
  }));
}

/**
 * Parse an Anthropic message response into a `Decision`. The first
 * `tool_use` block (if any) becomes a `tool_call`; otherwise the
 * concatenated text becomes `respond_to_owner`. Empty content collapses
 * to a graceful `final`.
 */
function responseToDecision(
  response: {
    readonly content: ReadonlyArray<{
      readonly type: 'text' | 'thinking' | 'tool_use';
      readonly text?: string;
      readonly id?: string;
      readonly name?: string;
      readonly input?: unknown;
    }>;
  },
  nextCallId: () => string,
): Decision {
  let text = '';
  for (const block of response.content) {
    if (block.type === 'tool_use' && typeof block.name === 'string') {
      const input =
        block.input && typeof block.input === 'object'
          ? (block.input as Record<string, unknown>)
          : {};
      return {
        kind: 'tool_call',
        call: {
          toolName: block.name,
          input,
          // Prefer the SDK's tool_use id so a downstream system can
          // correlate; fall back to the router's monotonic id.
          callId:
            typeof block.id === 'string' && block.id.length > 0
              ? block.id
              : nextCallId(),
        },
      };
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text;
    }
  }
  if (text.trim().length > 0) {
    return { kind: 'respond_to_owner', text };
  }
  return { kind: 'final', text: '' };
}
