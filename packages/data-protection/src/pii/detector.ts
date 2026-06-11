/**
 * Hybrid PII detector (DP-03) — regex first-pass + NER second-pass.
 *
 * The existing classifiers (`classify/auto-tagger.ts`, the Pino redactor)
 * match on FIELD NAMES — they are blind to PII embedded in free-text VALUES
 * (a person's name inside `kyc_notes`, a phone number inside a transcript).
 * That free text can leak to a cloud LLM. This module detects PII in the
 * VALUE, the way Microsoft Presidio does: a deterministic regex pass that
 * never misses structured IDs, UNION a context-aware NER pass (an injected
 * `PiiAnalyzerPort` — a Presidio-compatible sidecar in prod) for PERSON /
 * LOCATION / ORG that regex cannot catch.
 *
 * Fail-closed degrade: when the NER port is absent or throws, we fall back
 * to the regex tier only (still strips phones / emails / national IDs). The
 * caller's classification still forces RESTRICTED → local-only for cloud
 * egress, so an unreachable NER never downgrades to plaintext egress.
 *
 * Tokenisation / redaction is reversible: every span maps to a stable
 * placeholder so a downstream response can be restored, and the Pino
 * redactor + audit path consume `redactPii(...)` directly.
 *
 * Pure leaf: no `process.env`, no network, no DB. The sidecar URL + client
 * are injected by composition.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/** Entity categories we recognise. NER adds PERSON/LOCATION/ORG. */
export type PiiEntityType =
  | 'EMAIL'
  | 'PHONE'
  | 'NATIONAL_ID'
  | 'TIN'
  | 'CREDIT_CARD'
  | 'IP_ADDRESS'
  | 'PERSON'
  | 'LOCATION'
  | 'ORG';

/** A detected span in the source text. */
export interface PiiSpan {
  readonly type: PiiEntityType;
  /** Inclusive start offset in the source string. */
  readonly start: number;
  /** Exclusive end offset. */
  readonly end: number;
  /** The matched text. */
  readonly text: string;
  /** Detection confidence in [0,1]. Regex = high; NER = port-supplied. */
  readonly score: number;
  /** 'regex' | 'ner' — provenance for audit. */
  readonly source: 'regex' | 'ner';
}

/**
 * NER analyzer PORT — a Presidio-compatible sidecar conforms to this. The
 * data-protection package never imports spaCy / a transformer; composition
 * injects an HTTP client. `analyze` returns spans for free-text entity types.
 */
export interface PiiAnalyzerPort {
  analyze(input: {
    readonly text: string;
    /** Minimum confidence to return. */
    readonly threshold?: number;
  }): Promise<ReadonlyArray<PiiSpan>>;
}

// ---------------------------------------------------------------------------
// Regex tier — high-precision, deterministic, never misses a structured ID.
// ---------------------------------------------------------------------------

interface RegexRule {
  readonly type: PiiEntityType;
  readonly re: RegExp;
  readonly score: number;
  /** Optional extra validator (e.g. Luhn for cards). */
  readonly valid?: (m: string) => boolean;
}

function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Patterns are jurisdiction-neutral in shape but cover the common East-
// African IDs Borjie ingests (NIDA = 20 digits often hyphenated; TIN = 9
// digits). The bounds are anchored to avoid ReDoS.
const REGEX_RULES: ReadonlyArray<RegexRule> = Object.freeze([
  {
    type: 'EMAIL',
    re: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}/g,
    score: 0.99,
  },
  {
    // E.164-ish: optional +, country/area, 7–14 digits with separators.
    type: 'PHONE',
    re: /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3}[\s-]?\d{3,4}\b/g,
    score: 0.7,
    valid: (m) => m.replace(/\D/g, '').length >= 9,
  },
  {
    // NIDA — 20 digits, commonly grouped 8-5-5-2 with hyphens.
    type: 'NATIONAL_ID',
    re: /\b\d{8}[- ]?\d{5}[- ]?\d{5}[- ]?\d{2}\b/g,
    score: 0.97,
  },
  {
    // TIN — 9 digits, commonly grouped 3-3-3.
    type: 'TIN',
    re: /\b\d{3}[- ]?\d{3}[- ]?\d{3}\b/g,
    score: 0.8,
  },
  {
    type: 'CREDIT_CARD',
    re: /\b(?:\d[ -]?){13,19}\b/g,
    score: 0.9,
    valid: luhnValid,
  },
  {
    type: 'IP_ADDRESS',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    score: 0.85,
  },
]);

/** Detect structured PII via the regex tier only (synchronous, no I/O). */
export function detectRegexSpans(text: string): ReadonlyArray<PiiSpan> {
  if (typeof text !== 'string' || text.length === 0) return [];
  const spans: PiiSpan[] = [];
  for (const rule of REGEX_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const matched = m[0];
      if (matched.length === 0) {
        re.lastIndex += 1;
        continue;
      }
      if (rule.valid && !rule.valid(matched)) continue;
      spans.push(
        Object.freeze({
          type: rule.type,
          start: m.index,
          end: m.index + matched.length,
          text: matched,
          score: rule.score,
          source: 'regex' as const,
        }),
      );
    }
  }
  return spans;
}

// ---------------------------------------------------------------------------
// Hybrid detector — regex ∪ NER, with overlap resolution.
// ---------------------------------------------------------------------------

export interface PiiDetectorDeps {
  /** Optional NER analyzer. Absent → regex-only (degraded but safe). */
  readonly analyzer?: PiiAnalyzerPort;
  /** Min confidence the NER tier must clear. Default 0.5. */
  readonly nerThreshold?: number;
}

export interface PiiDetector {
  /** Detect all PII spans (regex ∪ NER), de-overlapped, sorted by start. */
  detect(text: string): Promise<ReadonlyArray<PiiSpan>>;
  /** Regex-only spans, no I/O — for the synchronous Pino redactor path. */
  detectSync(text: string): ReadonlyArray<PiiSpan>;
}

/**
 * Merge regex + NER spans, dropping any span fully contained inside a
 * higher-confidence one (regex IDs win over a fuzzy NER PERSON that overlaps
 * a phone, etc.). Sorted by start offset for deterministic redaction.
 */
function mergeSpans(
  regex: ReadonlyArray<PiiSpan>,
  ner: ReadonlyArray<PiiSpan>,
): ReadonlyArray<PiiSpan> {
  const all = [...regex, ...ner].sort(
    (a, b) => a.start - b.start || b.score - a.score,
  );
  const kept: PiiSpan[] = [];
  for (const span of all) {
    const overlaps = kept.some(
      (k) => span.start < k.end && k.start < span.end,
    );
    if (!overlaps) kept.push(span);
  }
  return Object.freeze(kept.sort((a, b) => a.start - b.start));
}

export function createPiiDetector(deps: PiiDetectorDeps = {}): PiiDetector {
  const threshold = deps.nerThreshold ?? 0.5;

  function detectSync(text: string): ReadonlyArray<PiiSpan> {
    return detectRegexSpans(text);
  }

  async function detect(text: string): Promise<ReadonlyArray<PiiSpan>> {
    const regex = detectRegexSpans(text);
    if (!deps.analyzer || typeof text !== 'string' || text.length === 0) {
      return regex;
    }
    let ner: ReadonlyArray<PiiSpan> = [];
    try {
      ner = await deps.analyzer.analyze({ text, threshold });
    } catch {
      // Fail-closed degrade: NER unreachable → regex-only. The caller's
      // classification still forces RESTRICTED handling, so no plaintext
      // egress results from a missing NER hit.
      ner = [];
    }
    return mergeSpans(regex, ner);
  }

  return Object.freeze({ detect, detectSync });
}

/**
 * Stable, tenant-scoped placeholder for a span — reversible via the returned
 * mapping. Format: `[PII:<TYPE>:<8-hex>]`. The hex is a salted digest so the
 * SAME (tenant, type, value) yields the SAME token (consistent redaction
 * across a document) without exposing the value.
 */
export function placeholderFor(
  tenantId: string,
  span: Pick<PiiSpan, 'type' | 'text'>,
): string {
  const digest = bytesToHex(
    sha256(utf8ToBytes(`${tenantId}:${span.type}:${span.text}`)),
  ).slice(0, 8);
  return `[PII:${span.type}:${digest}]`;
}
