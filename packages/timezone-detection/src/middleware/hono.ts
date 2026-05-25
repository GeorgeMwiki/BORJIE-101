/**
 * Hono middleware variant — wraps `extractTimezone` and binds the
 * resolved TZ as `c.set('tz', ...)` so downstream handlers can
 * `c.get('tz')`.
 *
 * Usage:
 *   app.use('*', hooks.honoTimezoneMiddleware({ geoip: myAdapter }));
 *   app.get('/', (c) => c.text(`Your TZ: ${c.get('tz')}`));
 *
 * Strongly typed for Hono's `Context` shape — but we do not import hono
 * at the type level (to avoid coupling). We declare just enough surface
 * to satisfy the compiler.
 */

import type {
  ExtractRequest,
  ExtractTimezoneOptions,
} from './extract-timezone.js';
import { extractTimezone } from './extract-timezone.js';

/**
 * Minimum Hono Context surface this middleware uses. Compatible with
 * `hono` v4+ via structural typing. Exported so downstream callers can
 * tighten the binding.
 */
export interface HonoLikeContext {
  req: {
    header(name: string): string | undefined;
    raw?: { headers?: Headers };
  };
  set(key: 'tz', value: string): void;
  env?: { incoming?: { socket?: { remoteAddress?: string | null } } };
}

export type HonoLikeNext = () => Promise<void>;

/**
 * Build a Hono middleware. Resolves the request TZ then calls `next()`.
 * Never throws — falls back to UTC.
 */
export function honoTimezoneMiddleware(opts: ExtractTimezoneOptions = {}) {
  return async function timezoneMiddleware(
    c: HonoLikeContext,
    next: HonoLikeNext,
  ): Promise<void> {
    try {
      const adapter: ExtractRequest = {
        header(name) {
          return c.req.header(name) ?? null;
        },
        ip:
          c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ??
          c.env?.incoming?.socket?.remoteAddress ??
          null,
      };
      const tz = await extractTimezone(adapter, opts);
      c.set('tz', tz);
    } catch {
      c.set('tz', 'UTC');
    }
    await next();
  };
}
