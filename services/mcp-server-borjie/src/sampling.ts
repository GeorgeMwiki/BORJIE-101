/**
 * MCP `sampling/createMessage` — server asks the client for an LLM
 * completion using the client's own LLM keys.
 *
 * Borjie use case: an external agent connects with Mr. Mwikila and asks
 * him to "summarise this attached document." Mr. Mwikila has the doc
 * but doesn't ship with its own provider keys for arbitrary external
 * agents; instead he flips the call around and asks the client LLM
 * (the agent's local Claude / GPT / Gemini) to do the summarisation.
 *
 * Per MCP 2024-11-05:
 *   - Request: `sampling/createMessage` with `messages`, `modelPreferences`,
 *     `systemPrompt`, `temperature`, `maxTokens`, `stopSequences`,
 *     `metadata`, `includeContext`.
 *   - Response: a single message with `role`, `content`, `model`,
 *     `stopReason`.
 *
 * The dispatcher routes incoming `sampling/createMessage` to a
 * `SamplingResponder` (the client-side LLM); test responders are pure.
 */

import { z } from 'zod';

const messageRoleSchema = z.enum(['system', 'user', 'assistant']);

const textContentSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const imageContentSchema = z.object({
  type: z.literal('image'),
  data: z.string(),
  mimeType: z.string(),
});

const messageContentSchema = z.union([textContentSchema, imageContentSchema]);

const sampleMessageSchema = z.object({
  role: messageRoleSchema,
  content: messageContentSchema,
});

export const samplingCreateMessageRequestSchema = z.object({
  messages: z.array(sampleMessageSchema).min(1),
  modelPreferences: z
    .object({
      hints: z.array(z.object({ name: z.string() })).optional(),
      costPriority: z.number().min(0).max(1).optional(),
      speedPriority: z.number().min(0).max(1).optional(),
      intelligencePriority: z.number().min(0).max(1).optional(),
    })
    .optional(),
  systemPrompt: z.string().optional(),
  includeContext: z.enum(['none', 'thisServer', 'allServers']).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(8192).optional(),
  stopSequences: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type SamplingCreateMessageRequest = z.infer<
  typeof samplingCreateMessageRequestSchema
>;

export interface SamplingCreateMessageResponse {
  readonly role: 'assistant';
  readonly content:
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'image'; readonly data: string; readonly mimeType: string };
  readonly model: string;
  readonly stopReason?: 'endTurn' | 'maxTokens' | 'stopSequence' | string;
}

export interface SamplingResponder {
  createMessage(
    request: SamplingCreateMessageRequest,
  ): Promise<SamplingCreateMessageResponse>;
}

/**
 * Echo responder used in tests — returns the last user message wrapped
 * in an assistant reply. Real deployments use the api-gateway adapter,
 * which proxies to the client-side LLM over the live MCP channel.
 */
export function createEchoSamplingResponder(): SamplingResponder {
  const responder: SamplingResponder = {
    async createMessage(
      request: SamplingCreateMessageRequest,
    ): Promise<SamplingCreateMessageResponse> {
      const last = request.messages[request.messages.length - 1];
      if (!last) {
        return Object.freeze({
          role: 'assistant' as const,
          content: Object.freeze({ type: 'text' as const, text: '' }),
          model: 'borjie-echo-1',
          stopReason: 'endTurn' as const,
        });
      }
      const text =
        last.content.type === 'text'
          ? `echo: ${last.content.text}`
          : '[non-text echo]';
      return Object.freeze({
        role: 'assistant' as const,
        content: Object.freeze({ type: 'text' as const, text }),
        model: 'borjie-echo-1',
        stopReason: 'endTurn' as const,
      });
    },
  };
  return Object.freeze(responder);
}

/**
 * No-op responder for read-only deployments — rejects every sampling
 * request with a structured error the dispatcher converts to JSON-RPC.
 */
export class SamplingUnsupportedError extends Error {
  constructor() {
    super(
      'sampling/createMessage requires a client LLM responder; none was configured for this server instance.',
    );
    this.name = 'SamplingUnsupportedError';
  }
}

export function createUnsupportedSamplingResponder(): SamplingResponder {
  const responder: SamplingResponder = {
    async createMessage(
      _request: SamplingCreateMessageRequest,
    ): Promise<SamplingCreateMessageResponse> {
      throw new SamplingUnsupportedError();
    },
  };
  return Object.freeze(responder);
}
