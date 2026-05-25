/**
 * `createSSEEndpoint` — builds a Hono/Fastify handler that returns a
 * streaming SSE response. Structurally typed so we never `import 'hono'`
 * — keeps the package framework-agnostic.
 */

import type { StreamingResponseSpec } from '../types.js';
import { streamSSE, SSE_HEADERS } from './stream-sse.js';

export interface HonoLikeResponseInit {
  status?: number;
  headers?: HeadersInit;
}
export interface HonoLikeCtx {
  body(stream: ReadableStream<Uint8Array>, init?: HonoLikeResponseInit): Response;
}
export type HonoLikeHandler<T> = (
  ctx: HonoLikeCtx,
) => Response | Promise<Response> | Promise<StreamingResponseSpec<T>>;

/**
 * Hono variant. The caller's `handler(ctx)` returns the spec, we wrap
 * it into a `ReadableStream` and send it back via `c.body()`.
 *
 *   app.get('/api/v1/brain/stream', createSSEEndpoint.hono((ctx) => ({
 *     source: brainStream,
 *     mapper: (chunk) => JSON.stringify(chunk),
 *   })));
 */
export const createSSEEndpoint = {
  hono<T>(
    handler: (ctx: HonoLikeCtx) => StreamingResponseSpec<T> | Promise<StreamingResponseSpec<T>>,
  ) {
    return async (ctx: HonoLikeCtx): Promise<Response> => {
      const spec = await handler(ctx);
      const stream = streamSSE(spec);
      return ctx.body(stream, { headers: SSE_HEADERS });
    };
  },

  /**
   * Fastify variant. Fastify wraps a node ServerResponse; we use the
   * standard `reply.raw` socket so we can write the SSE frames directly.
   */
  fastify<T>(
    handler: (req: unknown) => StreamingResponseSpec<T> | Promise<StreamingResponseSpec<T>>,
  ) {
    return async (
      req: unknown,
      reply: {
        raw: {
          writeHead(status: number, headers: Record<string, string>): void;
          write(chunk: Uint8Array | string): void;
          end(): void;
          on(event: 'close', cb: () => void): void;
        };
        hijack?: () => void;
      },
    ): Promise<void> => {
      reply.hijack?.();
      reply.raw.writeHead(200, SSE_HEADERS);
      const spec = await handler(req);
      const stream = streamSSE(spec);
      const reader = stream.getReader();
      let closed = false;
      reply.raw.on('close', () => {
        closed = true;
      });
      while (!closed) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) reply.raw.write(value);
      }
      reply.raw.end();
    };
  },
};
