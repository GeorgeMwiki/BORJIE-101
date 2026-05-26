/**
 * PII redactor — applies the salted-hash pattern from
 * `packages/session-mirror/src/field-capture/pii-redactor.ts` to a
 * transcript fragment.
 *
 * The package does NOT depend on session-mirror directly (to keep the
 * dependency graph thin). Instead it accepts an injected `Hasher` port
 * that the production host wires to `sha256(salt:value)` and a small
 * `classifier` that runs the same regex set. The reference impl below
 * mirrors session-mirror's regexes verbatim so both layers agree on
 * what counts as PII.
 *
 * Pipeline ordering: redact BEFORE extract. The LLM never sees raw PII.
 * Citation: NIST SP 800-122 — Guide to Protecting the Confidentiality
 * of PII. https://csrc.nist.gov/publications/detail/sp/800-122/final.
 */

import type {
  PiiRedactorPort,
  PiiRedactArgs,
  RedactedSpan,
  RedactedText,
} from '../types.js';

export interface Hasher {
  /** Returns a hex digest. The salt is `tenant_id:source_session_id`. */
  hash(salt: string, value: string): Promise<string>;
}

export interface CreateRedactorDeps {
  readonly hasher: Hasher;
}

/**
 * The patterns mirror session-mirror's PII regexes — order matters
 * (more specific shapes first). The kinds aligned with PiiKind in
 * `packages/session-mirror/src/types.ts`.
 */
const PATTERNS: ReadonlyArray<{ kind: string; re: RegExp }> = [
  { kind: 'email', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { kind: 'nida', re: /\b\d{8}-\d{5}-\d{5}-\d{2}\b/g },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { kind: 'kra-pin', re: /\b[A-Z]\d{9}[A-Z]\b/gi },
  { kind: 'passport', re: /\b[A-Z]{1,2}\d{6,9}\b/g },
  { kind: 'tin', re: /\b\d{3}-?\d{3}-?\d{3}\b/g },
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded, no nested groups
  { kind: 'card', re: /(?:\d[ -]?){13,19}/g },
  { kind: 'phone', re: /\+?\d[\d\s().-]{6,18}\d/g },
  { kind: 'mpesa', re: /\b[A-Z0-9]{10}\b/g },
];

interface RawMatch {
  readonly kind: string;
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

/**
 * Build a PII redactor whose hashing port is injected by the host.
 * The production host injects a `crypto.subtle`-backed hasher; the
 * tests injects a deterministic stub.
 */
export function createPiiRedactor(deps: CreateRedactorDeps): PiiRedactorPort {
  return {
    async redact(args: PiiRedactArgs): Promise<RedactedText> {
      const matches = collectMatches(args.transcript);
      if (matches.length === 0) {
        return { text: args.transcript, redacted_spans: [] };
      }

      // Sort by start asc, then by length desc — when two patterns
      // overlap on the same byte range we keep the longest match.
      const sorted = [...matches].sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        return b.end - b.start - (a.end - a.start);
      });

      // Drop overlapping matches (keep first).
      const keep: RawMatch[] = [];
      let cursor = -1;
      for (const m of sorted) {
        if (m.start >= cursor) {
          keep.push(m);
          cursor = m.end;
        }
      }

      const salt = `${args.tenant_id}:${args.source_session_id}`;
      const spans: RedactedSpan[] = [];
      let outText = '';
      let written = 0;

      for (const m of keep) {
        outText += args.transcript.slice(written, m.start);
        const value_hash = await deps.hasher.hash(salt, m.value);
        const token = `[${m.kind.toUpperCase()}_HASH:${value_hash.slice(0, 12)}]`;
        const tokenStart = outText.length;
        outText += token;
        const tokenEnd = outText.length;
        spans.push({
          kind: m.kind,
          start: tokenStart,
          end: tokenEnd,
          value_hash,
        });
        written = m.end;
      }
      outText += args.transcript.slice(written);

      return { text: outText, redacted_spans: spans };
    },
  };
}

/**
 * Pure helper — exposed for unit tests. Scans the transcript with
 * every PATTERN regex, returns the union of hits.
 */
export function collectMatches(transcript: string): ReadonlyArray<RawMatch> {
  const hits: RawMatch[] = [];
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(transcript)) !== null) {
      const value = m[0];
      hits.push({
        kind: p.kind,
        start: m.index,
        end: m.index + value.length,
        value,
      });
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  return hits;
}

/**
 * Deterministic fallback hasher — DO NOT USE in production. Wired by
 * tests so the hash is stable across runs. The production host injects
 * a `crypto.subtle`-backed `sha256` implementation.
 */
export const stubHasher: Hasher = {
  async hash(salt: string, value: string): Promise<string> {
    const input = `${salt}::${value}`;
    let h = 5381;
    for (let i = 0; i < input.length; i += 1) {
      h = ((h << 5) + h + input.charCodeAt(i)) | 0;
    }
    return `stub${(h >>> 0).toString(16).padStart(8, '0')}`;
  },
};
