/**
 * Fastify variant — exposes a `preHandler` plugin that attaches `req.tz`
 * to the request object.
 *
 * Usage:
 *   fastify.addHook('preHandler', fastifyTimezonePlugin({ geoip: myAdapter }));
 *   fastify.get('/', (req) => `Your TZ: ${(req as any).tz}`);
 */

import type {
  ExtractRequest,
  ExtractTimezoneOptions,
} from './extract-timezone.js';
import { extractTimezone } from './extract-timezone.js';

/**
 * Minimum Fastify request surface — compatible with `fastify` v4+.
 * Exported so downstream callers can tighten the binding.
 */
export interface FastifyLikeRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  // We mutate to attach the resolved TZ.
  tz?: string;
}

export type FastifyLikeReply = unknown;

/**
 * Build a Fastify preHandler that resolves and attaches `req.tz`.
 * Never throws — falls back to UTC.
 */
export function fastifyTimezonePlugin(opts: ExtractTimezoneOptions = {}) {
  return async function timezonePreHandler(
    req: FastifyLikeRequest,
    _reply: FastifyLikeReply,
  ): Promise<void> {
    const adapter: ExtractRequest = {
      header(name) {
        const v = req.headers[name.toLowerCase()];
        if (Array.isArray(v)) return v[0] ?? null;
        return v ?? null;
      },
      ip: req.ip ?? null,
    };
    try {
      req.tz = await extractTimezone(adapter, opts);
    } catch {
      req.tz = 'UTC';
    }
  };
}
