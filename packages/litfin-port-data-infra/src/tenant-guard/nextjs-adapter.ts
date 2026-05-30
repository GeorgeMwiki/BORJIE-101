/**
 * Next.js adapter for tenant context.
 *
 * Two integration points:
 *
 *   1. `withTenantContext(handler)` — wraps a Next.js route handler
 *      (App Router) so the handler body runs inside a
 *      `runInTenantContext(...)` scope. The caller supplies a
 *      `resolveContext(req)` function that returns the
 *      TenantContext from whatever auth source Borjie uses
 *      (Supabase JWT, NextAuth session, headers from upstream gateway).
 *      A `resolveContext` that returns null causes the handler to
 *      respond 401 with a stable JSON error shape.
 *
 *   2. `bindTenantContextOnRequest(req, resolveContext)` — for
 *      middleware-style usage where the caller wants to bind
 *      context manually but uses the same shape. Returns the bound
 *      context or null on failure.
 *
 * Why not Edge runtime? AsyncLocalStorage requires Node runtime. The
 * caller's route MUST declare `runtime = "nodejs"` if they want the
 * scope to persist across awaits.
 *
 * Ported verbatim from @litfin/tenant-guard.
 */

import { runInTenantContext } from "./context";
import { IsolationViolation, type TenantContext } from "./types";

export type RequestLike = Request & { readonly [k: string]: unknown };

export type ResolveContext = (
  req: RequestLike,
) => Promise<TenantContext | null> | TenantContext | null;

export interface WithTenantContextOptions {
  readonly resolveContext: ResolveContext;
  /** Custom 401 body. Defaults to a stable JSON error. */
  readonly onUnauthorized?: (req: RequestLike) => Response | Promise<Response>;
}

const DEFAULT_UNAUTHORIZED_BODY = JSON.stringify({
  error: "Unauthorized",
  code: "TENANT_CONTEXT_REQUIRED",
});

export function withTenantContext<TArgs extends unknown[], TResult>(
  handler: (req: RequestLike, ...args: TArgs) => Promise<TResult> | TResult,
  opts: WithTenantContextOptions,
): (req: RequestLike, ...args: TArgs) => Promise<Response | TResult> {
  return async (req, ...args) => {
    let ctx: TenantContext | null;
    try {
      ctx = await opts.resolveContext(req);
    } catch (err) {
      if (err instanceof IsolationViolation) {
        return new Response(DEFAULT_UNAUTHORIZED_BODY, {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      throw err;
    }
    if (!ctx) {
      if (opts.onUnauthorized) return opts.onUnauthorized(req);
      return new Response(DEFAULT_UNAUTHORIZED_BODY, {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return runInTenantContext(ctx, () => handler(req, ...args));
  };
}

export async function bindTenantContextOnRequest(
  req: RequestLike,
  resolveContext: ResolveContext,
): Promise<TenantContext | null> {
  try {
    return await resolveContext(req);
  } catch {
    return null;
  }
}
