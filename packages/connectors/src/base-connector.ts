/**
 * Base connector primitive — every external integration Borjie ships
 * (M-Pesa, GePG, Twilio, MLS, credit bureaus, appraisal APIs) wraps its
 * outbound HTTP through this. Mirrors LITFIN's `connectors/base-connector.ts`.
 *
 * Provides rate-limiting (token bucket), circuit-breaker (closed/half-open/open),
 * retry (exp backoff + jitter), audit logging, structured event emission,
 * Zod validation hooks, idempotency-key passthrough, oauth2 single-attempt
 * refresh-on-401, and AbortController-based timeouts.
 *
 * Pure factory. Clock + fetch + events + audit are all injectable for
 * deterministic unit tests. No global state.
 */

import { createHash } from 'node:crypto';
import type { ZodSchema } from 'zod';
import { logger } from './logger.js';

// ---------- Public types ----------

export type ConnectorAuth =
  | { readonly kind: 'bearer'; readonly token: () => Promise<string> }
  | { readonly kind: 'api-key'; readonly headerName: string; readonly key: string }
  | { readonly kind: 'basic'; readonly username: string; readonly password: string }
  | {
      readonly kind: 'oauth2';
      readonly accessTokenProvider: () => Promise<string>;
      readonly refresh: () => Promise<void>;
    };

export interface ConnectorConfig {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly auth?: ConnectorAuth;
  readonly rateLimit?: { readonly rpm: number; readonly burst?: number };
  readonly circuitBreaker?: {
    readonly errorThreshold: number;
    readonly halfOpenAfterMs: number;
  };
  readonly retry?: { readonly maxAttempts: number; readonly initialDelayMs: number };
  readonly timeoutMs?: number;
}

export interface ConnectorRequest<I> {
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: I;
  readonly query?: Record<string, string | number | undefined>;
  readonly headers?: Record<string, string>;
  readonly inputSchema?: ZodSchema<I>;
  readonly outputSchema?: ZodSchema<unknown>;
  readonly idempotencyKey?: string;
}

export type ConnectorOutcome<O> =
  | { readonly kind: 'ok'; readonly data: O; readonly latencyMs: number; readonly attempt: number }
  | { readonly kind: 'unconfigured'; readonly reason: string }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'circuit-open'; readonly nextProbeAt: string }
  | { readonly kind: 'validation-failed'; readonly issue: string }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

export interface ConnectorEvent {
  readonly connectorId: string;
  readonly kind:
    | 'request'
    | 'response'
    | 'error'
    | 'rate-limited'
    | 'circuit-opened'
    | 'circuit-half-open'
    | 'circuit-closed'
    | 'auth-refreshed';
  readonly path?: string;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly at: string;
}

export interface ConnectorEventSink {
  emit(event: ConnectorEvent): void;
}

export interface AuditSink {
  audit(args: {
    readonly connectorId: string;
    readonly path: string;
    readonly method: string;
    readonly outcome: 'ok' | 'failed' | 'circuit-open' | 'rate-limited';
    readonly latencyMs: number;
    readonly inputHash?: string;
    readonly outputHash?: string;
    readonly idempotencyKey?: string;
  }): Promise<void>;
}

export interface CircuitHealth {
  readonly state: 'closed' | 'half-open' | 'open';
  readonly errorCount: number;
  readonly lastErrorAt: string | null;
}

export interface BaseConnector {
  readonly id: string;
  call<I, O>(req: ConnectorRequest<I>): Promise<ConnectorOutcome<O>>;
  health(): CircuitHealth;
}

export interface BaseConnectorDeps {
  readonly config: ConnectorConfig;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

// ---------- Internal helpers ----------

interface TokenBucket {
  tokens: number;
  lastRefillMs: number;
}

interface CircuitState {
  state: 'closed' | 'half-open' | 'open';
  errorCount: number;
  lastErrorAt: string | null;
  openedAtMs: number | null;
}

const DEFAULTS = {
  rpm: 600,
  errorThreshold: 5,
  halfOpenAfterMs: 30_000,
  maxAttempts: 3,
  initialDelayMs: 200,
  timeoutMs: 10_000,
} as const;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

function sha256Hex(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, string | number | undefined>): string {
  const root = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const tail = path.startsWith('/') ? path : `/${path}`;
  let url = `${root}${tail}`;
  if (query) {
    const params: string[] = [];
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) continue;
      params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
    if (params.length > 0) url += `?${params.join('&')}`;
  }
  return url;
}

async function applyAuth(headers: Record<string, string>, auth: ConnectorAuth | undefined): Promise<void> {
  if (!auth) return;
  switch (auth.kind) {
    case 'bearer': {
      const token = await auth.token();
      headers['Authorization'] = `Bearer ${token}`;
      return;
    }
    case 'api-key': {
      headers[auth.headerName] = auth.key;
      return;
    }
    case 'basic': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`, 'utf8').toString('base64');
      headers['Authorization'] = `Basic ${encoded}`;
      return;
    }
    case 'oauth2': {
      const token = await auth.accessTokenProvider();
      headers['Authorization'] = `Bearer ${token}`;
      return;
    }
  }
}

function refillBucket(bucket: TokenBucket, capacity: number, refillPerMs: number, nowMs: number): void {
  const elapsed = Math.max(0, nowMs - bucket.lastRefillMs);
  const refilled = elapsed * refillPerMs;
  bucket.tokens = Math.min(capacity, bucket.tokens + refilled);
  bucket.lastRefillMs = nowMs;
}

function jitter(baseMs: number): number {
  // +/- 20% jitter
  const spread = baseMs * 0.2;
  return baseMs + (Math.random() * 2 - 1) * spread;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// ---------- Factory ----------

export function createBaseConnector(deps: BaseConnectorDeps): BaseConnector {
  const { config } = deps;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const clock = deps.clock ?? Date.now;
  const events = deps.events;
  const audit = deps.audit;

  if (!fetchImpl) {
    throw new Error('createBaseConnector: no fetch implementation available');
  }

  const rpm = config.rateLimit?.rpm ?? DEFAULTS.rpm;
  const burst = config.rateLimit?.burst ?? rpm;
  const refillPerMs = rpm / 60_000;

  const errorThreshold = config.circuitBreaker?.errorThreshold ?? DEFAULTS.errorThreshold;
  const halfOpenAfterMs = config.circuitBreaker?.halfOpenAfterMs ?? DEFAULTS.halfOpenAfterMs;

  const maxAttempts = config.retry?.maxAttempts ?? DEFAULTS.maxAttempts;
  const initialDelayMs = config.retry?.initialDelayMs ?? DEFAULTS.initialDelayMs;

  const timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;

  const bucket: TokenBucket = { tokens: burst, lastRefillMs: clock() };
  const circuit: CircuitState = {
    state: 'closed',
    errorCount: 0,
    lastErrorAt: null,
    openedAtMs: null,
  };

  function emit(event: Omit<ConnectorEvent, 'connectorId' | 'at'> & Partial<Pick<ConnectorEvent, 'at'>>): void {
    if (!events) return;
    events.emit({
      connectorId: config.id,
      at: event.at ?? new Date(clock()).toISOString(),
      ...event,
    } as ConnectorEvent);
  }

  function trackSuccess(): void {
    if (circuit.state === 'half-open') {
      circuit.state = 'closed';
      circuit.errorCount = 0;
      circuit.openedAtMs = null;
      emit({ kind: 'circuit-closed' });
      return;
    }
    if (circuit.state === 'closed') {
      circuit.errorCount = 0;
    }
  }

  function trackFailure(): void {
    circuit.lastErrorAt = new Date(clock()).toISOString();
    if (circuit.state === 'half-open') {
      circuit.state = 'open';
      circuit.openedAtMs = clock();
      emit({ kind: 'circuit-opened' });
      return;
    }
    circuit.errorCount += 1;
    if (circuit.state === 'closed' && circuit.errorCount >= errorThreshold) {
      circuit.state = 'open';
      circuit.openedAtMs = clock();
      emit({ kind: 'circuit-opened' });
    }
  }

  function maybeHalfOpen(): void {
    if (circuit.state !== 'open' || circuit.openedAtMs === null) return;
    if (clock() - circuit.openedAtMs >= halfOpenAfterMs) {
      circuit.state = 'half-open';
      emit({ kind: 'circuit-half-open' });
    }
  }

  async function recordAudit(args: {
    path: string;
    method: string;
    outcome: 'ok' | 'failed' | 'circuit-open' | 'rate-limited';
    latencyMs: number;
    inputHash?: string | undefined;
    outputHash?: string | undefined;
    idempotencyKey?: string | undefined;
  }): Promise<void> {
    if (!audit) return;
    try {
      const auditRow: Parameters<AuditSink['audit']>[0] = {
        connectorId: config.id,
        path: args.path,
        method: args.method,
        outcome: args.outcome,
        latencyMs: args.latencyMs,
        ...(args.inputHash !== undefined ? { inputHash: args.inputHash } : {}),
        ...(args.outputHash !== undefined ? { outputHash: args.outputHash } : {}),
        ...(args.idempotencyKey !== undefined ? { idempotencyKey: args.idempotencyKey } : {}),
      };
      await audit.audit(auditRow);
    } catch (err) {
      // Audit must not break the call.
      logger.error(`[connector:${config.id}] audit failed`, { error: err });
    }
  }

  /**
   * Single fetch attempt — applies auth, timeout, parses JSON.
   * Returns a normalised attempt result; never throws.
   */
  async function singleAttempt<I>(
    url: string,
    req: ConnectorRequest<I>,
    inputBody: string | undefined,
  ): Promise<
    | { kind: 'ok'; status: number; body: unknown; latencyMs: number }
    | { kind: 'upstream'; status: number; message: string; latencyMs: number; body: unknown }
    | { kind: 'transport'; message: string; latencyMs: number }
  > {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(req.headers ?? {}),
    };

    if (req.idempotencyKey) headers['Idempotency-Key'] = req.idempotencyKey;
    await applyAuth(headers, config.auth);

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = clock();

    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: controller.signal,
      };
      if (inputBody !== undefined) (init as { body?: string }).body = inputBody;

      emit({ kind: 'request', path: req.path });
      const res = await fetchImpl(url, init);
      const latencyMs = clock() - startedAt;
      let body: unknown = null;
      try {
        const text = await res.text();
        body = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        body = null;
      }

      if (res.ok) {
        emit({ kind: 'response', path: req.path, status: res.status, latencyMs });
        return { kind: 'ok', status: res.status, body, latencyMs };
      }

      const message =
        body && typeof body === 'object' && 'message' in body && typeof (body as { message?: unknown }).message === 'string'
          ? (body as { message: string }).message
          : `HTTP ${res.status}`;

      emit({ kind: 'error', path: req.path, status: res.status, latencyMs });
      return { kind: 'upstream', status: res.status, message, latencyMs, body };
    } catch (err) {
      const latencyMs = clock() - startedAt;
      const message = err instanceof Error ? err.message : String(err);
      emit({ kind: 'error', path: req.path, latencyMs });
      return { kind: 'transport', message, latencyMs };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function call<I, O>(req: ConnectorRequest<I>): Promise<ConnectorOutcome<O>> {
    // 1. Input validation
    if (req.inputSchema && req.body !== undefined) {
      const parsed = req.inputSchema.safeParse(req.body);
      if (!parsed.success) {
        return { kind: 'validation-failed', issue: parsed.error.message };
      }
    }

    // 2. Circuit-breaker — promote open→half-open if cool-down elapsed.
    maybeHalfOpen();
    if (circuit.state === 'open') {
      const nextProbeAt = new Date((circuit.openedAtMs ?? clock()) + halfOpenAfterMs).toISOString();
      await recordAudit({
        path: req.path,
        method: req.method,
        outcome: 'circuit-open',
        latencyMs: 0,
        ...(req.idempotencyKey !== undefined ? { idempotencyKey: req.idempotencyKey } : {}),
      });
      return { kind: 'circuit-open', nextProbeAt };
    }

    // 3. Rate-limit — token bucket.
    refillBucket(bucket, burst, refillPerMs, clock());
    if (bucket.tokens < 1) {
      const deficit = 1 - bucket.tokens;
      const retryAfterMs = Math.ceil(deficit / refillPerMs);
      emit({ kind: 'rate-limited', path: req.path });
      await recordAudit({
        path: req.path,
        method: req.method,
        outcome: 'rate-limited',
        latencyMs: 0,
        ...(req.idempotencyKey !== undefined ? { idempotencyKey: req.idempotencyKey } : {}),
      });
      return { kind: 'rate-limited', retryAfterMs };
    }
    bucket.tokens -= 1;

    // 4. Build URL + body.
    const url = buildUrl(config.baseUrl, req.path, req.query);
    const inputBody = req.body !== undefined ? JSON.stringify(req.body) : undefined;
    const inputHash = req.body !== undefined ? sha256Hex(req.body) : undefined;

    // 5. Attempts loop.
    let lastUpstreamStatus = 0;
    let lastMessage = '';
    let didAuthRefresh = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await singleAttempt(url, req, inputBody);

      // OAuth2 401 → refresh once, retry within same attempt budget.
      if (
        result.kind === 'upstream' &&
        result.status === 401 &&
        config.auth?.kind === 'oauth2' &&
        !didAuthRefresh
      ) {
        didAuthRefresh = true;
        try {
          await config.auth.refresh();
          emit({ kind: 'auth-refreshed' });
        } catch (err) {
          lastMessage = err instanceof Error ? err.message : String(err);
          break;
        }
        // re-attempt same iteration without consuming attempt budget
        const retried = await singleAttempt(url, req, inputBody);
        if (retried.kind === 'ok') {
          return await finaliseOk<O>(req, retried.body, retried.latencyMs, attempt, inputHash);
        }
        if (retried.kind === 'upstream') {
          lastUpstreamStatus = retried.status;
          lastMessage = retried.message;
          if (retried.status < 500) {
            await terminate('failed', retried.latencyMs);
            trackFailure();
            return { kind: 'upstream-error', status: retried.status, message: retried.message };
          }
        } else {
          lastMessage = retried.message;
        }
        if (attempt < maxAttempts) {
          const delay = jitter(initialDelayMs * 2 ** (attempt - 1));
          await sleep(delay);
        }
        continue;
      }

      if (result.kind === 'ok') {
        return await finaliseOk<O>(req, result.body, result.latencyMs, attempt, inputHash);
      }

      if (result.kind === 'upstream') {
        lastUpstreamStatus = result.status;
        lastMessage = result.message;
        if (result.status < 500) {
          // 4xx → no retry
          await terminate('failed', result.latencyMs);
          trackFailure();
          return { kind: 'upstream-error', status: result.status, message: result.message };
        }
        // 5xx → retry
      } else {
        // transport
        lastMessage = result.message;
      }

      if (attempt < maxAttempts) {
        const delay = jitter(initialDelayMs * 2 ** (attempt - 1));
        await sleep(delay);
      }
    }

    // Exhausted retries.
    await terminate('failed', 0);
    trackFailure();
    if (lastUpstreamStatus >= 500) {
      return { kind: 'upstream-error', status: lastUpstreamStatus, message: lastMessage || 'upstream error' };
    }
    return { kind: 'transport-error', message: lastMessage || 'transport error' };

    async function terminate(_o: 'ok' | 'failed' | 'circuit-open' | 'rate-limited', latencyMs: number): Promise<void> {
      await recordAudit({
        path: req.path,
        method: req.method,
        outcome: _o,
        latencyMs,
        ...(inputHash !== undefined ? { inputHash } : {}),
        ...(req.idempotencyKey !== undefined ? { idempotencyKey: req.idempotencyKey } : {}),
      });
    }
  }

  async function finaliseOk<O>(
    req: ConnectorRequest<unknown>,
    body: unknown,
    latencyMs: number,
    attempt: number,
    inputHash: string | undefined,
  ): Promise<ConnectorOutcome<O>> {
    if (req.outputSchema) {
      const parsed = req.outputSchema.safeParse(body);
      if (!parsed.success) {
        await recordAudit({
          path: req.path,
          method: req.method,
          outcome: 'failed',
          latencyMs,
          ...(inputHash !== undefined ? { inputHash } : {}),
          ...(req.idempotencyKey !== undefined ? { idempotencyKey: req.idempotencyKey } : {}),
        });
        trackFailure();
        return { kind: 'validation-failed', issue: parsed.error.message };
      }
      const outputHash = sha256Hex(parsed.data);
      await recordAudit({
        path: req.path,
        method: req.method,
        outcome: 'ok',
        latencyMs,
        outputHash,
        ...(inputHash !== undefined ? { inputHash } : {}),
        ...(req.idempotencyKey !== undefined ? { idempotencyKey: req.idempotencyKey } : {}),
      });
      trackSuccess();
      return { kind: 'ok', data: parsed.data as O, latencyMs, attempt };
    }

    const outputHash = body !== null ? sha256Hex(body) : undefined;
    await recordAudit({
      path: req.path,
      method: req.method,
      outcome: 'ok',
      latencyMs,
      ...(outputHash !== undefined ? { outputHash } : {}),
      ...(inputHash !== undefined ? { inputHash } : {}),
      ...(req.idempotencyKey !== undefined ? { idempotencyKey: req.idempotencyKey } : {}),
    });
    trackSuccess();
    return { kind: 'ok', data: body as O, latencyMs, attempt };
  }

  function health(): CircuitHealth {
    maybeHalfOpen();
    return {
      state: circuit.state,
      errorCount: circuit.errorCount,
      lastErrorAt: circuit.lastErrorAt,
    };
  }

  return {
    id: config.id,
    call,
    health,
  };
}
