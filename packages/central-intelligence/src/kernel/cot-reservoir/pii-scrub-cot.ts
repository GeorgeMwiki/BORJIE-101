/**
 * CoT persist-boundary PII scrubber — Phase D / D3.
 *
 * The kernel persists sampled chain-of-thought to `kernel_cot_reservoir`
 * for audit replay. The on-disk text MUST be free of subject-identifying
 * PII so a DSAR (Data-Subject Access Request) can release / redact CoT
 * without leaking model-internal reasoning containing third-party data.
 *
 * This module is a *persist-boundary* scrub layered on top of:
 *
 *   - the existing `scrubCotText` (../cot-reservoir.ts) which covers
 *     the Tanzania / Kenya pattern set + the optional Wave-K Tier-3
 *     extended set (Luhn-validated cards, IBAN, US SSN, UK NI, GPS).
 *   - a NEW set of CoT-specific patterns that aren't user-facing PII
 *     but ARE compliance-relevant:
 *
 *       1. Model-call URLs   (`anthropic.com`, `api.openai.com`, …)
 *       2. API-key shapes    (`sk-ant-…`, `sk-…`, `pk-…`, bearer tokens)
 *       3. M-Pesa transaction IDs (`MPESA[A-Z0-9]{8,10}` — the actual
 *          confirmation code returned to a payer; PII per Tanzania PDPA
 *          when paired with a phone number).
 *       4. Anthropic / OpenAI model-named entities surfaced in CoT
 *          (`claude-opus-…`, `gpt-4o-…`) — not PII, but redacted so the
 *          regulator-facing dump does not leak internal model selection.
 *
 * Pure; idempotent (placeholders are not re-matched). Returns the
 * scrubbed text plus the list of redaction categories that fired so
 * the caller can write an audit row enumerating what was removed.
 *
 * IMPORTANT — this module does NOT replace the existing
 * `kernel_cot_reservoir.thoughtText` storage path. The in-memory
 * reservoir keeps writing the already-scrubbed value via
 * `createCotReservoir`. This module exists for the persist-boundary
 * callers that emerged in Phase D:
 *
 *   - `services/api-gateway` `GET /api/v1/cot/query` (regulator surface)
 *   - `services/consolidation-worker` stage 04b CoT → reflexion distill
 */

import { scrubCotText } from '../cot-reservoir.js';

// ─────────────────────────────────────────────────────────────────────
// CoT-specific patterns. Each entry is `kind` + global regex +
// replacement. The patterns are intentionally narrow so they never
// match unrelated noun phrases or unit identifiers.
// ─────────────────────────────────────────────────────────────────────

interface CotSpecificPattern {
  readonly kind: string;
  readonly re: RegExp;
  readonly replace: string;
}

const COT_SPECIFIC_PATTERNS: ReadonlyArray<CotSpecificPattern> = [
  // 1) Anthropic / OpenAI / common LLM-provider URLs in CoT. The
  //    regex is anchored on the host substring so unrelated mentions
  //    of the word "anthropic" in product copy are left alone.
  {
    kind: 'model-provider-url',
    re: /\bhttps?:\/\/(?:[a-z0-9-]+\.)*(?:anthropic\.com|openai\.com|api\.openai\.com|api\.anthropic\.com|cohere\.ai|together\.xyz|mistral\.ai)\b[^\s]*/gi,
    replace: '[redacted-model-url]',
  },
  // 2) Anthropic SK key shape — must come BEFORE the generic api-key
  //    pattern so the longer `sk-ant-…` token is consumed in one go.
  {
    kind: 'anthropic-key',
    re: /\bsk-ant-(?:api03-)?[A-Za-z0-9_-]{20,}\b/g,
    replace: '[redacted-api-key]',
  },
  // 3) Generic API-key shape — `sk-…`, `pk-…`, explicit `api-key=…` or
  //    `api_key=…` query strings, bearer tokens. The minimum length is
  //    pulled high enough (20+) to avoid clobbering product SKUs.
  {
    kind: 'api-key-generic',
    re: /\b(?:sk|pk)-[A-Za-z0-9_-]{20,}\b/g,
    replace: '[redacted-api-key]',
  },
  {
    kind: 'api-key-querystring',
    re: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key|bearer)[\s:=]+["']?[A-Za-z0-9_.-]{16,}["']?/gi,
    replace: '[redacted-api-key]',
  },
  // 4) M-Pesa transaction confirmation IDs. The Safaricom format is
  //    10-character alphanumeric uppercase, the Vodacom-TZ format is
  //    `MPESA` followed by 8-10 hex-style chars. We catch both via the
  //    common "looks-like-an-mpesa-confirmation" shape AND the
  //    `MPESA` prefix variant.
  {
    kind: 'mpesa-txn',
    re: /\bMPESA[A-Z0-9]{8,10}\b/g,
    replace: '[redacted-mpesa-txn]',
  },
  {
    kind: 'mpesa-txn-saf',
    // 10-character mixed alphanum — only redact when an "mpesa" /
    // "confirmation" / "ref" / "transaction" cue precedes within 30
    // chars (otherwise we'd shred any 10-char alphanum identifier).
    re: /\b(?:mpesa|m-pesa|confirmation|reference|ref|txn|transaction)[\s#:.-]{0,30}([A-Z]{2}[A-Z0-9]{8})\b/gi,
    replace: '[redacted-mpesa-txn]',
  },
  // 5) Model-named entities — `claude-3-opus-20240229`, `gpt-4o-2024-…`,
  //    `claude-opus-4-…`, `claude-sonnet-…`. Not PII, but the
  //    regulator-facing dump must not enumerate the internal model
  //    selection (proprietary). Matches the canonical model-id shape.
  {
    kind: 'model-name',
    re: /\b(?:claude-(?:opus|sonnet|haiku)?-?\d[\w.-]*|gpt-(?:4o|4|3\.5)[\w.-]*|o[13]-(?:preview|mini)[\w.-]*)\b/gi,
    replace: '[redacted-model-name]',
  },
];

// ─────────────────────────────────────────────────────────────────────
// Result shape — exposed so callers can write structured audit rows.
// ─────────────────────────────────────────────────────────────────────

export interface ScrubCotForPersistResult {
  /** The scrubbed text. Idempotent — running twice gives the same output. */
  readonly scrubbed: string;
  /** How many distinct redactions fired. Useful as a quick "did this leak?" metric. */
  readonly redactionCount: number;
  /** Distinct categories that triggered. Stable / sortable for audit comparison. */
  readonly categories: ReadonlyArray<string>;
}

/**
 * Persist-boundary scrub for CoT thought text.
 *
 *   1. Runs the established `scrubCotText` (regional PII baseline).
 *   2. Runs the CoT-specific pattern set added by Phase D.
 *
 * Returns the scrubbed text + the categories that fired. Pure;
 * idempotent; safe to call from request-path code.
 *
 * Empty / nullish input → empty result; never throws.
 */
export function scrubCotForPersist(text: string | null | undefined): ScrubCotForPersistResult {
  if (!text || text.length === 0) {
    return Object.freeze({
      scrubbed: '',
      redactionCount: 0,
      categories: Object.freeze([] as ReadonlyArray<string>),
    });
  }

  // Step 1 — regional baseline (existing module).
  const base = scrubCotText(text);
  // `mutations` are strings like "scrubbed:phone-tz"; strip the prefix
  // so the final category list is comparable to the CoT-specific kinds.
  const baseCategories = base.mutations.map((m) => m.replace(/^scrubbed:/, ''));

  // Step 2 — CoT-specific patterns.
  let scrubbed = base.sanitized;
  const specificCategories: string[] = [];
  for (const p of COT_SPECIFIC_PATTERNS) {
    if (p.re.test(scrubbed)) {
      scrubbed = scrubbed.replace(p.re, p.replace);
      specificCategories.push(p.kind);
    }
  }

  // De-duplicate + sort so the category list is stable for audit
  // comparison. (`Set` preserves insertion order; sort makes the
  // output deterministic across pattern reordering.)
  const allCategories = Array.from(new Set([...baseCategories, ...specificCategories])).sort();

  return Object.freeze({
    scrubbed,
    redactionCount: allCategories.length,
    categories: Object.freeze(allCategories),
  });
}

/**
 * Build a compact audit envelope for a single scrub event. Never
 * contains the redacted values themselves — only the categories +
 * counts so the audit log is itself PII-free.
 */
export function buildCotScrubAuditEnvelope(
  result: ScrubCotForPersistResult,
  context: { readonly thoughtId: string; readonly tenantId: string | null },
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    thoughtId: context.thoughtId,
    tenantId: context.tenantId,
    redactionCount: result.redactionCount,
    categories: result.categories,
  });
}
