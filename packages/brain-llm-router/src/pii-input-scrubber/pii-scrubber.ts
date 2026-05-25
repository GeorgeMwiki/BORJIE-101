/**
 * PII egress scrubber — 3-stage cascade.
 *
 * Ported from LITFIN `claude-service.safeText` + `safePayload` +
 * the brand-redact / pii-scrub / presidio-scrub helpers.
 *
 * Stages:
 *   1. BRAND REDACT — competitor brand names → "[REDACTED_BRAND]"
 *      (e.g. names of competing property-management platforms).
 *   2. PII REGEX — emails, phones, national IDs, credit cards.
 *   3. PRESIDIO — pluggable Microsoft Presidio adapter for ML-based
 *      entity recognition (PERSON, LOCATION, ORG, IBAN, etc.).
 *      Default adapter is a no-op so this package is pure-TS.
 *
 * Both stages 1 and 3 are pluggable via `setPiiScrubberConfig()`. The
 * defaults are safe: stage 1 is a small built-in list, stage 3 is a
 * no-op (callers can wire a real Presidio sidecar via setPiiScrubberConfig).
 *
 * `safePayload<T>(value)` walks ANY structured value recursively (with
 * a depth cap of 8 and a circular-ref guard via a WeakSet) and scrubs
 * every string leaf in place — without mutating the original (returns
 * a new value of the same shape).
 */

import { scrubPiiText } from './pii-patterns.js';

// ──────────────────────────── Types ────────────────────────────────

export type BrandRedactor = (input: string) => string;
export type PiiScrubber = (input: string) => string;
export type PresidioScrubber = (input: string) => string;

export interface PiiScrubberConfig {
  readonly brandRedactor?: BrandRedactor;
  readonly piiScrubber?: PiiScrubber;
  readonly presidioScrubber?: PresidioScrubber;
}

// ─────────────────────── Default brand redactor ────────────────────

const DEFAULT_BRAND_TERMS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly replacement: string;
}> = Object.freeze([
  // Common competing property-management platforms — keep this list
  // minimal; ops can extend via setPiiScrubberConfig.
  { pattern: /\b(?:AppFolio|Buildium|Yardi|RealPage|Entrata)\b/gi, replacement: '[REDACTED_BRAND]' },
]);

function defaultBrandRedact(input: string): string {
  if (!input) return input;
  let out = input;
  for (const t of DEFAULT_BRAND_TERMS) {
    out = out.replace(t.pattern, t.replacement);
  }
  return out;
}

function defaultPresidioScrubber(input: string): string {
  // No-op default. Composition root may wire a real Presidio sidecar.
  return input;
}

// ───────────────────────── Active config ───────────────────────────

let activeConfig: Required<PiiScrubberConfig> = {
  brandRedactor: defaultBrandRedact,
  piiScrubber: scrubPiiText,
  presidioScrubber: defaultPresidioScrubber,
};

export function setPiiScrubberConfig(config: PiiScrubberConfig): void {
  activeConfig = {
    brandRedactor: config.brandRedactor ?? defaultBrandRedact,
    piiScrubber: config.piiScrubber ?? scrubPiiText,
    presidioScrubber: config.presidioScrubber ?? defaultPresidioScrubber,
  };
}

export function resetPiiScrubberConfig(): void {
  activeConfig = {
    brandRedactor: defaultBrandRedact,
    piiScrubber: scrubPiiText,
    presidioScrubber: defaultPresidioScrubber,
  };
}

// ─────────────────────────── Public API ───────────────────────────

/**
 * Scrub a single text string through the 3-stage cascade.
 *
 * Order:
 *   1. brand redact
 *   2. PII regex
 *   3. Presidio (no-op by default)
 *
 * Idempotent: calling this twice on the same input yields the same
 * output. Safe to call on every string crossing the LLM boundary.
 */
export function safeText(input: string): string {
  if (typeof input !== 'string' || !input) return input;
  let out = activeConfig.brandRedactor(input);
  out = activeConfig.piiScrubber(out);
  out = activeConfig.presidioScrubber(out);
  return out;
}

const MAX_DEPTH = 8;

/**
 * Walk a structured value and scrub every string leaf via `safeText`.
 * Returns a new value of the same shape (immutable). Depth-capped at 8
 * with a WeakSet circular-ref guard.
 *
 * - `string`        → `safeText(value)`
 * - `Array`         → new array with scrubbed leaves
 * - plain `Object`  → new object with scrubbed leaves
 * - `Date`/`RegExp` → returned as-is (no leak surface)
 * - other primitives → returned as-is
 */
export function safePayload<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;
  return walk(value, depth, new WeakSet<object>()) as T;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') return safeText(value);
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value;
  if (value instanceof RegExp) return value;
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) {
    // Don't walk into Map/Set keys/values; treat as opaque.
    return value;
  }
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, depth + 1, seen));
  }
  // Plain object
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = walk(v, depth + 1, seen);
  }
  return out;
}
