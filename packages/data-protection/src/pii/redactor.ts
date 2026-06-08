/**
 * PII redaction + tokenisation (DP-03).
 *
 * Turns detector spans into:
 *   - a REDACTED string (reversible placeholder substitution) the Pino
 *     redactor + audit path write instead of raw PII,
 *   - a MAPPING (placeholder → original) so a downstream LLM response can be
 *     restored (the same reversible-token model the privacy-router uses),
 *   - a deep object redactor (`redactObject`) for structured log payloads.
 *
 * Substitution runs right-to-left so earlier offsets stay valid as we splice.
 *
 * Pure leaf: no `process.env`, no I/O.
 */

import {
  createPiiDetector,
  detectRegexSpans,
  placeholderFor,
  type PiiDetector,
  type PiiSpan,
} from './detector.js';

export interface RedactionResult {
  /** The text with every PII span replaced by a stable placeholder. */
  readonly redacted: string;
  /** placeholder → original value, for reversible restoration. */
  readonly mappings: ReadonlyMap<string, string>;
  /** The spans that were redacted (for the audit record). */
  readonly spans: ReadonlyArray<PiiSpan>;
}

/**
 * Substitute spans with placeholders. Spans must be non-overlapping (the
 * detector's merge guarantees this) — they are sorted + applied right-to-left
 * so offsets do not shift under us.
 */
export function applyRedaction(
  text: string,
  spans: ReadonlyArray<PiiSpan>,
  tenantId: string,
): RedactionResult {
  if (spans.length === 0) {
    return Object.freeze({
      redacted: text,
      mappings: new Map(),
      spans: Object.freeze([]),
    });
  }
  const ordered = [...spans].sort((a, b) => b.start - a.start); // right-to-left
  const mappings = new Map<string, string>();
  let out = text;
  for (const span of ordered) {
    const placeholder = placeholderFor(tenantId, span);
    mappings.set(placeholder, span.text);
    out = out.slice(0, span.start) + placeholder + out.slice(span.end);
  }
  return Object.freeze({
    redacted: out,
    mappings,
    spans: Object.freeze([...spans].sort((a, b) => a.start - b.start)),
  });
}

/**
 * Restore a redacted string (e.g. an LLM response that echoed placeholders)
 * back to the original values using a prior `RedactionResult.mappings`.
 */
export function restoreRedaction(
  text: string,
  mappings: ReadonlyMap<string, string>,
): string {
  let out = text;
  for (const [placeholder, original] of mappings) {
    out = out.split(placeholder).join(original);
  }
  return out;
}

/**
 * Synchronous, regex-only redaction — the shape the Pino redactor consumes.
 * No NER (it cannot block the log hot path on a sidecar), but still strips
 * every structured ID (phone / email / NIDA / TIN / card / IP).
 */
export function redactPiiSync(text: string, tenantId = 'platform'): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  return applyRedaction(text, detectRegexSpans(text), tenantId).redacted;
}

/**
 * Full async redaction (regex ∪ NER). Use on the audit / egress path where
 * the NER round-trip is acceptable. Returns the reversible mapping.
 */
export async function redactPii(
  text: string,
  tenantId: string,
  detector?: PiiDetector,
): Promise<RedactionResult> {
  const det = detector ?? createPiiDetector();
  const spans = await det.detect(text);
  return applyRedaction(text, spans, tenantId);
}

/**
 * Deep-redact a structured payload for the log / audit sink. Every string
 * value is regex-redacted in place (immutably — new objects, never mutate).
 * Arrays + nested objects recurse; non-string leaves pass through. A depth
 * cap prevents pathological recursion on cyclic-ish payloads.
 */
export function redactObject<T>(value: T, tenantId = 'platform', depth = 6): T {
  if (depth <= 0) return value;
  if (typeof value === 'string') {
    return redactPiiSync(value, tenantId) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactObject(v, tenantId, depth - 1)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactObject(v, tenantId, depth - 1);
    }
    return out as T;
  }
  return value;
}
