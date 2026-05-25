/**
 * Hono middleware: enforce `If-Match` on mutating endpoints.
 *
 * Usage:
 *   app.put("/leases/:id", requireIfMatch({
 *     getCurrentResource: async (c) => leaseRepo.find(c.req.param("id")),
 *   }), handler)
 *
 * Behaviour:
 *   - Missing `If-Match` header → 428 (precondition required)
 *   - ETag mismatch → 412 (precondition failed)
 *   - On match: sets `c.set("etagMatched", true)` so the handler can
 *     skip its own re-check
 *
 * This package does not depend on Hono — middleware is duck-typed
 * against the minimum context surface so it works for hono, fastify
 * wrappers, custom shims, etc.
 */

import { etag, etagMatches } from "./etag.js";

interface HonoLike {
  req: {
    header(name: string): string | undefined;
  };
  set(key: string, value: unknown): void;
  json(body: unknown, status: number): unknown;
}

export interface RequireIfMatchOptions<C extends HonoLike> {
  readonly getCurrentResource: (c: C) => Promise<unknown | null>;
}

export function requireIfMatch<C extends HonoLike>(
  opts: RequireIfMatchOptions<C>
) {
  return async function middleware(c: C, next: () => Promise<void>) {
    const ifMatch = c.req.header("if-match") ?? c.req.header("If-Match");
    if (!ifMatch) {
      return c.json(
        {
          error: "Precondition Required",
          message: "If-Match header is required for mutations",
          code: "PRECONDITION_REQUIRED",
        },
        428
      );
    }
    const current = await opts.getCurrentResource(c);
    if (current === null) {
      return c.json(
        {
          error: "Not Found",
          message: "Resource no longer exists",
          code: "NOT_FOUND",
        },
        404
      );
    }
    const currentETag = etag(current);
    if (!etagMatches(ifMatch, currentETag)) {
      return c.json(
        {
          error: "Precondition Failed",
          message: "If-Match does not match current resource ETag",
          code: "PRECONDITION_FAILED",
          expected: ifMatch,
          actual: currentETag,
        },
        412
      );
    }
    c.set("etagMatched", true);
    await next();
  };
}
