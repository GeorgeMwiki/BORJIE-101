/**
 * Anthropic Sensor — wraps the @anthropic-ai/sdk Messages API as a
 * kernel Sensor. Provider-agnostic kernel + provider-specific adapter
 * pattern; downstream callers compose multiple sensors into a
 * SensorRouter for failover.
 *
 * The adapter exposes "thinking" and "fast" capabilities so the
 * router can pick the right model for the current call (Opus 4.7 for
 * extended thinking, Sonnet 4.6 for everyday work, Haiku 4.5 for
 * fast / batch).
 *
 * No streaming here — the kernel's `think()` is a single-shot RPC.
 * Streaming tool-use is owned by the agent-loop transport.
 *
 * The @anthropic-ai/sdk dependency is a peer-dep; consumers bring
 * their own version.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
import type {
  Sensor,
  SensorCallArgs,
  SensorCallResult,
  SensorStreamEvent,
  ThoughtAttachment,
} from '../kernel-types.js';

// ---------------------------------------------------------------------------
// Minimal duck-typed surface of Anthropic's Messages API. We avoid a
// hard import of the SDK so this module's *types* are buildable in a
// workspace that has not yet installed @anthropic-ai/sdk; consumers
// pass in a real client at runtime.
// ---------------------------------------------------------------------------

export interface AnthropicMessageBlock {
  readonly type: 'text' | 'thinking' | 'tool_use';
  readonly text?: string;
  readonly thinking?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
}

export interface AnthropicMessageResponse {
  readonly id: string;
  readonly model: string;
  readonly stop_reason: string | null;
  readonly content: ReadonlyArray<AnthropicMessageBlock>;
}

/**
 * Subset of the Anthropic multimodal request blocks we emit.
 * Text-only turns send a plain string; multimodal turns send an array
 * of these blocks per Anthropic's spec.
 */
export type AnthropicRequestContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image';
      readonly source: {
        readonly type: 'base64';
        readonly media_type:
          | 'image/png'
          | 'image/jpeg'
          | 'image/gif'
          | 'image/webp';
        readonly data: string;
      };
    };

export type AnthropicRequestMessage = {
  readonly role: 'user' | 'assistant';
  /**
   * Plain string for text-only turns, or a multipart array for
   * multimodal turns (image + text). The Anthropic SDK accepts both
   * shapes on the same field.
   */
  readonly content: string | ReadonlyArray<AnthropicRequestContentBlock>;
};

/**
 * Minimal duck-typed shape of an Anthropic streaming event. We map this
 * onto the kernel's provider-agnostic `SensorStreamEvent` union before
 * yielding to the consumer. The SDK's `messages.stream(...)` returns an
 * async-iterable of these.
 */
export interface AnthropicStreamEvent {
  readonly type: string;
  readonly index?: number;
  readonly delta?: {
    readonly type?: string;
    readonly text?: string;
    readonly thinking?: string;
    readonly stop_reason?: string;
  };
  readonly content_block?: {
    readonly type?: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: unknown;
  };
  readonly message?: {
    readonly stop_reason?: string;
  };
}

export interface AnthropicMessagesClient {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ReadonlyArray<AnthropicRequestMessage>;
      thinking?: { type: 'enabled'; budget_tokens: number };
      // any other passthrough fields are ignored
    }): Promise<AnthropicMessageResponse>;
    /**
     * Optional streaming entry. The SDK's `messages.stream` returns an
     * async-iterable of MessageStreamEvent. We type it as the minimal
     * duck shape so this package compiles without the SDK installed.
     */
    stream?(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ReadonlyArray<AnthropicRequestMessage>;
      thinking?: { type: 'enabled'; budget_tokens: number };
    }): AsyncIterable<AnthropicStreamEvent>;
  };
}

export interface AnthropicSensorConfig {
  readonly id: string;
  readonly modelId: string;
  readonly priority: number;
  readonly capabilities: ReadonlyArray<Sensor['capabilities'][number]>;
  /** Max output tokens. Default 1024. */
  readonly maxTokens?: number;
  /** When true (and stakes high/critical), enable extended thinking. */
  readonly extendedThinkingBudget?: number;
}

export function createAnthropicSensor(
  client: AnthropicMessagesClient,
  config: AnthropicSensorConfig,
): Sensor {
  const maxTokens = config.maxTokens ?? 1024;
  const thinkingBudget = config.extendedThinkingBudget ?? 4096;

  return {
    id: config.id,
    modelId: config.modelId,
    priority: config.priority,
    capabilities: config.capabilities,

    async call(args: SensorCallArgs): Promise<SensorCallResult> {
      const start = Date.now();
      const useThinking =
        args.extendedThinking &&
        config.capabilities.includes('thinking');

      const userContent = buildUserContent(args.userMessage, args.attachments);
      const messages: AnthropicRequestMessage[] = [
        ...args.priorTurns.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user' as const, content: userContent },
      ];

      const response = await client.messages.create({
        model: config.modelId,
        max_tokens: maxTokens,
        system: args.system,
        messages,
        ...(useThinking
          ? { thinking: { type: 'enabled' as const, budget_tokens: thinkingBudget } }
          : {}),
      });

      let text = '';
      let thought: string | null = null;
      const toolCalls: Array<{ toolName: string; input: unknown; callId: string }> = [];

      for (const block of response.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          text += block.text;
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          thought = (thought ?? '') + block.thinking;
        } else if (block.type === 'tool_use' && block.name) {
          toolCalls.push({
            toolName: block.name,
            input: block.input,
            callId: block.id ?? `tu_${toolCalls.length}`,
          });
        }
      }

      return {
        text,
        thought,
        toolCalls,
        latencyMs: Date.now() - start,
        modelId: response.model || config.modelId,
        sensorId: config.id,
      };
    },

    /**
     * Token-level streaming entry point. Maps Anthropic's
     * `messages.stream(...)` events onto the provider-agnostic
     * `SensorStreamEvent` union. Yields:
     *   - `turn_start` once at the start (with model + sensor id)
     *   - `text_delta` for each text chunk
     *   - `thought_delta` for each extended-thinking chunk
     *   - `tool_call` once per tool_use block, after its input is fully
     *     accumulated from the SDK's input_json_delta stream
     *   - `stop` once at the end (latencyMs measured here)
     *
     * If the underlying client doesn't expose `messages.stream`, this
     * generator falls back to a single-shot `call()` and emits the
     * accumulated result as a single text_delta + stop. This means a
     * sensor that defines `callStream` always works, even when wired
     * to an older Anthropic client.
     */
    async *callStream(args: SensorCallArgs): AsyncIterable<SensorStreamEvent> {
      const start = Date.now();
      const useThinking =
        args.extendedThinking &&
        config.capabilities.includes('thinking');

      const userContent = buildUserContent(args.userMessage, args.attachments);
      const messages: AnthropicRequestMessage[] = [
        ...args.priorTurns.map((t) => ({ role: t.role, content: t.content })),
        { role: 'user' as const, content: userContent },
      ];

      yield {
        kind: 'turn_start',
        modelId: config.modelId,
        sensorId: config.id,
      };

      // No streaming on the client → fall back to one-shot.
      if (!client.messages.stream) {
        try {
          const single = await this.call(args);
          if (single.thought) {
            yield { kind: 'thought_delta', text: single.thought };
          }
          if (single.text) {
            yield { kind: 'text_delta', text: single.text };
          }
          for (const tc of single.toolCalls) {
            yield {
              kind: 'tool_call',
              toolName: tc.toolName,
              input: tc.input,
              callId: tc.callId,
            };
          }
          yield {
            kind: 'stop',
            stopReason: 'end_turn',
            latencyMs: Date.now() - start,
          };
        } catch {
          yield {
            kind: 'stop',
            stopReason: 'error',
            latencyMs: Date.now() - start,
          };
        }
        return;
      }

      const stream = client.messages.stream({
        model: config.modelId,
        max_tokens: maxTokens,
        system: args.system,
        messages,
        ...(useThinking
          ? { thinking: { type: 'enabled' as const, budget_tokens: thinkingBudget } }
          : {}),
      });

      // The Anthropic SDK delivers tool_use input as a stream of partial
      // JSON deltas tied to a content_block index. Buffer them per
      // index and flush as a single `tool_call` event at content_block_stop.
      const pendingToolCalls = new Map<
        number,
        { toolName: string; callId: string; inputJson: string }
      >();
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' = 'end_turn';

      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_start' && ev.content_block) {
            const cb = ev.content_block;
            if (cb.type === 'tool_use' && typeof ev.index === 'number') {
              pendingToolCalls.set(ev.index, {
                toolName: cb.name ?? '',
                callId: cb.id ?? `tu_${ev.index}`,
                inputJson: '',
              });
            }
            continue;
          }
          if (ev.type === 'content_block_delta' && ev.delta) {
            const d = ev.delta as {
              type?: string;
              text?: string;
              thinking?: string;
              partial_json?: string;
            };
            if (d.type === 'text_delta' && typeof d.text === 'string' && d.text.length > 0) {
              yield { kind: 'text_delta', text: d.text };
            } else if (
              d.type === 'thinking_delta' &&
              typeof d.thinking === 'string' &&
              d.thinking.length > 0
            ) {
              yield { kind: 'thought_delta', text: d.thinking };
            } else if (
              d.type === 'input_json_delta' &&
              typeof ev.index === 'number'
            ) {
              const partial = d.partial_json ?? '';
              const pending = pendingToolCalls.get(ev.index);
              if (pending) {
                pendingToolCalls.set(ev.index, {
                  ...pending,
                  inputJson: pending.inputJson + partial,
                });
              }
            }
            continue;
          }
          if (ev.type === 'content_block_stop' && typeof ev.index === 'number') {
            const pending = pendingToolCalls.get(ev.index);
            if (pending && pending.toolName) {
              let parsed: unknown = {};
              if (pending.inputJson.length > 0) {
                try {
                  parsed = JSON.parse(pending.inputJson);
                } catch {
                  parsed = { raw: pending.inputJson };
                }
              }
              yield {
                kind: 'tool_call',
                toolName: pending.toolName,
                input: parsed,
                callId: pending.callId,
              };
              pendingToolCalls.delete(ev.index);
            }
            continue;
          }
          if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
            stopReason = mapStopReason(ev.delta.stop_reason);
            continue;
          }
          if (ev.type === 'message_stop') {
            break;
          }
        }
      } catch {
        stopReason = 'error';
      }

      yield {
        kind: 'stop',
        stopReason,
        latencyMs: Date.now() - start,
      };
    },
  };
}

function mapStopReason(
  raw: string,
): 'end_turn' | 'tool_use' | 'max_tokens' | 'error' {
  switch (raw) {
    case 'end_turn':   return 'end_turn';
    case 'tool_use':   return 'tool_use';
    case 'max_tokens': return 'max_tokens';
    default:           return 'end_turn';
  }
}

/**
 * Build the user-message `content` field for the Anthropic Messages
 * API. Plain string for text-only turns; multipart array (images first,
 * text last) for multimodal turns.
 */
function buildUserContent(
  userMessage: string,
  attachments: ReadonlyArray<ThoughtAttachment> | undefined,
): string | ReadonlyArray<AnthropicRequestContentBlock> {
  if (!attachments || attachments.length === 0) return userMessage;

  const blocks: AnthropicRequestContentBlock[] = [];
  for (const att of attachments) {
    if (att.kind !== 'image') continue;
    blocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: att.mediaType,
        data: att.data,
      },
    });
  }
  blocks.push({ type: 'text', text: userMessage });
  return blocks;
}

/**
 * Suggested presets for the three Claude tiers, with priorities tuned
 * so the router falls Opus → Sonnet → Haiku on failure.
 *
 * All three current Claude generations support image input, so each
 * preset declares `'vision'`. Haiku is the priority-3 fallback so it is
 * the last option for vision-bearing turns when a higher-tier sensor is
 * unhealthy.
 */
export const ANTHROPIC_SENSOR_PRESETS = {
  opus47: (client: AnthropicMessagesClient): Sensor =>
    createAnthropicSensor(client, {
      id: 'anthropic-opus-4-7',
      modelId: getModelLatest('opus'),
      priority: 1,
      capabilities: ['thinking', 'fast', 'vision'],
      maxTokens: 1024,
      extendedThinkingBudget: 4096,
    }),
  sonnet46: (client: AnthropicMessagesClient): Sensor =>
    createAnthropicSensor(client, {
      id: 'anthropic-sonnet-4-6',
      modelId: getModelLatest('sonnet'),
      priority: 2,
      capabilities: ['fast', 'thinking', 'vision'],
      maxTokens: 1024,
    }),
  haiku45: (client: AnthropicMessagesClient): Sensor =>
    createAnthropicSensor(client, {
      id: 'anthropic-haiku-4-5',
      modelId: getModelLatest('haiku'),
      priority: 3,
      capabilities: ['fast', 'batch', 'vision'],
      maxTokens: 1024,
    }),
} as const;
