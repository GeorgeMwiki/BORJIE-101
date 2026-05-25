/**
 * Security-headers middleware — framework-agnostic with a Hono-shaped
 * signature (so it can be `app.use('*', mw)` directly).
 *
 * We do NOT import Hono. Instead we type the middleware against the
 * minimal `MiddlewareContext` interface — Hono's `Context` is a
 * superset, so the function can be dropped into a Hono app verbatim,
 * and the test suite can call it with a tiny mock context.
 */

import type { SecurityHeadersConfig } from '../types.js';
import { buildSecurityHeaders, withRouteOverride } from './presets.js';

export interface MiddlewareContextHeaders {
  set(name: string, value: string): void;
}

export interface MiddlewareContext {
  readonly res: { readonly headers: MiddlewareContextHeaders };
  /** Hono's `c.header(name, value)` is an alias we also support. */
  header?(name: string, value: string): void;
}

export type MiddlewareNext = () => Promise<void>;

export type SecurityHeadersMiddleware = (
  c: MiddlewareContext,
  next: MiddlewareNext,
) => Promise<void>;

/**
 * Build a middleware that sets the preset headers on every response.
 *
 * Per-route overrides: pass `routeOverrides` keyed by route pattern;
 * the middleware will pick the matching override (longest-prefix wins)
 * and merge it on top of the base config.
 */
export interface CreateSecurityHeadersMiddlewareOptions
  extends SecurityHeadersConfig {
  readonly routeOverrides?: ReadonlyArray<{
    readonly pathPrefix: string;
    readonly override: Partial<SecurityHeadersConfig>;
  }>;
  /** Optional path resolver — used when the context isn't a Hono one. */
  readonly resolvePath?: (c: MiddlewareContext) => string;
}

function pickOverride(
  path: string,
  overrides: CreateSecurityHeadersMiddlewareOptions['routeOverrides'],
): Partial<SecurityHeadersConfig> | undefined {
  if (!overrides || overrides.length === 0) return undefined;
  const matches = overrides
    .filter((o) => path.startsWith(o.pathPrefix))
    .sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);
  return matches[0]?.override;
}

export function createSecurityHeadersMiddleware(
  opts: CreateSecurityHeadersMiddlewareOptions,
): SecurityHeadersMiddleware {
  const { routeOverrides, resolvePath, ...baseRaw } = opts;
  const base = baseRaw as SecurityHeadersConfig;
  return async function securityHeadersMiddleware(c, next) {
    await next();
    const path =
      resolvePath?.(c) ??
      (c as unknown as { req?: { path?: string } }).req?.path ??
      '/';
    const override = pickOverride(path, routeOverrides);
    const config = override ? withRouteOverride(base, override) : base;
    const headers = buildSecurityHeaders(config);
    for (const [name, value] of Object.entries(headers)) {
      if (c.header) c.header(name, value);
      else c.res.headers.set(name, value);
    }
  };
}
