/**
 * OpenAPI schema registry — the process-wide collection point where
 * routers declare Zod schemas for their endpoints so the gateway can
 * emit a real OpenAPI 3.1 document at `/openapi.json`.
 *
 * ## Why a registry (rather than refactoring every router)
 *
 * The existing 40+ routers are built on Hono + `@hono/zod-validator`.
 * Rewriting them to `createRoute`/`OpenAPIHono` would touch every file
 * and risk behavioural drift. Instead, routers keep their current
 * wiring AND declare their schemas here. The harvester walks each
 * mounted router's `.routes` array (Hono exposes it) and cross-
 * references this registry to build path items with request/response
 * bodies, params, and auth requirements.
 *
 * ## Usage pattern
 *
 * A router file calls `registerRoute({ method, path, ... })` for every
 * endpoint it owns. The path here is the path AS SEEN BY THE ROUTER
 * (relative, no API-version prefix). Mount prefixes are composed at
 * harvest time so a single router can be mounted under multiple paths
 * without duplicating metadata.
 *
 * Registrations are idempotent by `${method} ${path}` key. A later
 * registration overrides an earlier one — this lets tests seed
 * overrides without restarting the process.
 *
 * ## Failure modes
 *
 * - A route with no registration emits a minimal path item (method,
 *   path, default 401 + 500) so the spec still surfaces it.
 * - A registration for a route Hono does not actually serve is logged
 *   as a warning at harvest time and skipped.
 * - Schema serialization errors are caught per-route; the registry
 *   itself never throws during harvest.
 */

import type { ZodTypeAny } from 'zod';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface OpenApiRouteMeta {
  /** HTTP method, lowercased. */
  method: HttpMethod;
  /** Path relative to the router mount point. Must start with `/`. */
  path: string;
  /**
   * Mount prefix (e.g. `/waitlist`, `/applications`). Required — used
   * to disambiguate metadata when multiple routers share a relative
   * path (both `/` and `/:id` are extremely common).
   */
  prefix: string;
  /** Short one-liner — becomes the `summary` field. */
  summary?: string;
  /** Long-form description (markdown supported by tooling). */
  description?: string;
  /** OpenAPI tags — used to group endpoints in Swagger UI. */
  tags?: string[];
  /** Auth requirement. `bearer` → `security: [{ bearerAuth: [] }]`. */
  auth?: 'bearer' | 'none';
  /** Required permissions — surfaced in description. */
  permissions?: string[];
  /** Rate limit bucket name — surfaced in description. */
  rateLimit?: string;
  /** Zod schema for the request body (JSON). */
  requestBody?: ZodTypeAny;
  /** Zod schema for path parameters (object shape). */
  requestParams?: ZodTypeAny;
  /** Zod schema for query parameters (object shape). */
  requestQuery?: ZodTypeAny;
  /** Zod schemas for responses, keyed by status code. */
  responses?: Partial<Record<number | string, OpenApiResponseMeta>>;
  /** Whether this route is deprecated — tooling will strike-through it. */
  deprecated?: boolean;
}

export interface OpenApiResponseMeta {
  description: string;
  schema?: ZodTypeAny;
  /** Optional content type — defaults to `application/json`. */
  contentType?: string;
}

const registry = new Map<string, OpenApiRouteMeta>();

function makeKey(prefix: string, method: string, path: string): string {
  return `${prefix} ${method.toLowerCase()} ${path}`;
}

/** Register OpenAPI metadata for a single route. Idempotent by key. */
export function registerRoute(meta: OpenApiRouteMeta): void {
  registry.set(makeKey(meta.prefix, meta.method, meta.path), {
    ...meta,
    method: meta.method.toLowerCase() as HttpMethod,
  });
}

/** Bulk register — convenience wrapper for router files. */
export function registerRoutes(metas: OpenApiRouteMeta[]): void {
  for (const meta of metas) registerRoute(meta);
}

/** Lookup metadata for a mounted route. Returns undefined if not registered. */
export function getRouteMeta(
  prefix: string,
  method: string,
  path: string
): OpenApiRouteMeta | undefined {
  return registry.get(makeKey(prefix, method, path));
}

/** Return a snapshot of all registered metadata. */
export function listRegisteredRoutes(): OpenApiRouteMeta[] {
  return Array.from(registry.values());
}

/** Clear the registry — intended for tests only. */
export function resetRegistry(): void {
  registry.clear();
}
