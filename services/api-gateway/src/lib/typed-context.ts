/**
 * Typed Hono context helpers — scrub-5a (2026-05-27).
 *
 * Background
 * ──────────
 * Hono v4 `c.json(body, status)` widens `status` to the full
 * `ContentfulStatusCode` union when called from a handler that returns
 * `c.json` from multiple branches with different literal status codes
 * (e.g., one branch returns 200, another 404, another 500). The
 * compiler then rejects the union against any single overload of
 * `c.json`. Tracked at hono-dev/hono#3891 — fixed on Hono `main`,
 * slated for 4.13. See `Docs/TYPE_DEBT.md` Cluster 1.
 *
 * Until the upgrade lands, this module exports two tiny wrappers that
 * pin the status type at the call-site so the union-widening never
 * reaches the overload resolver:
 *
 *   - `ok(c, body)`              — 200, application/json
 *   - `ok(c, body, status)`      — explicit `ContentfulStatusCode` (e.g. 201)
 *   - `err(c, status, code, msg)` — re-exports `errorResponse` for ergonomics
 *
 * Behaviour
 * ─────────
 * Both helpers are pure pass-throughs to `c.json` / `errorResponse`. They
 * do **NOT** change the response shape — every existing route may swap
 * `c.json(body, 200)` for `ok(c, body)` and the wire output is byte-for-byte
 * identical. They exist solely to satisfy `tsc` so we can retire the
 * `@ts-nocheck` head comments per `Docs/TYPE_DEBT.md` Cluster 1.
 *
 * Import sibling `hono-augment.ts` once (via `src/index.ts` or any of the
 * route barrels) to extend `ContextVariableMap` with the gateway-wide
 * `c.set/c.get` keys — that augmentation is what lets routes drop the
 * `c.get('tenantId') as string` casts in favour of `c.get('tenantId')`.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { errorResponse } from '../utils/error-response.js';

/**
 * Convenience alias for the per-route `Context` so route files can
 * write `AppContext` rather than `Context<{ Variables: ... }>` every
 * time. Keep the generic open so router files that already pin a
 * narrower `{ Variables, Bindings }` shape on `new Hono<...>()` are
 * not forced to widen.
 */
export type AppContext = Context;

/**
 * `c.json` wrapper that pins the status-code type at call-site so the
 * Hono v4 status-literal-union widening (issue #3891) never reaches the
 * overload resolver.
 *
 * Default status is 200 — supply an explicit `ContentfulStatusCode`
 * for 201/202/etc. responses. Body shape is **not** opinionated: the
 * caller chooses the envelope (canonical ApiResponse, ad-hoc record,
 * etc.) so this wrapper is safe to drop into any existing route
 * without changing the wire response.
 */
export function ok<T>(
  c: Context,
  body: T,
  status: ContentfulStatusCode = 200,
): Response {
  return c.json(body as Record<string, unknown>, status);
}

/**
 * Re-export of `errorResponse` under the `err` name — kept here so
 * routes can `import { ok, err } from '../lib/typed-context'` rather
 * than reaching across `lib/` and `utils/`. Behaviour is identical:
 * canonical `ApiErrorResponse` shape, `details` auto-redaction, and
 * a `requestId` + `timestamp` meta block. See `error-response.ts`
 * for the full contract + redaction rules.
 */
export function err(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return errorResponse(c, status, code, message, details);
}
