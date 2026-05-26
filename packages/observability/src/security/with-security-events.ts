/**
 * `withSecurityEvents` — HOF wrappers + middleware + emit helper for
 * route handlers that record a structured `SecurityEvent` on every
 * state-changing call.
 *
 * Phase D / flaky-CI-closure. The Security Route Coverage gate
 * (`scripts/security-route-coverage.mjs`) enforces that every mutating
 * HTTP handler (POST/PUT/DELETE/PATCH) emits a `SecurityEvent` so
 * SOC 2 CC7.2 (logging) and GDPR Art. 30 (records of processing) are
 * satisfied uniformly across Hono, Fastify, and Next.js routes.
 *
 * Public API (consumed across api-gateway, parcel-service,
 * field-capture-service, document-intelligence):
 *
 *   - `withSecurityEvents(binding, handler)` — Hono per-handler HOF.
 *     The route already has bespoke logic and we want explicit
 *     before/after audit hooks.
 *
 *   - `withSecurityEventsFastify(binding, handler)` — Fastify
 *     per-handler HOF; pass-through generic preserves the caller's
 *     `FastifyRequest`/`FastifyReply` types.
 *
 *   - `withSecurityEventsNextRoute(binding, handler)` — Next.js
 *     App-Router wrapper, signature matches Next's `(req, ctx?)`.
 *
 *   - `securityEventsMiddleware` — Hono-style middleware mounted ONCE
 *     at the gateway composition root to cover every mutating request
 *     in a single line. Idempotent verbs pass through with zero
 *     overhead.
 *
 *   - `recordSecurityEvent(binding)` — low-level emit helper used by
 *     code paths that already know the outcome (e.g. webhook signature
 *     verifiers logging a DENIED audit before throwing).
 *
 *   - `setSecurityEventSink` / `getSecurityEventSink` /
 *     `resetSecurityEventSink` — pluggable sink registration. Default
 *     sink writes JSON lines to stdout so an OTel collector or
 *     fluentd can scoop them up; production wires a Postgres sink and
 *     a Kafka tap.
 *
 * Determinism + non-blocking semantics:
 *   - The middleware/HOF never lets the audit emission block the
 *     request. Sink failures are swallowed.
 *   - Outcome is derived from the response status: 2xx → SUCCESS,
 *     401/403 → DENIED, 4xx → FAILURE, 5xx → ERROR (when used through
 *     `recordSecurityEvent`'s richer `AuditOutcome` shape).
 */

import type { AuditOutcome, AuditSeverity } from '../types/audit.types.js';
import { AuditSeverity as AuditSeverityEnum } from '../types/audit.types.js';
import { logAuditEvent, type AuditUser, type AuditResource } from '../audit-logger.js';

// ---------------------------------------------------------------------------
// Types — binding-first API (canonical, consumed by 20+ active call sites)
// ---------------------------------------------------------------------------

export type SecurityEventSeverity = 'info' | 'notice' | 'warn' | 'critical';

export interface SecurityEvent {
  /** ISO-8601 instant the request was received. */
  readonly at: string;
  /** "<resource>.<verb>" — stable identifier for grep + aggregation. */
  readonly action: string;
  /** Top-level resource the request touches (e.g. 'lease', 'payment'). */
  readonly resource: string;
  /** Severity drives alert routing — `critical` pages SRE. */
  readonly severity: SecurityEventSeverity;
  /** HTTP verb of the inbound request. */
  readonly method: string;
  /** Route path with parameters substituted ('/leases/:id'). */
  readonly route: string;
  /** Resolved tenant — empty when the request was unauthenticated. */
  readonly tenantId: string | null;
  /** Resolved acting user — empty when unauthenticated. */
  readonly actorId: string | null;
  /** HTTP status the handler eventually returned. */
  readonly responseStatus: number;
  /** Wall-clock latency in ms. */
  readonly latencyMs: number;
  /** True if the handler threw (or returned 5xx). */
  readonly errored: boolean;
  /** Free-form payload for the resource id, before/after diffs, etc. */
  readonly detail: Record<string, unknown>;
  /** Request id propagated from upstream when present. */
  readonly correlationId: string | null;
  /** Remote IP (proxy-stripped when available). */
  readonly clientIp: string | null;
}

export type SecurityEventSink = (event: SecurityEvent) => void | Promise<void>;

export interface SecurityEventBinding {
  readonly action: string;
  readonly resource: string;
  readonly severity?: SecurityEventSeverity;
  /** Optional detail extractor — runs after the handler completes. */
  readonly extractDetail?: (ctx: unknown, result: unknown) => Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Legacy types — kept for in-package tests and downstream compatibility.
// `AuditableContext`/`AuditableNext`/`WithSecurityEventsOptions` describe
// the duck-typed Hono context shape used by `securityEventsMiddleware`.
// ---------------------------------------------------------------------------

/**
 * Minimal Hono-like context shape. We avoid a hard dep on `hono` so this
 * module stays usable from Express-style services too — duck-typed.
 */
export interface AuditableContext {
  req: {
    method: string;
    path?: string;
    url?: string;
    header(name: string): string | undefined;
    raw?: { headers: Headers };
  };
  res?: { status: number };
  get(key: 'auth'): unknown;
  get(key: string): unknown;
  set?(key: string, value: unknown): void;
}

export type AuditableNext = () => Promise<void> | void;

export interface WithSecurityEventsOptions {
  /**
   * Override the resource type recorded on the audit event. Defaults
   * to the first non-empty path segment.
   */
  resourceType?: string;
  /** Override the resource id (defaults to last path segment). */
  resourceIdFromPath?: boolean;
  /** Hook fired when the audit emission itself fails. */
  onError?: (err: unknown) => void;
  /** Skip audit emission for the current request. */
  skip?: (ctx: AuditableContext) => boolean;
}

// ---------------------------------------------------------------------------
// Sink registry — pluggable, defaults to stdout JSON lines
// ---------------------------------------------------------------------------

let activeSink: SecurityEventSink = defaultStdoutSink;

export function setSecurityEventSink(sink: SecurityEventSink): void {
  activeSink = sink;
}

export function getSecurityEventSink(): SecurityEventSink {
  return activeSink;
}

export function resetSecurityEventSink(): void {
  activeSink = defaultStdoutSink;
}

function defaultStdoutSink(event: SecurityEvent): void {
  // eslint-disable-next-line no-console -- SCRUB-5f: rule-disabled because this is the default stdout sink for SecurityEvents picked up by the log aggregator
  console.log(JSON.stringify({ ...event, source: 'security-events' }));
}

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

interface HonoContextLike {
  readonly req: {
    readonly method: string;
    readonly path?: string;
    readonly routePath?: string;
    readonly url?: string;
    readonly header?: (name: string) => string | null | undefined;
    readonly raw?: {
      readonly headers: Headers;
    };
  };
  readonly res?: {
    readonly status: number;
  };
  get(key: string): unknown;
}

function safeGet(c: HonoContextLike, key: string): string | null {
  try {
    const v = c.get(key);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

function safeReqHeader(req: HonoContextLike['req'], name: string): string | null {
  try {
    if (typeof req.header === 'function') {
      const v = req.header(name);
      return typeof v === 'string' ? v : null;
    }
    if (req.raw?.headers) {
      return req.raw.headers.get(name);
    }
  } catch {
    // ignore
  }
  return null;
}

function headerStr(
  headers: Record<string, unknown>,
  name: string,
): string | null {
  const v = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null;
  return typeof v === 'string' ? v : null;
}

// ---------------------------------------------------------------------------
// Hono wrapper — binding-first signature
// ---------------------------------------------------------------------------

/**
 * Hono wrapper — `c` is the Hono Context. Resolves `tenantId` and
 * `actorId` from `c.get(...)` if the upstream auth middleware set them.
 *
 * @example
 * ```ts
 * app.post('/leases', withSecurityEvents({
 *   action: 'lease.create',
 *   resource: 'lease',
 *   severity: 'info',
 * }, async (c) => {
 *   // existing handler body
 * }));
 * ```
 */
export function withSecurityEvents<C extends HonoContextLike, R>(
  binding: SecurityEventBinding,
  handler: (c: C) => Promise<R> | R,
): (c: C) => Promise<R> {
  return async (c: C): Promise<R> => {
    const started = performance.now();
    let result: R | undefined;
    let errored = false;
    let thrown: { message?: unknown } | undefined;
    try {
      result = await handler(c);
      return result;
    } catch (err) {
      errored = true;
      thrown = err as { message?: unknown };
      throw err;
    } finally {
      const latencyMs = performance.now() - started;
      const req = c.req;
      const detail = binding.extractDetail?.(c, result) ?? {};
      const evt: SecurityEvent = {
        at: new Date().toISOString(),
        action: binding.action,
        resource: binding.resource,
        severity: binding.severity ?? 'info',
        method: req.method,
        route: req.routePath ?? req.path ?? 'unknown',
        tenantId: safeGet(c, 'tenantId'),
        actorId: safeGet(c, 'actorId'),
        responseStatus: errored ? 500 : c.res?.status ?? 200,
        latencyMs,
        errored,
        detail: {
          ...detail,
          ...(thrown ? { errorMessage: String(thrown.message ?? thrown) } : {}),
        },
        correlationId:
          safeReqHeader(req, 'x-correlation-id') ?? safeReqHeader(req, 'x-request-id'),
        clientIp:
          safeReqHeader(req, 'x-forwarded-for') ?? safeReqHeader(req, 'x-real-ip'),
      };
      try {
        await activeSink(evt);
      } catch {
        // never let the sink fail the request.
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Fastify wrapper — generic pass-through preserves caller's request/reply
// ---------------------------------------------------------------------------

/**
 * Fastify wrapper. Handler matches Fastify's
 * `(request: FastifyRequest, reply: FastifyReply) => Promise<T> | T`.
 * Reads `request.tenantId` / `request.actorId` when the auth plugin has
 * decorated the request; falls back to header-derived values.
 */
// Using `never` for params + `unknown` for return: function parameters are
// contravariant, so `never` is the bottom type that any function shape can
// extend (a handler that accepts a `FastifyRequest` is a supertype of one
// that accepts `never`). This replaces the previous `any` constraint while
// preserving the pass-through generic.
export function withSecurityEventsFastify<
  H extends (request: never, reply: never) => unknown,
>(binding: SecurityEventBinding, handler: H): H {
  const wrapped = async (
    request: Parameters<H>[0],
    reply: Parameters<H>[1],
  ): Promise<Awaited<ReturnType<H>>> => {
    const started = performance.now();
    let result: Awaited<ReturnType<H>> | undefined;
    let errored = false;
    let thrown: { message?: unknown } | undefined;
    try {
      result = (await handler(request, reply)) as Awaited<ReturnType<H>>;
      return result;
    } catch (err) {
      errored = true;
      thrown = err as { message?: unknown };
      throw err;
    } finally {
      const latencyMs = performance.now() - started;
      // Structural reads — we never depend on the real Fastify types.
      const req = request as {
        readonly method?: string;
        readonly url?: string;
        readonly routeOptions?: { readonly url?: string };
        readonly headers?: Record<string, unknown>;
        readonly tenantId?: unknown;
        readonly actorId?: unknown;
      };
      const rep = reply as { readonly statusCode?: number };
      const headers: Record<string, unknown> = req.headers ?? {};
      const tenantId =
        typeof req.tenantId === 'string'
          ? req.tenantId
          : headerStr(headers, 'x-tenant-id');
      const actorId =
        typeof req.actorId === 'string'
          ? req.actorId
          : headerStr(headers, 'x-actor-id');
      const evt: SecurityEvent = {
        at: new Date().toISOString(),
        action: binding.action,
        resource: binding.resource,
        severity: binding.severity ?? 'info',
        method: req.method ?? 'UNKNOWN',
        route: req.routeOptions?.url ?? req.url ?? 'unknown',
        tenantId,
        actorId,
        responseStatus: errored ? 500 : rep.statusCode ?? 200,
        latencyMs,
        errored,
        detail: thrown
          ? { errorMessage: String(thrown.message ?? thrown) }
          : (binding.extractDetail?.(req, result) ?? {}),
        correlationId:
          headerStr(headers, 'x-correlation-id') ?? headerStr(headers, 'x-request-id'),
        clientIp:
          headerStr(headers, 'x-forwarded-for') ?? headerStr(headers, 'x-real-ip'),
      };
      try {
        await activeSink(evt);
      } catch {
        // never let the sink fail the request.
      }
    }
  };
  return wrapped as unknown as H;
}

// ---------------------------------------------------------------------------
// Next.js App-Router wrapper
// ---------------------------------------------------------------------------

/**
 * Next.js App Router wrapper. The handler signature must match Next's
 * `(req: Request, ctx?) => Response | Promise<Response>`.
 */
export function withSecurityEventsNextRoute(
  binding: SecurityEventBinding,
  handler: (req: Request, ctx?: unknown) => Promise<Response> | Response,
): (req: Request, ctx?: unknown) => Promise<Response> {
  return async (req: Request, ctx?: unknown): Promise<Response> => {
    const started = performance.now();
    let response: Response | undefined;
    let errored = false;
    let thrown: { message?: unknown } | undefined;
    try {
      response = await handler(req, ctx);
      return response;
    } catch (err) {
      errored = true;
      thrown = err as { message?: unknown };
      throw err;
    } finally {
      const latencyMs = performance.now() - started;
      const url = new URL(req.url);
      const evt: SecurityEvent = {
        at: new Date().toISOString(),
        action: binding.action,
        resource: binding.resource,
        severity: binding.severity ?? 'info',
        method: req.method,
        route: url.pathname,
        tenantId: req.headers.get('x-tenant-id'),
        actorId: req.headers.get('x-actor-id'),
        responseStatus: errored ? 500 : response?.status ?? 200,
        latencyMs,
        errored,
        detail: thrown
          ? { errorMessage: String(thrown.message ?? thrown) }
          : (binding.extractDetail?.(req, response) ?? {}),
        correlationId:
          req.headers.get('x-correlation-id') ?? req.headers.get('x-request-id'),
        clientIp:
          req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip'),
      };
      try {
        await activeSink(evt);
      } catch {
        // never let the sink fail the request.
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Hono middleware — mounted globally, no-ops on idempotent verbs
// ---------------------------------------------------------------------------

/**
 * Hono-style middleware. Mount once at the gateway root:
 *
 *   api.use('*', securityEventsMiddleware);
 *
 * Idempotent verbs (GET/HEAD/OPTIONS) pass through with zero overhead.
 */
export async function securityEventsMiddleware(
  ctx: AuditableContext,
  next: AuditableNext,
): Promise<void> {
  const method = ctx.req.method.toUpperCase();
  if (!MUTATING_METHODS.has(method)) {
    await next();
    return;
  }
  try {
    await next();
  } finally {
    const status = ctx.res?.status ?? 200;
    // Best-effort, non-blocking — emit through the active sink AND
    // through the audit-logger so SOC 2 CC7.2 + GDPR Art. 30 trails
    // stay in sync.
    void emitMiddlewareEvent(ctx, status);
  }
}

async function emitMiddlewareEvent(
  ctx: AuditableContext,
  status: number,
): Promise<void> {
  try {
    const path = getPath(ctx);
    const resource = deriveResource(path);
    const user = extractUser(ctx);
    const { outcome, severity } = classifyOutcome(status);
    const sinkEvt: SecurityEvent = {
      at: new Date().toISOString(),
      action: `${ctx.req.method.toUpperCase()}.${resource.type}`,
      resource: resource.type,
      severity: mapAuditSeverityToSink(severity),
      method: ctx.req.method.toUpperCase(),
      route: path,
      tenantId: typeof user.id === 'string' && user.id !== 'anonymous' ? user.id : null,
      actorId: typeof user.id === 'string' ? user.id : null,
      responseStatus: status,
      latencyMs: 0,
      errored: outcome === 'ERROR',
      detail: { reason: outcome },
      correlationId: ctx.req.header('x-correlation-id') ?? ctx.req.header('x-request-id') ?? null,
      clientIp: ctx.req.header('x-forwarded-for') ?? ctx.req.header('x-real-ip') ?? null,
    };
    try {
      await activeSink(sinkEvt);
    } catch {
      // ignore sink failure
    }
    await logAuditEvent(user, ctx.req.method.toUpperCase(), { type: resource.type, id: resource.id }, {
      category: 'SYSTEM',
      outcome,
      severity,
      description: `${ctx.req.method.toUpperCase()} ${path} → ${status}`,
      request: { httpMethod: ctx.req.method.toUpperCase(), httpPath: path },
      metadata: { statusCode: status },
    });
  } catch (err) {
    console.warn('securityEventsMiddleware: audit emit failed', err);
  }
}

function mapAuditSeverityToSink(s: AuditSeverity): SecurityEventSeverity {
  if (s === AuditSeverityEnum.CRITICAL) return 'critical';
  if (s === AuditSeverityEnum.WARNING) return 'warn';
  return 'info';
}

function deriveResource(path: string): { type: string; id: string } {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return { type: 'unknown', id: 'root' };
  const filtered = segments.filter((s) => !/^v\d+$/i.test(s) && s !== 'api');
  const type = filtered[0] ?? segments[0] ?? 'unknown';
  const id = filtered.length > 1 ? filtered[filtered.length - 1] : 'collection';
  return { type, id };
}

function classifyOutcome(
  status: number,
): { outcome: AuditOutcome; severity: AuditSeverity } {
  if (status >= 200 && status < 300) {
    return { outcome: 'SUCCESS', severity: AuditSeverityEnum.INFO };
  }
  if (status === 401 || status === 403) {
    return { outcome: 'DENIED', severity: AuditSeverityEnum.WARNING };
  }
  if (status >= 400 && status < 500) {
    return { outcome: 'FAILURE', severity: AuditSeverityEnum.WARNING };
  }
  if (status >= 500) {
    return { outcome: 'ERROR', severity: AuditSeverityEnum.CRITICAL };
  }
  return { outcome: 'SUCCESS', severity: AuditSeverityEnum.INFO };
}

function extractUser(ctx: AuditableContext): AuditUser {
  const auth = (ctx.get('auth') ?? {}) as Record<string, unknown>;
  const ipHeader = ctx.req.header('x-forwarded-for') ?? ctx.req.header('x-real-ip');
  return {
    id:
      (auth.userId as string) ??
      (auth.sub as string) ??
      'anonymous',
    name: (auth.displayName as string) ?? (auth.email as string) ?? undefined,
    email: (auth.email as string) ?? undefined,
    roles: Array.isArray(auth.roles)
      ? (auth.roles as string[])
      : auth.role
      ? [auth.role as string]
      : undefined,
    ipAddress: ipHeader?.split(',')[0]?.trim(),
    userAgent: ctx.req.header('user-agent') ?? undefined,
  };
}

function getPath(ctx: AuditableContext): string {
  if (ctx.req.path) return ctx.req.path;
  if (ctx.req.url) {
    try {
      return new URL(ctx.req.url).pathname;
    } catch {
      return ctx.req.url;
    }
  }
  return '/';
}

// ---------------------------------------------------------------------------
// recordSecurityEvent — binding-shaped direct emit (canonical) +
// internal helper for legacy ctx-based callsites if any remain.
// ---------------------------------------------------------------------------

/**
 * Direct emit — for code paths that aren't HTTP routes (cron, queue)
 * or that already know the outcome (webhook signature verifiers logging
 * a DENIED audit before throwing).
 *
 * Accepts the canonical binding shape used by field-capture-service:
 *
 *   recordSecurityEvent({
 *     action: 'capture.tenant_mismatch',
 *     resource: 'capture',
 *     severity: 'warn',
 *     method: 'POST',
 *     route: '/v1/...',
 *     tenantId,
 *     actorId,
 *     detail: { ... },
 *   })
 *
 * All sink/audit-logger errors are swallowed — never propagates.
 */
export async function recordSecurityEvent(
  binding: Omit<SecurityEventBinding, 'extractDetail'> & {
    readonly detail?: Record<string, unknown>;
    readonly method?: string;
    readonly route?: string;
    readonly tenantId?: string | null;
    readonly actorId?: string | null;
  },
): Promise<void> {
  const evt: SecurityEvent = {
    at: new Date().toISOString(),
    action: binding.action,
    resource: binding.resource,
    severity: binding.severity ?? 'info',
    method: binding.method ?? 'INTERNAL',
    route: binding.route ?? 'internal',
    tenantId: binding.tenantId ?? null,
    actorId: binding.actorId ?? null,
    responseStatus: 200,
    latencyMs: 0,
    errored: false,
    detail: binding.detail ?? {},
    correlationId: null,
    clientIp: null,
  };
  try {
    await activeSink(evt);
  } catch {
    // never propagate
  }
}
