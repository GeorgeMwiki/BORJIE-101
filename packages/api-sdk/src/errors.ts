/**
 * Borjie API SDK error hierarchy.
 *
 * The legacy `ApiSdkError` class in `client.ts` is kept for backwards
 * compatibility (every existing consumer imports it from the SDK
 * root). New code should use the typed hierarchy below — it gives
 * agents a stable `instanceof` shape to switch on instead of parsing
 * status codes.
 *
 *   BorjieError                 (abstract base)
 *     ├── AuthError              401 / 403 / OAuth errors
 *     ├── RateLimitError         429 — carries retry-after
 *     ├── ValidationError        400 — carries `issues` from zod
 *     ├── ServerError            500 / 502 / 503 / 504
 *     └── NetworkError           fetch threw (timeout, DNS, etc.)
 *
 * All errors carry `requestId`, `timestamp`, and `details` so a single
 * agent log line is enough for support to triangulate.
 */

import { ApiSdkError, type ApiSdkErrorPayload } from './client.js';

export interface BorjieErrorArgs {
  readonly status: number;
  readonly code: string;
  readonly url: string;
  readonly message: string;
  readonly requestId?: string | undefined;
  readonly details?: unknown;
}

export abstract class BorjieError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly timestamp: string;
  readonly details: unknown;
  readonly url: string;

  constructor(args: BorjieErrorArgs) {
    super(args.message);
    this.name = new.target.name;
    this.status = args.status;
    this.code = args.code;
    this.url = args.url;
    this.requestId = args.requestId;
    this.timestamp = new Date().toISOString();
    this.details = args.details;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      url: this.url,
      message: this.message,
      requestId: this.requestId,
      timestamp: this.timestamp,
      details: this.details,
    };
  }
}

export class AuthError extends BorjieError {}

export class ValidationError extends BorjieError {
  readonly issues: ReadonlyArray<Record<string, unknown>>;
  constructor(
    args: BorjieErrorArgs & {
      issues?: ReadonlyArray<Record<string, unknown>>;
    },
  ) {
    super(args);
    this.issues = args.issues ?? [];
  }
}

export class RateLimitError extends BorjieError {
  readonly retryAfterSec: number | undefined;
  constructor(
    args: BorjieErrorArgs & {
      retryAfterSec?: number | undefined;
    },
  ) {
    super(args);
    this.retryAfterSec = args.retryAfterSec;
  }
}

export class ServerError extends BorjieError {}

export class NetworkError extends BorjieError {}

/**
 * Map an `ApiSdkError` (legacy) into the typed hierarchy. Used by the
 * higher-level `chat / drafts / estate / ...` clients so callers can
 * `try {} catch (err) { if (err instanceof RateLimitError) ... }`.
 */
export function toBorjieError(err: ApiSdkError | Error): BorjieError {
  if (err instanceof ApiSdkError) {
    const args = {
      status: err.status,
      code: err.code,
      url: err.url,
      message: err.message,
      ...(err.requestId ? { requestId: err.requestId } : {}),
      details: err.details,
    };
    if (err.status === 0 || err.code === 'NETWORK_ERROR') {
      return new NetworkError(args);
    }
    if (err.status === 401 || err.status === 403) return new AuthError(args);
    if (err.status === 429) {
      const retry = extractRetryAfter(err.details);
      return new RateLimitError({
        ...args,
        ...(retry !== undefined ? { retryAfterSec: retry } : {}),
      });
    }
    if (err.status === 400) {
      const issues = extractIssues(err.details);
      return new ValidationError({
        ...args,
        ...(issues ? { issues } : {}),
      });
    }
    if (err.status >= 500) return new ServerError(args);
    return new ServerError(args);
  }
  return new NetworkError({
    status: 0,
    code: 'NETWORK_ERROR',
    url: 'unknown',
    message: err.message,
  });
}

function extractRetryAfter(details: unknown): number | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const d = details as { retryAfter?: unknown };
  if (typeof d.retryAfter === 'number') return d.retryAfter;
  if (typeof d.retryAfter === 'string') {
    const n = Number.parseInt(d.retryAfter, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function extractIssues(
  details: unknown,
): ReadonlyArray<Record<string, unknown>> | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const d = details as { issues?: unknown };
  if (Array.isArray(d.issues)) {
    return d.issues as ReadonlyArray<Record<string, unknown>>;
  }
  return undefined;
}

export type { ApiSdkErrorPayload };
