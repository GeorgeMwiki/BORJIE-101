/**
 * Safe error helpers — Wave 19 Agent H+I
 *
 * The existing `error-envelope.ts` and `error-handler.middleware.ts` do the
 * right thing for *unhandled* exceptions: they redact messages in production,
 * they scrub stack traces, and they always stamp the envelope with a code +
 * requestId. The leaks we fixed here are in the per-router *caught* paths:
 *
 *   } catch (err) {
 *     const message = err instanceof Error ? err.message : String(err);
 *     return c.json({ success: false, error: { code, message } }, 500);
 *   }
 *
 * That pattern bypasses the central redactor — a raw SQL constraint name,
 * driver string, or file path goes straight to the client, which is exactly
 * what the user reported in Wave 19. These helpers fix that without
 * requiring every catch site to re-learn the `NODE_ENV` / requestId dance.
 *
 *   - `scrubMessage(err)` returns `err.message` in dev, a safe literal in
 *     prod, and never includes a stack.
 *   - `safeInternalError(c, code?, err?)` builds the standard envelope
 *     with a scrubbed message + a `requestId` pulled from context.
 *   - `mapSqlError(err)` maps common Postgres constraint errors to 4xx
 *     envelopes so duplicate-key / foreign-key violations don't become
 *     opaque 500s.
 */

import type { Context } from 'hono';
import { logger as defaultLogger } from './logger';

const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Return an error message that is safe to send in a response body.
 *
 * In production we never echo the raw exception message — Postgres driver
 * strings, stack frames, and file paths have all leaked this way before. In
 * dev we keep the original so tests and local debugging stay useful.
 */
export function scrubMessage(err: unknown, fallback = 'Internal server error'): string {
  if (!IS_PROD) {
    if (err instanceof Error && err.message) return err.message;
    if (typeof err === 'string' && err) return err;
  }
  return fallback;
}

export interface SafeErrorOptions {
  readonly code?: string;
  readonly status?: 500 | 502 | 503;
  readonly fallback?: string;
  readonly logContext?: Record<string, unknown>;
}

type HonoLikeContext = {
  readonly get: (key: string) => unknown;
  readonly json: (body: unknown, status: number) => Response;
  readonly req: { readonly path: string; readonly method: string };
};

/**
 * Build a 500/503 response for an unexpected catch path. Scrubs the
 * message for prod, logs the full error (including stack) against the
 * caller's requestId, and returns the Hono Response the handler should
 * return to the client.
 */
export function safeInternalError(
  c: HonoLikeContext,
  err: unknown,
  opts: SafeErrorOptions = {},
): Response {
  const code = opts.code ?? 'INTERNAL_ERROR';
  const status = opts.status ?? 500;
  const fallback = opts.fallback ?? 'Internal server error';
  const requestId =
    (c.get('requestId') as string | undefined) ??
    (c.get('x-request-id') as string | undefined);

  defaultLogger.error('unhandled route error', {
    requestId,
    code,
    status,
    path: c.req.path,
    method: c.req.method,
    err:
      err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : String(err),
    ...(opts.logContext ?? {}),
  });

  return c.json(
    {
      success: false,
      error: {
        code,
        message: scrubMessage(err, fallback),
        requestId,
      },
    },
    status,
  );
}

// ---------------------------------------------------------------------------
// SQL error mapping
// ---------------------------------------------------------------------------

/**
 * Known Postgres error code families we want to expose as 4xx envelopes.
 * See https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
export interface MappedSqlError {
  readonly status: 400 | 404 | 409 | 422 | 500;
  readonly code: string;
  readonly message: string;
}

export function mapSqlError(err: unknown): MappedSqlError | null {
  if (!err || typeof err !== 'object') return null;
  const rec = err as { code?: unknown; constraint?: unknown; detail?: unknown };
  if (typeof rec.code !== 'string') return null;

  switch (rec.code) {
    // unique_violation
    case '23505':
      return {
        status: 409,
        code: 'DUPLICATE_ENTRY',
        message: 'A record with these values already exists.',
      };
    // foreign_key_violation
    case '23503':
      return {
        status: 409,
        code: 'FOREIGN_KEY_VIOLATION',
        message: 'Referenced record does not exist or cannot be removed.',
      };
    // not_null_violation
    case '23502':
      return {
        status: 400,
        code: 'MISSING_REQUIRED_FIELD',
        message: 'A required field is missing.',
      };
    // check_violation
    case '23514':
      return {
        status: 400,
        code: 'CONSTRAINT_VIOLATION',
        message: 'Value violates a database check constraint.',
      };
    // invalid_text_representation
    case '22P02':
      return {
        status: 400,
        code: 'INVALID_INPUT_FORMAT',
        message: 'A field was submitted in an invalid format.',
      };
    // undefined_table / undefined_column (surface as 500 — infra, not user)
    case '42P01':
    case '42703':
      return null;
    default:
      return null;
  }
}

/**
 * Router helper: if `err` is a recognised SQL constraint error, return the
 * 4xx envelope; otherwise hand off to `safeInternalError`.
 */
export function routeCatch(
  c: HonoLikeContext,
  err: unknown,
  opts: SafeErrorOptions = {},
): Response {
  const mapped = mapSqlError(err);
  if (mapped) {
    const requestId =
      (c.get('requestId') as string | undefined) ??
      (c.get('x-request-id') as string | undefined);
    return c.json(
      {
        success: false,
        error: {
          code: mapped.code,
          message: mapped.message,
          requestId,
        },
      },
      mapped.status,
    );
  }
  return safeInternalError(c, err, opts);
}
