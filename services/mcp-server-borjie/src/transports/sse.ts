/**
 * SSE (Server-Sent Events) transport for the public MCP server.
 *
 * Surface:
 *   - GET /mcp/sse          — long-lived SSE stream. Initial connect emits
 *                              a `session` event containing the session id
 *                              the client should pass back via a sidecar
 *                              POST channel (or via query string on the SSE
 *                              connect URL: ?session=<id>) for subsequent
 *                              requests.
 *
 * The SSE transport is request/response symmetric. A POST /mcp request
 * carrying a session id triggers a server-side push of the matching
 * response (and any `$/progress`, `notifications/*`, `logging/message`,
 * `$/result_partial` notifications) onto the SSE channel for that session.
 *
 * We do not depend on Hono / Express here so the package stays tiny —
 * the api-gateway sse.hono.ts adapter wires `createSseHandler` into the
 * gateway's chunked-response primitives.
 *
 * Compliance with MCP spec: SSE is one of three transport options
 * listed in the 2024-11-05 spec. We mirror the Claude / Cursor / Windsurf
 * implementations so any client that already speaks MCP-over-SSE Just
 * Works.
 */

import { createDispatcher, type DispatcherDeps } from '../dispatcher.js';
import {
  buildError,
  parseJsonRpcLine,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
  type JsonRpcResponse,
} from '../jsonrpc.js';

/** Raw bytes a transport writes to push an SSE event. */
export interface SseEvent {
  readonly event?: string;
  readonly id?: string;
  readonly retryMs?: number;
  readonly data: string;
}

/** Outbound SSE channel bound to a single client connection. */
export interface SseChannel {
  readonly sessionId: string;
  send(event: SseEvent): void;
  close(): void;
}

/** Session bookkeeping the SSE adapter needs to route POST -> SSE. */
export interface SseSessionRegistry {
  register(channel: SseChannel): void;
  get(sessionId: string): SseChannel | undefined;
  unregister(sessionId: string): void;
}

/** In-memory registry used by the default api-gateway adapter. */
export function createInMemorySseRegistry(): SseSessionRegistry {
  const channels = new Map<string, SseChannel>();
  const registry: SseSessionRegistry = {
    register(channel: SseChannel): void {
      channels.set(channel.sessionId, channel);
    },
    get(sessionId: string): SseChannel | undefined {
      return channels.get(sessionId);
    },
    unregister(sessionId: string): void {
      channels.delete(sessionId);
    },
  };
  return Object.freeze(registry);
}

export interface SseHandlerDeps extends DispatcherDeps {
  readonly registry: SseSessionRegistry;
  readonly newSessionId?: () => string;
}

export interface SseConnectInput {
  readonly bearerToken: string | null;
  readonly resumeSessionId?: string;
}

export interface SsePostInput {
  readonly sessionId: string;
  readonly bearerToken: string | null;
  readonly body: string;
  readonly idempotencyKey?: string;
}

/** Format a single SSE event per the spec. */
export function formatSseEvent(event: SseEvent): string {
  const lines: string[] = [];
  if (event.event) lines.push(`event: ${event.event}`);
  if (event.id) lines.push(`id: ${event.id}`);
  if (event.retryMs !== undefined) lines.push(`retry: ${event.retryMs}`);
  for (const dataLine of event.data.split('\n')) {
    lines.push(`data: ${dataLine}`);
  }
  return `${lines.join('\n')}\n\n`;
}

/**
 * Build the pure SSE handler. The api-gateway adapter wires the channel
 * (a WritableStream wrapping `c.res.body`) and the registry; this layer
 * stays transport-agnostic for unit tests.
 */
export function createSseHandler(deps: SseHandlerDeps) {
  const dispatcher = createDispatcher(deps);
  const newSessionId =
    deps.newSessionId ??
    (() => `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

  function onConnect(input: SseConnectInput, channel: Omit<SseChannel, 'sessionId'>): SseChannel {
    const sessionId = input.resumeSessionId ?? newSessionId();
    const bound: SseChannel = Object.freeze({
      sessionId,
      send(event: SseEvent): void {
        channel.send(event);
      },
      close(): void {
        channel.close();
        deps.registry.unregister(sessionId);
      },
    });
    deps.registry.register(bound);
    bound.send({
      event: 'session',
      data: JSON.stringify({ sessionId, protocolVersion: '2024-11-05' }),
    });
    return bound;
  }

  async function onPost(input: SsePostInput): Promise<JsonRpcResponse> {
    const channel = deps.registry.get(input.sessionId);
    const parsed = parseJsonRpcLine(input.body);
    if (!parsed) {
      const err = buildError(null, JSON_RPC_PARSE_ERROR, 'invalid JSON-RPC');
      pushIfAvailable(channel, err);
      return err;
    }
    if (typeof parsed.method !== 'string') {
      const err = buildError(parsed.id, JSON_RPC_INVALID_REQUEST, 'missing method');
      pushIfAvailable(channel, err);
      return err;
    }
    const response = await dispatcher.dispatch({
      request: parsed,
      bearerToken: input.bearerToken,
      ...(input.idempotencyKey !== undefined
        ? { idempotencyKey: input.idempotencyKey }
        : {}),
    });
    pushIfAvailable(channel, response);
    return response;
  }

  return Object.freeze({ onConnect, onPost });
}

function pushIfAvailable(
  channel: SseChannel | undefined,
  response: JsonRpcResponse,
): void {
  if (!channel) return;
  channel.send({
    event: 'message',
    data: JSON.stringify(response),
  });
}
