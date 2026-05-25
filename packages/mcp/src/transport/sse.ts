/**
 * SSE transport (legacy, kept for backwards-compat with servers that haven't
 * migrated to streamable-http). Per the 2025-09-01 revision, new servers
 * should prefer `createStreamableHTTPTransport`.
 *
 * The SSE transport uses two HTTP endpoints:
 *  - `GET <url>` opens an event-stream from server → client.
 *  - The first event must be `endpoint: { uri: "/messages?session=..." }`
 *    telling the client where to POST outbound requests.
 *
 * We accept a `fetchImpl` injection so tests can drive the transport with a
 * mock fetch.
 */

import {
  type MCPMessage,
  type TransportPort,
  MCPClosedError,
} from '../types.js';

export interface SSETransportOptions {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Override fetch (test injection). */
  readonly fetchImpl?: typeof fetch;
  /**
   * Override the endpoint discovery — if set, skip waiting for the
   * `event: endpoint` frame and use this URL directly for outbound POSTs.
   */
  readonly postUrl?: string;
  /** Max queued outbound messages. Default 1000. */
  readonly maxSendQueue?: number;
  /** Auto-reconnect with jitter on stream close. Default true. */
  readonly autoReconnect?: boolean;
  /** Max reconnect attempts (default 5). 0 disables. */
  readonly maxReconnect?: number;
}

interface SSEEvent {
  readonly event: string;
  readonly data: string;
}

function parseEventStream(
  chunk: string,
  buffer: { value: string },
  onEvent: (e: SSEEvent) => void,
): void {
  buffer.value += chunk;
  let idx: number;
  while ((idx = buffer.value.indexOf('\n\n')) >= 0) {
    const rawEvent = buffer.value.slice(0, idx);
    buffer.value = buffer.value.slice(idx + 2);
    let event = 'message';
    const dataLines: Array<string> = [];
    for (const line of rawEvent.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length > 0) {
      onEvent({ event, data: dataLines.join('\n') });
    }
  }
}

export function createSSETransport(opts: SSETransportOptions): TransportPort {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const messageHandlers = new Set<(m: MCPMessage) => void>();
  const errorHandlers = new Set<(e: Error) => void>();
  const closeHandlers = new Set<() => void>();
  const maxSendQueue = opts.maxSendQueue ?? 1000;
  const headers = { ...(opts.headers ?? {}) };

  let open = true;
  let postUrl: string | null = opts.postUrl ?? null;
  let sendQueueDepth = 0;
  let abortController: AbortController | null = null;
  let reconnectAttempt = 0;
  const maxReconnect = opts.maxReconnect ?? 5;
  const autoReconnect = opts.autoReconnect ?? true;

  function fireError(e: Error): void {
    for (const h of errorHandlers) h(e);
  }

  function fireClose(): void {
    if (!open) return;
    open = false;
    for (const h of closeHandlers) h();
  }

  async function openStream(): Promise<void> {
    abortController = new AbortController();
    try {
      const resp = await fetchImpl(opts.url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...headers },
        signal: abortController.signal,
      });
      if (!resp.ok || !resp.body) {
        throw new Error(
          `SSE transport: GET ${opts.url} returned ${resp.status}`,
        );
      }
      reconnectAttempt = 0;
      const reader = resp.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      const buffer = { value: '' };
      const onEvent = (e: SSEEvent): void => {
        if (e.event === 'endpoint') {
          // Server-issued POST URL discovery
          try {
            const parsed = JSON.parse(e.data) as { uri?: string };
            if (parsed.uri) postUrl = new URL(parsed.uri, opts.url).toString();
          } catch {
            // Some servers emit a plain string (not JSON) — try that too.
            postUrl = new URL(e.data, opts.url).toString();
          }
          return;
        }
        if (e.event === 'message') {
          try {
            const parsed = JSON.parse(e.data) as MCPMessage;
            for (const h of messageHandlers) h(parsed);
          } catch (err) {
            fireError(new Error(`SSE: failed to parse frame: ${String(err)}`));
          }
        }
      };
      // Drain in the background. Stream-end is NOT a close — the server is
      // simply done pushing notifications for now. The transport stays open
      // for outbound POSTs until `close()` is called explicitly OR a network
      // error fires.
      void (async () => {
        let streamErrored = false;
        try {
          while (open) {
            const { done, value } = await reader.read();
            if (done) break;
            parseEventStream(value, buffer, onEvent);
          }
        } catch (e) {
          streamErrored = true;
          fireError(e as Error);
        }
        if (
          streamErrored &&
          autoReconnect &&
          open &&
          reconnectAttempt < maxReconnect
        ) {
          reconnectAttempt++;
          const backoff = Math.min(
            30_000,
            500 * 2 ** reconnectAttempt + Math.random() * 250,
          );
          setTimeout(() => {
            if (open) void openStream();
          }, backoff);
        } else if (streamErrored) {
          // Out of retries — close transport.
          fireClose();
        }
        // Clean stream-end: stay open for outbound POSTs.
      })();
    } catch (e) {
      fireError(e as Error);
      fireClose();
    }
  }

  // Kick off the initial connection
  void openStream();

  return {
    get isOpen() {
      return open;
    },
    async send(message: MCPMessage): Promise<void> {
      if (!open) throw new MCPClosedError();
      if (!postUrl) {
        throw new MCPClosedError('SSE: POST endpoint not yet discovered');
      }
      if (sendQueueDepth >= maxSendQueue) {
        throw new Error(
          `SSE: send queue depth ${sendQueueDepth} >= max ${maxSendQueue}`,
        );
      }
      sendQueueDepth++;
      try {
        const resp = await fetchImpl(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(message),
        });
        if (!resp.ok) {
          throw new Error(`SSE POST returned ${resp.status}`);
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
      abortController?.abort();
      fireClose();
    },
  };
}
