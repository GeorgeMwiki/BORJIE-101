/**
 * `streamSSE` — converts an async iterable of records into a
 * Server-Sent-Events ReadableStream that browsers can consume via
 * `EventSource` or `fetch().body`.
 *
 * Format per https://html.spec.whatwg.org/multipage/server-sent-events.html:
 *
 *   event: <name>\n
 *   id: <id>\n
 *   data: <payload>\n
 *   \n
 *
 * Keep-alive: SSE streams idle over a proxy (nginx default 60s,
 * Cloudflare ~100s) get killed unless we send something. We inject a
 * `:ping` comment line every `keepAliveMs` to keep the socket open.
 */

import type { StreamingResponseSpec } from '../types.js';

const ENCODER = new TextEncoder();

/**
 * Build a ReadableStream that emits SSE frames mapped from `source`.
 * Aborts cleanly when the consumer drops the connection.
 */
export function streamSSE<T>(spec: StreamingResponseSpec<T>): ReadableStream<Uint8Array> {
  const eventName = spec.eventName ?? 'message';
  const keepAliveMs = spec.keepAliveMs ?? 30_000;

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      if (keepAliveMs > 0) {
        keepAlive = setInterval(() => {
          if (!cancelled) {
            try {
              controller.enqueue(ENCODER.encode(':ping\n\n'));
            } catch {
              // controller may already be closed during a shutdown race
            }
          }
        }, keepAliveMs);
      }

      let index = 0;
      try {
        for await (const record of spec.source) {
          if (cancelled) break;
          const payload = spec.mapper(record, index);
          index++;
          if (payload === null) continue;
          const frame = formatSSEFrame(eventName, payload, String(index));
          controller.enqueue(ENCODER.encode(frame));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const errFrame = formatSSEFrame(
          'error',
          JSON.stringify({ error: message }),
          String(index),
        );
        try {
          controller.enqueue(ENCODER.encode(errFrame));
        } catch {
          // already cancelled
        }
      } finally {
        if (keepAlive !== null) clearInterval(keepAlive);
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      cancelled = true;
      if (keepAlive !== null) clearInterval(keepAlive);
    },
  });
}

/** Public helper — format a single SSE frame string. */
export function formatSSEFrame(event: string, data: string, id?: string): string {
  const dataLines = data.split('\n').map((l) => `data: ${l}`).join('\n');
  const idLine = id !== undefined ? `id: ${id}\n` : '';
  return `event: ${event}\n${idLine}${dataLines}\n\n`;
}

/**
 * Standard SSE response headers — `Cache-Control: no-store` is
 * critical otherwise an upstream CDN may cache the first chunk.
 */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
