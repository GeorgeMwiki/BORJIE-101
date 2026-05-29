/**
 * Uniform error envelope — SCAFFOLDED 10
 *
 * Enforces the `{ error: { code, message, requestId, details? } }` shape
 * for both Hono onError handlers and Express error middleware. Prevents
 * accidental leakage of stack traces or native error messages in prod.
 *
 * Any route can `throw new ApiError(...)` to signal a known error; anything
 * else is normalized to INTERNAL_ERROR with the trace available via the
 * injected logger only.
 */

import type { Context } from 'hono';
import type { NextFunction, Request, Response } from 'express';
import type pino from 'pino';
// Wave-K W-Data — scrub RESTRICTED / CONFIDENTIAL field values from
// error envelopes BEFORE they leave the gateway. The data-classification
// registry has zero call sites today; without this gate, an
// `error.details` payload from a Drizzle constraint violation would
// leak raw `customers.phone` / `payments.mpesa_phone` straight to the
// client. Routes that NEED raw values (DSAR export) set
// `c.set('skipScrub', true)`.
import { scrubIfNotOptedOut } from './classification-scrubber';
// Endpoint-smoke fix: route uncaught throws through `mapSqlError` so
// a Drizzle/Postgres failure with SQLSTATE `42P01` (missing table) or
// `42703` (missing column) becomes a structured 503 envelope instead
// of an opaque INTERNAL_ERROR 500.
import { mapSqlError } from '../utils/safe-error';

export interface ErrorEnvelopeBody {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(params: { status: number; code: string; message: string; details?: unknown }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
  }
}

function buildEnvelope(
  err: unknown,
  requestId: string | undefined
): { status: number; body: ErrorEnvelopeBody } {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(requestId !== undefined ? { requestId } : {}),
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
    };
  }

  // SQL-error fast-path: a missing table / column / constraint
  // violation becomes a 4xx/5xx envelope with a specific code instead
  // of a generic INTERNAL_ERROR 500. Without this hook every Drizzle
  // throw against an un-migrated table surfaces as 500 in the smoke
  // matrix.
  const mapped = mapSqlError(err);
  if (mapped) {
    return {
      status: mapped.status,
      body: {
        error: {
          code: mapped.code,
          message: mapped.message,
          ...(requestId !== undefined ? { requestId } : {}),
        },
      },
    };
  }

  const isProd = process.env.NODE_ENV === 'production';
  const message =
    !isProd && err instanceof Error && err.message
      ? err.message
      : 'Unexpected server error';

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message,
        ...(requestId !== undefined ? { requestId } : {}),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Hono onError handler
// ---------------------------------------------------------------------------

export function createHonoErrorHandler(logger: pino.Logger) {
  // Returns Hono's Response (global Response), not Express's Response.
  return (err: Error, c: Context) => {
    const requestId = c.get('requestId') as string | undefined;
    const { status, body } = buildEnvelope(err, requestId);
    const skipScrub = c.get('skipScrub') as boolean | undefined;
    const scrubbed = scrubIfNotOptedOut(body, skipScrub) as ErrorEnvelopeBody;
    logger.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        requestId,
        path: c.req.path,
      },
      'hono error envelope'
    );
    return c.json(scrubbed, status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500);
  };
}

// ---------------------------------------------------------------------------
// Express error middleware
// ---------------------------------------------------------------------------

export function createExpressErrorHandler(logger: pino.Logger) {
  return (err: Error, req: Request, res: Response, _next: NextFunction): void => {
    const requestId = (req as Request & { requestId?: string }).requestId;
    const { status, body } = buildEnvelope(err, requestId);
    // Express doesn't carry the Hono `skipScrub` flag; default to scrub.
    const scrubbed = scrubIfNotOptedOut(body, false) as ErrorEnvelopeBody;
    logger.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        requestId,
        path: req.originalUrl ?? req.url,
      },
      'express error envelope'
    );
    res.status(status).json(scrubbed);
  };
}
