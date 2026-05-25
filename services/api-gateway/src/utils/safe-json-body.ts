/**
 * Safe JSON-body helper for Hono routes.
 *
 * Bug fix A-BUG-DEEP #15: replaces the `await c.req.json().catch(() => ({}))`
 * pattern scattered across ~12 routes. That swallow-and-default form
 * hides three different failure modes under one signal:
 *
 *   1. The client sent malformed JSON  (should be 400 INVALID_JSON).
 *   2. The client sent no body at all  (should be `{}` for optional-body
 *      routes, or 400 EMPTY_BODY for required-body ones).
 *   3. The body is a non-object (array / null / string).
 *
 * Two flavours:
 *
 *   - `safeJsonBody(c)`  — body is OPTIONAL; missing/empty → `{}`,
 *                          malformed → throws `JsonBodyError`.
 *   - `requireJsonBody(c)` — body is REQUIRED; missing/empty/malformed
 *                           → throws `JsonBodyError`.
 *
 * Both helpers throw a typed error that route handlers can map to a 400
 * via `routeCatch`/`scrubMessage`. Callers that still want the legacy
 * fall-back-to-empty behaviour can `try { ... } catch { body = {} }`
 * but most should let the 400 surface.
 */

import type { Context } from 'hono';

export type JsonBodyErrorCode = 'INVALID_JSON' | 'EMPTY_BODY' | 'NON_OBJECT_BODY';

export class JsonBodyError extends Error {
  readonly code: JsonBodyErrorCode;
  constructor(code: JsonBodyErrorCode, message: string) {
    super(message);
    this.name = 'JsonBodyError';
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse the request body. Treats a missing/empty body as `{}` (the
 * caller said the body was optional). Throws `JsonBodyError` with code
 * `INVALID_JSON` if the body is non-empty but un-parseable, or with
 * `NON_OBJECT_BODY` if it parses to a non-object.
 */
export async function safeJsonBody<T extends Record<string, unknown> = Record<string, unknown>>(
  c: Context,
): Promise<T> {
  const contentLengthHeader = c.req.header('content-length');
  if (contentLengthHeader && parseInt(contentLengthHeader, 10) === 0) {
    return {} as T;
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch (err) {
    // Hono surfaces a SyntaxError for malformed JSON.
    throw new JsonBodyError(
      'INVALID_JSON',
      err instanceof Error ? `Malformed JSON body: ${err.message}` : 'Malformed JSON body',
    );
  }
  if (raw === undefined || raw === null) {
    return {} as T;
  }
  if (!isPlainObject(raw)) {
    throw new JsonBodyError(
      'NON_OBJECT_BODY',
      'Request body must be a JSON object',
    );
  }
  return raw as T;
}

/**
 * Strict variant: empty/missing body is an error.
 */
export async function requireJsonBody<T extends Record<string, unknown> = Record<string, unknown>>(
  c: Context,
): Promise<T> {
  const body = await safeJsonBody<T>(c);
  if (Object.keys(body).length === 0) {
    throw new JsonBodyError('EMPTY_BODY', 'Request body is required');
  }
  return body;
}
