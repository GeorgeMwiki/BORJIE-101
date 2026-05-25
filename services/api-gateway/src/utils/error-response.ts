/**
 * Canonical error response helper for the api-gateway.
 *
 * Background: deep-audit 2026-05-20 (HIGH) — the gateway emits FOUR different
 * error envelope shapes today, which means clients can't write a single parser:
 *
 *   1) `{ error: 'string' }`
 *   2) `{ error: { code, message } }`
 *   3) `{ success: false, error: 'string' }`
 *   4) `{ success: false, error: { code, message } }`
 *
 * This module is the single source of truth for shape (4). All new routes must
 * use `errorResponse` (or the e4xx/e5xx builders) — never `c.json({ error: ... })`
 * directly. An optional ESLint rule at `eslint-rules/no-raw-error-response.js`
 * enforces this on CI.
 *
 * Canonical shape (ApiErrorResponse):
 * ```ts
 * {
 *   success: false,
 *   error: {
 *     code: string,                       // SCREAMING_SNAKE_CASE
 *     message: string,                    // user-safe; no stack traces
 *     details?: Record<string, unknown>,  // optional structured details
 *   },
 *   meta?: {
 *     requestId?: string,
 *     timestamp: string,                  // ISO 8601
 *   },
 * }
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  WARNING — `details` IS A LEAK PRIMITIVE
 * ─────────────────────────────────────────────────────────────────────────────
 *  NEVER pass raw `err` objects, raw DB rows, raw request bodies, or any
 *  object that may contain secrets, tokens, password hashes, internal IDs,
 *  filesystem paths, or stack traces to `details`.
 *
 *  `redactDetails()` is applied automatically by `errorResponse()` — it
 *  strips `Error` instances to `{ name, message }` only, drops any key
 *  matching /password|secret|token|key|cookie|auth|credential/i, caps
 *  object depth at 3, caps each string at 500 chars, and caps total
 *  serialized size at 8KB. It also dereferences circular refs.
 *
 *  This redaction is a defense-in-depth backstop, NOT a license to be
 *  sloppy: still pass only user-safe context (e.g., the field names that
 *  failed validation, the resource type that was missing). When in doubt,
 *  omit `details` entirely.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Note: the existing `error-envelope.ts` (Hono onError) and `safe-error.ts`
 * (catch-block helper) emit a slightly older shape without the top-level
 * `success: false` discriminant. They're intentionally untouched in this pass
 * — they fire from *centralized* middleware, so clients can hard-code their
 * shape. This helper covers the *per-route* `c.json({ error: ... })` sites
 * that drove the inconsistency.
 *
 * Refactored routes (canonical shape now in use):
 *  - users.hono.ts, work-orders.hono.ts, tenants.hono.ts, customers.ts
 *  - invoices.ts, maintenance.hono.ts, properties.ts, units.ts, leases.ts
 *  - payments.ts, vendors.hono.ts, hr.hono.ts, documents.hono.ts
 *  - notification-preferences.router.ts, autonomous-actions-audit.router.ts
 *  - compliance.router.ts, brain.hono.ts, migration.router.ts
 *  - document-render.router.ts, far.router.ts, exceptions.router.ts
 *  - workflows.router.ts, task-agents.router.ts, ai-native.router.ts
 *  - renewals.router.ts
 *
 * Remaining follow-ups (not in this pass — owned by other agents or lower priority):
 *  - K-followup: agent-certifications, ai-chat, admin-jarvis, admin-jarvis-stream,
 *    ai-costs, applications
 *  - M: eviction, payment-reversal/refund, account-deletion/gdpr/delete-account
 *  - Other agents: file-ingest, dynamic-sections, payouts, webhook routers
 *  - Lower-traffic routers: head-briefing, voice, prompt-rollout, training,
 *    liveblocks-auth, maintenance-taxonomy, lpms, classroom, gamification,
 *    unit-subdivision, metrics, negotiations, unit-components, public-marketing,
 *    notifications, interactive-reports, mcp, graph, task-agents, monthly-close,
 *    intelligence, audit-trail, persona-registry, letters, occupancy-timeline,
 *    cot-query, etc. — refactor in a follow-up sweep.
 */

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Canonical error response envelope. Every error response emitted by this
 * gateway should match this shape exactly so clients can write a single parser.
 */
export interface ApiErrorResponse {
  readonly success: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
  readonly meta?: {
    readonly requestId?: string;
    readonly timestamp: string;
  };
}

// ---------------------------------------------------------------------------
// redactDetails — defense-in-depth scrubber for the `details` leak primitive.
//
// Rules (in order):
//   1. Error instances collapse to { name, message } only — no stack, no cause.
//   2. Drop any key matching /password|secret|token|key|cookie|auth|credential/i
//      (case-insensitive).
//   3. Cap object depth at 3 (deeper levels become `'[depth-capped]'`).
//   4. Cap each string value at 500 chars (truncate + `'…'`).
//   5. Cap total serialized size at 8 KB. If exceeded, the whole `details`
//      object is replaced with `{ _redacted: 'details too large' }`.
//   6. Handle circular references — every revisited object becomes
//      `Symbol.for('redacted-circular')`.
//
// All immutable: never mutates the caller's input.
// ---------------------------------------------------------------------------

const REDACT_KEY_RE =
  /password|secret|token|key|cookie|auth|credential/i;
const MAX_DEPTH = 3;
const MAX_STRING_LEN = 500;
const MAX_TOTAL_BYTES = 8 * 1024;
const CIRCULAR_SENTINEL = Symbol.for('redacted-circular');

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clampString(s: string): string {
  if (s.length <= MAX_STRING_LEN) return s;
  return `${s.slice(0, MAX_STRING_LEN)}…`;
}

/**
 * Internal recursive scrubber. Walks the value tree and applies the
 * rules. The `ancestors` set tracks objects currently on the recursion
 * stack so that genuine cycles (back-edges) are detected while shared
 * sibling references are not.
 */
function scrub(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
): unknown {
  // Primitives — strings get clamped, everything else passes through.
  if (typeof value === 'string') return clampString(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'undefined'
  ) {
    return value;
  }

  // Functions and symbols — not safe to serialize; drop them.
  if (typeof value === 'function' || typeof value === 'symbol') {
    return '[unserializable]';
  }

  // Error instances — flatten to { name, message } only.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: clampString(value.message ?? ''),
    };
  }

  // From here on we're dealing with objects/arrays — check depth + circulars.
  if (depth >= MAX_DEPTH) return '[depth-capped]';

  const obj = value as object;
  if (ancestors.has(obj)) return CIRCULAR_SENTINEL;

  // Track ancestors on the recursion stack only — add before recursing,
  // remove after. This catches true back-edges without false-positive
  // hits on shared sibling subtrees.
  ancestors.add(obj);
  try {
    if (Array.isArray(value)) {
      return value.map((v) => scrub(v, depth + 1, ancestors));
    }

    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (REDACT_KEY_RE.test(k)) {
          out[k] = '[redacted]';
          continue;
        }
        out[k] = scrub(v, depth + 1, ancestors);
      }
      return out;
    }

    // Anything else (Map, Set, Date, Buffer, etc.) — stringify defensively.
    if (value instanceof Date) return value.toISOString();
    return '[unserializable]';
  } finally {
    ancestors.delete(obj);
  }
}

/**
 * Public-but-internal helper to scrub `details` before it crosses the wire.
 * Exported only for tests; route code should pass through `errorResponse`.
 *
 * Returns `undefined` when input is `undefined` (so the caller can omit
 * the key entirely rather than emit `"details": undefined`).
 */
export function redactDetails(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  if (details === null) return undefined;

  // First pass — scrub.
  const ancestors = new Set<object>();
  const scrubbed = scrub(details, 0, ancestors) as Record<string, unknown>;

  // Replace any circular sentinels with a string after the tree walk so
  // the output stays JSON-safe.
  const jsonSafe = JSON.parse(
    JSON.stringify(scrubbed, (_key, val) =>
      typeof val === 'symbol' && val === CIRCULAR_SENTINEL
        ? '[circular]'
        : typeof val === 'bigint'
          ? val.toString()
          : val,
    ),
  ) as Record<string, unknown>;

  // Second pass — total size guard.
  const serialized = JSON.stringify(jsonSafe);
  if (serialized.length > MAX_TOTAL_BYTES) {
    return { _redacted: 'details too large' };
  }

  return jsonSafe;
}

/**
 * Build a canonical error response from a Hono `Context`.
 *
 * Always returns the same shape regardless of status code. Picks up
 * `requestId` from `c.get('requestId')` if available, and stamps a UTC ISO
 * timestamp on every response.
 *
 * SECURITY: `details` is auto-redacted by `redactDetails()` before it
 * crosses the wire. See the WARNING block at the top of the file —
 * automatic redaction is a backstop, not a substitute for thoughtful
 * curation of what you pass in.
 */
export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  const requestId =
    (c.get('requestId') as string | undefined) ??
    (c.get('x-request-id') as string | undefined);

  const safeDetails = redactDetails(details);

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(safeDetails !== undefined ? { details: safeDetails } : {}),
    },
    meta: {
      ...(requestId !== undefined ? { requestId } : {}),
      timestamp: new Date().toISOString(),
    },
  };

  return c.json(body, status);
}

// ---------------------------------------------------------------------------
// Common-status builders
//
// Sugar over `errorResponse` for the statuses we emit most often. Callers
// should prefer these — they make grep-by-status simple and they bake in a
// sensible default `code` + `message` for status codes that almost always
// mean the same thing (401 = unauthenticated, 403 = forbidden, 404 = not found).
// ---------------------------------------------------------------------------

export function e400(
  c: Context,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return errorResponse(c, 400, code, message, details);
}

export function e401(
  c: Context,
  code: string = 'UNAUTHENTICATED',
  message: string = 'Authentication required',
): Response {
  return errorResponse(c, 401, code, message);
}

export function e403(
  c: Context,
  code: string = 'FORBIDDEN',
  message: string = 'Insufficient permissions',
): Response {
  return errorResponse(c, 403, code, message);
}

export function e404(
  c: Context,
  code: string = 'NOT_FOUND',
  message: string = 'Resource not found',
): Response {
  return errorResponse(c, 404, code, message);
}

export function e409(
  c: Context,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return errorResponse(c, 409, code, message, details);
}

export function e422(
  c: Context,
  code: string = 'VALIDATION_ERROR',
  message: string = 'Validation failed',
  details?: Record<string, unknown>,
): Response {
  return errorResponse(c, 422, code, message, details);
}

export function e429(
  c: Context,
  code: string = 'RATE_LIMITED',
  message: string = 'Too many requests',
  details?: Record<string, unknown>,
): Response {
  return errorResponse(c, 429, code, message, details);
}

export function e500(
  c: Context,
  code: string = 'INTERNAL_ERROR',
  message: string = 'Internal server error',
): Response {
  return errorResponse(c, 500, code, message);
}

export function e502(
  c: Context,
  code: string = 'BAD_GATEWAY',
  message: string = 'Upstream returned an invalid response',
): Response {
  return errorResponse(c, 502, code, message);
}

export function e503(
  c: Context,
  code: string,
  message: string,
): Response {
  return errorResponse(c, 503, code, message);
}

export function e504(
  c: Context,
  code: string = 'GATEWAY_TIMEOUT',
  message: string = 'Upstream timed out',
): Response {
  return errorResponse(c, 504, code, message);
}
