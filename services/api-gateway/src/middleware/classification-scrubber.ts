/**
 * Classification scrubber — strip RESTRICTED / CONFIDENTIAL field values
 * before they leave the gateway via log records, error envelopes, or
 * accidental response leaks.
 *
 * The per-FIELD classification registry lives in
 * `packages/database/src/security/data-classification.ts`. Until this
 * middleware was introduced the registry had ZERO call sites — logs +
 * error envelopes happily leaked `customers.phone`, `payments.mpesa_phone`,
 * etc. as raw values whenever a stack-trace or error.message included
 * the payload.
 *
 * Contract
 * ────────
 *   `scrubPayload(payload, options?)`
 *     - Walks the input recursively.
 *     - For each object key, if the key matches a registered
 *       (table, column) at RESTRICTED level, the value is replaced via
 *       `maskValue(...)`. CONFIDENTIAL fields are also masked unless
 *       the caller opts-in to verbose mode.
 *     - Non-PII keys are passed through unchanged.
 *     - Arrays / nested objects are walked depth-first; the input is
 *       NEVER mutated. Every node is a fresh object.
 *
 *   `createClassificationScrubber()`
 *     - Returns the middleware. Routes that NEED raw values (DSAR
 *       export, owner-statement render) set `c.set('skipScrub', true)`
 *       to opt out.
 *
 * Reach
 * ─────
 * Two integration sites:
 *   1. Error envelope (`error-envelope.ts`) — scrub before the response
 *      JSON is built so the body never carries raw PII.
 *   2. Structured logger (`utils/logger.ts`) — scrub the `meta` field
 *      of every log entry before it hits pino so log shipping doesn't
 *      stream raw PII to the indexer.
 *
 * Both call `scrubPayload` directly; the middleware factory is exposed
 * so future routers can opt in selectively.
 *
 * Performance
 * ───────────
 * The registry index is O(1) per (table, column) lookup. A single
 * payload of N keys at depth D is O(N · D); cheap relative to log /
 * response serialisation.
 *
 * Immutability
 * ────────────
 * Mutation is forbidden by user-policy. Every cloned object is a fresh
 * literal; arrays use `.map`; nothing is patched in-place.
 */

import {
  classify,
  maskValue,
  listClassifications,
} from '@borjie/database';

// `ClassificationLevelLiteral` + `FieldClassificationRecord` are re-exported through
// the database package's barrel which causes TS2709 (namespace-as-type
// widening) — same pattern as the `DatabaseClient` alias in
// service-registry.ts. Derive the types from the live `classify` /
// `listClassifications` return values so the barrel collision doesn't
// matter here.
type FieldClassificationRecord = NonNullable<ReturnType<typeof classify>>;
type ClassificationLevelLiteral = FieldClassificationRecord['level'];

// ─────────────────────────────────────────────────────────────────────
// Build a flat key set of "any column registered at RESTRICTED or
// (optionally) CONFIDENTIAL". We can't always know the source table at
// scrub time (logs flatten the structure), so we maintain a
// COLUMN-NAME → MAX-LEVEL index. When the scrubber sees a key that
// matches any registered RESTRICTED column, it masks. This is the
// fail-closed default for blind log records.
// ─────────────────────────────────────────────────────────────────────

interface ColumnIndex {
  readonly byColumn: ReadonlyMap<string, FieldClassificationRecord>;
}

function buildColumnIndex(): ColumnIndex {
  const map = new Map<string, FieldClassificationRecord>();
  for (const entry of listClassifications()) {
    const existing = map.get(entry.column.toLowerCase());
    // Pick the highest-sensitivity record for the column. RESTRICTED >
    // CONFIDENTIAL > INTERNAL > PUBLIC.
    if (!existing || rank(entry.level) > rank(existing.level)) {
      map.set(entry.column.toLowerCase(), entry);
    }
  }
  return { byColumn: map };
}

function rank(level: ClassificationLevelLiteral): number {
  switch (level) {
    case 'RESTRICTED':
      return 3;
    case 'CONFIDENTIAL':
      return 2;
    case 'INTERNAL':
      return 1;
    case 'PUBLIC':
      return 0;
    default:
      return 0;
  }
}

let cachedIndex: ColumnIndex | null = null;
function getColumnIndex(): ColumnIndex {
  if (!cachedIndex) cachedIndex = buildColumnIndex();
  return cachedIndex;
}

// ─────────────────────────────────────────────────────────────────────
// Public scrubber.
// ─────────────────────────────────────────────────────────────────────

export interface ScrubOptions {
  /**
   * When true (default), also mask CONFIDENTIAL fields. When false the
   * scrubber masks only RESTRICTED — leaves CONFIDENTIAL values intact.
   */
  readonly maskConfidential?: boolean;
  /**
   * Table hint — when set, the scrubber prefers the (table, column)
   * lookup over the column-only index. Useful for DSAR previews where
   * the source table is known.
   */
  readonly tableHint?: string;
}

/**
 * Mask a value snippet using the registered classification for the
 * given column. Returns the original value if the column is not
 * registered or the level falls below the masking threshold.
 */
export function scrubField(
  column: string,
  value: unknown,
  options: ScrubOptions = {},
): unknown {
  if (value === null || value === undefined) return value;
  if (!column || typeof column !== 'string') return value;
  const maskConfidential = options.maskConfidential ?? true;

  const hit = options.tableHint
    ? classify(options.tableHint, column)
    : getColumnIndex().byColumn.get(column.toLowerCase()) ?? null;

  if (!hit) return value;

  if (hit.level === 'RESTRICTED') {
    return maskValue(value, hit);
  }
  if (hit.level === 'CONFIDENTIAL' && maskConfidential) {
    return maskValue(value, hit);
  }
  return value;
}

/**
 * Walk a payload recursively and mask every RESTRICTED / CONFIDENTIAL
 * column value. Returns a NEW object — never mutates the input.
 *
 * `null` / `undefined` / primitive inputs pass through unchanged so
 * callers can `scrubPayload(maybeMeta)` without a defensive guard.
 */
export function scrubPayload(payload: unknown, options: ScrubOptions = {}): unknown {
  return scrubInner(payload, options, 0);
}

const MAX_DEPTH = 12;

function scrubInner(node: unknown, options: ScrubOptions, depth: number): unknown {
  if (depth > MAX_DEPTH) return node;
  if (node === null || node === undefined) return node;
  if (typeof node !== 'object') return node;

  if (Array.isArray(node)) {
    return node.map((item) => scrubInner(item, options, depth + 1));
  }

  // Object — walk keys, mask any registered column.
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    // Nested objects / arrays recurse first so deeply-nested PII still
    // gets masked even if its parent key is not registered.
    const recurseValue =
      value !== null && typeof value === 'object'
        ? scrubInner(value, options, depth + 1)
        : value;
    out[key] = scrubField(key, recurseValue, options);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Hono middleware wrapper — sits in the chain so subsequent handlers
// see `c.get('skipScrub')` and can opt out.
// ─────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory';

export function createClassificationScrubberMiddleware() {
  return createMiddleware(async (c, next) => {
    // Opt-out gate — DSAR export / owner statement render set this so
    // the scrubber does NOT strip RESTRICTED values from their
    // responses. Default is to scrub.
    if (c.get('skipScrub') === undefined) {
      c.set('skipScrub', false);
    }
    await next();
  });
}

/**
 * Convenience helper for the error envelope + logger sites. Returns
 * the input unchanged when `skipScrub` is truthy.
 */
export function scrubIfNotOptedOut(
  payload: unknown,
  skipScrub: boolean | undefined,
  options: ScrubOptions = {},
): unknown {
  if (skipScrub === true) return payload;
  return scrubPayload(payload, options);
}
