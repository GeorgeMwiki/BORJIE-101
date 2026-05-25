/**
 * Streamable HTTP transport — the 2025-09-01 replacement for SSE.
 *
 * Single bidirectional endpoint. Client POSTs a JSON-RPC frame; the server
 * responds with either:
 *  - `application/json` — a single JSON-RPC response (request/response)
 *  - `text/event-stream` — an SSE stream when the server has multiple
 *    notifications or progress events to push before the final response.
 *
 * Session identity is carried via `Mcp-Session-Id` header issued by the
 * server during `initialize`.
 */

import {
  type MCPMessage,
  type TransportPort,
  MCPClosedError,
  isNotification,
  isResponse,
  isErrorResponse,
} from '../types.js';

export interface StreamableHTTPTransportOptions {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchImpl?: typeof fetch;
  readonly maxSendQueue?: number;
  /** Initial session id, if known. Most servers issue this on first call. */
  readonly sessionId?: string;
  /** Called when the server issues/changes the session id. */
  readonly onSessionChange?: (sessionId: string) => void;
}

export function createStreamableHTTPTransport(
  opts: StreamableHTTPTransportOptions,
): TransportPort {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const messageHandlers = new Set<(m: MCPMessage) => void>();
  const errorHandlers = new Set<(e: Error) => void>();
  const closeHandlers = new Set<() => void>();
  const maxSendQueue = opts.maxSendQueue ?? 1000;

  let open = true;
  let sendQueueDepth = 0;
  let sessionId: string | undefined = opts.sessionId;

  function fireError(e: Error): void {
    for (const h of errorHandlers) h(e);
  }

  function fireClose(): void {
    if (!open) return;
    open = false;
    for (const h of closeHandlers) h();
  }

  function dispatchInbound(msg: MCPMessage): void {
    for (const h of messageHandlers) h(msg);
  }

  async function consumeSSEResponse(resp: Response): Promise<void> {
    if (!resp.body) return;
    const reader = resp.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
    let buffer = '';
    while (open) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLines: Array<string> = [];
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) continue;
        try {
          const parsed = JSON.parse(dataLines.join('\n')) as MCPMessage;
          dispatchInbound(parsed);
        } catch (e) {
          fireError(new Error(`streamable-http: parse error: ${String(e)}`));
        }
      }
    }
  }

  return {
    get isOpen() {
      return open;
    },
    async send(message: MCPMessage): Promise<void> {
      if (!open) throw new MCPClosedError();
      if (sendQueueDepth >= maxSendQueue) {
        throw new Error(
          `streamable-http: send queue depth ${sendQueueDepth} >= max ${maxSendQueue}`,
        );
      }
      // Notifications fire-and-forget: no response expected.
      // Requests get either a JSON response (single body) or an SSE stream.
      sendQueueDepth++;
      try {
        const requestHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(opts.headers ?? {}),
        };
        if (sessionId) requestHeaders['Mcp-Session-Id'] = sessionId;
        const resp = await fetchImpl(opts.url, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(message),
        });
        // Server may issue / rotate the session id at any time
        const newSession = resp.headers.get('Mcp-Session-Id');
        if (newSession && newSession !== sessionId) {
          sessionId = newSession;
          opts.onSessionChange?.(newSession);
        }
        if (!resp.ok) {
          throw new Error(`streamable-http POST returned ${resp.status}`);
        }
        // Notifications get 202 / 204 with no body; just return.
        if (isNotification(message)) return;
        const ct = resp.headers.get('Content-Type') ?? '';
        if (ct.includes('text/event-stream')) {
          await consumeSSEResponse(resp);
          return;
        }
        // JSON body — single response
        const text = await resp.text();
        if (!text) return;
        const parsed = JSON.parse(text) as MCPMessage | Array<MCPMessage>;
        const frames = Array.isArray(parsed) ? parsed : [parsed];
        for (const frame of frames) {
          if (isResponse(frame) || isErrorResponse(frame) || isNotification(frame)) {
            dispatchInbound(frame);
          } else {
            dispatchInbound(frame);
          }
        }
      } finally {
        sendQueueDepth--;
      }
    },
    onMessage(handler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },
    onError(handler) {
      errorHandlers.add(handler);
      return () => errorHandlers.delete(handler);
    },
    onClose(handler) {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    async close(): Promise<void> {
      if (!open) return;
      // Best-effort delete of the session on the server.
      if (sessionId) {
        try {
          await fetchImpl(opts.url, {
            method: 'DELETE',
            headers: {
              'Mcp-Session-Id': sessionId,
              ...(opts.headers ?? {}),
            },
          });
        } catch {
          // ignore — the server will GC stale sessions
        }
      }
      fireClose();
    },
  };
}
