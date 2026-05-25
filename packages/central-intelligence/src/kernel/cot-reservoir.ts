/**
 * CoT reservoir — sampled chain-of-thought capture for audit replay.
 *
 * Storing every chain-of-thought is too expensive; storing none means
 * a regulator who later asks "why did the system say X?" gets nothing
 * to inspect. The reservoir is a probabilistic sample biased toward
 * high-stakes decisions:
 *
 *   stakes='low'      → 1% sample
 *   stakes='medium'   → 5% sample
 *   stakes='high'     → 50% sample
 *   stakes='critical' → 100% sample
 *
 * Wave-K parity update: every persisted sample is run through a
 * Tanzania/Kenya-aware PII scrubber BEFORE writing to the sink, and
 * SHA-256 hashes of the original prompt + sanitised response are
 * carried alongside the redacted text. Mirrors LITFIN
 * `cot-recorder.ts:35-78`.
 *
 * The sink interface is storage-agnostic; production binds to the
 * `cot_reservoir` Postgres table, tests use an in-memory recorder.
 */

import { createHash } from 'node:crypto';
import type { CotSample, CotReservoirSink, ThoughtRequest } from './kernel-types.js';
// A2b-2 wire #4 — persist-boundary scrub at the reservoir write
// path. The cycle with pii-scrub-cot.ts is safe under ESM because
// both consumers reference each other only via function-scoped calls
// (hoisted function declarations), not at module-evaluation time.
import { scrubCotForPersist } from './cot-reservoir/pii-scrub-cot.js';

const SAMPLE_RATES: Record<ThoughtRequest['stakes'], number> = {
  low: 0.01,
  medium: 0.05,
  high: 0.5,
  critical: 1.0,
};

export interface CotReservoirDeps {
  readonly sink: CotReservoirSink;
  /** Injectable RNG so tests can be deterministic. */
  readonly rng?: () => number;
}

export interface CotReservoirCaptureInput {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly stakes: ThoughtRequest['stakes'];
  readonly thoughtText: string | null;
  readonly capturedAt: string;
}

export interface CotReservoir {
  maybeCapture(input: CotReservoirCaptureInput): Promise<{ sampled: boolean }>;
}

// ─────────────────────────────────────────────────────────────────────
// PII scrubber — Tanzania/Kenya-aware. Mirrors policy-gate's PII_PATTERNS
// with the addition of KRA PIN, M-Pesa till/paybill shapes, and Kenyan
// national-ID (8 digits) which the policy-gate output redactor does
// NOT currently catch (output text is the user-facing surface and KRA
// PINs are not expected to be echoed there; CoT thought text, however,
// can contain anything the model "thought").
// ─────────────────────────────────────────────────────────────────────

interface PiiPattern {
  readonly kind: string;
  readonly re: RegExp;
  readonly replace: string;
}

const COT_PII_PATTERNS: ReadonlyArray<PiiPattern> = [
  { kind: 'phone-tz',   re: /\+?255[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/g, replace: '[redacted-phone]' },
  { kind: 'phone-ke',   re: /\+?254[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/g, replace: '[redacted-phone]' },
  // Formatted local mobile shape — REQUIRES a consistent separator
  // (e.g. `0712 345 678` or `0712-345-678`). Un-formatted 10-digit
  // strings (invoice numbers, internal IDs) no longer false-positive
  // here; bare-phone strings still get scrubbed via the cue-word
  // path below.
  { kind: 'phone-gen',  re: /\b0[67]\d{2}([\s-])\d{3}\1\d{3}\b/g,       replace: '[redacted-phone]' },
  { kind: 'email',      re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,  replace: '[redacted-email]' },
  { kind: 'nida-tz',    re: /\b\d{8}-\d{5}-\d{5}-\d{2}\b/g,             replace: '[redacted-nida]' },
  { kind: 'kra-pin',    re: /\b[A-Z]\d{9}[A-Z]\b/g,                     replace: '[redacted-kra-pin]' },
  // Kenyan national ID is a bare 8-digit number; only redact when it
  // appears with an "ID"/"NID" cue to avoid mauling unit-counts.
  { kind: 'id-ke',      re: /\b(?:ID|NID|National[\s-]?ID)[\s:.#-]*\d{8}\b/gi, replace: '[redacted-id]' },
  // M-Pesa till/paybill numbers — 5-7 digits typically prefixed by
  // "till", "paybill", or "M-Pesa".
  { kind: 'mpesa-till', re: /\b(?:till|paybill|M[-\s]?Pesa)[\s#:.-]*\d{5,7}\b/gi, replace: '[redacted-mpesa]' },
  // Cue-anchored bare 10-digit local mobile — only scrub when a phone
  // cue word ("phone", "tel", "call", "reach", "whatsapp", "mpesa",
  // "sms", "mobile", "cell") sits immediately before the number
  // (within ~30 chars of separator/punctuation). This restores
  // coverage for `phone: 0712345678` while keeping `INV-0712345678`
  // and bare invoice numbers intact. The cue word is consumed in the
  // match (same convention as `mpesa-till`).
  {
    kind: 'phone-cue',
    re: /\b(?:phone|tel(?:ephone)?|call|reach|whatsapp|mpesa|sms|mobile|cell(?:phone)?)[\s#:.\-]{0,30}0[67]\d{8}\b/gi,
    replace: '[redacted-phone]',
  },
];

// ─────────────────────────────────────────────────────────────────────
// Extended PII patterns (Wave-K Tier-3 W-Ops) — gated behind
// `BORJIE_PII_EXTENDED=1`. The default-off posture preserves the
// EAT-first baseline; operators flip the flag on when the surface
// goes global. Each pattern lives in its own validator so we can
// run a real check (e.g. Luhn for credit-cards, ISO-13616 for IBAN)
// instead of a permissive regex that would flag too many false-
// positives in property-management chat text.
// ─────────────────────────────────────────────────────────────────────

/**
 * Pure: passes/fails on the standard Luhn checksum. Mod-10 over the
 * digits with the second-from-right doubled (and >9 reduced). 13-19
 * digits is the published card-number length range (Visa, MasterCard,
 * Amex, Discover, JCB, Diners, UnionPay).
 */
export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let doub = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (doub) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doub = !doub;
  }
  return sum % 10 === 0;
}

/**
 * Pure: passes the ISO-13616 mod-97 IBAN check. Length varies by
 * country (15-34); we sanity-check the prefix is two letters + two
 * digits + a valid mod-97 remainder of 1.
 */
export function ibanValid(raw: string): boolean {
  const cleaned = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(cleaned)) return false;
  // Move first 4 chars to end and replace letters with 10..35.
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const val =
      code >= 48 && code <= 57
        ? code - 48
        : code >= 65 && code <= 90
          ? code - 55
          : -1;
    if (val < 0) return false;
    // Letters expand to 2 decimal digits (10..35) so we must shift the
    // running remainder by 100 (not 10) when consuming them. The
    // single-digit path shifts by 10. Avoids BigInt for the standard
    // string lengths.
    if (val >= 10) {
      remainder = (remainder * 100 + val) % 97;
    } else {
      remainder = (remainder * 10 + val) % 97;
    }
  }
  return remainder === 1;
}

interface ExtendedPiiPattern extends PiiPattern {
  /** Optional secondary check — regex match → validator filter. */
  readonly validate?: (matched: string) => boolean;
}

const COT_PII_PATTERNS_EXTENDED: ReadonlyArray<ExtendedPiiPattern> = [
  // Credit-card numbers — 13-19 digits with optional space/dash
  // groupings. The regex is intentionally permissive (catch any 13-19
  // digit run); the Luhn validator filters the noise. Numbers under
  // 13 digits stay un-redacted because legitimate property numbers
  // (lease IDs, invoice numbers) routinely sit in the 10-12 range.
  {
    kind: 'credit-card-luhn',
    re: /\b(?:\d[\s-]?){12,18}\d\b/g,
    replace: '[redacted-card]',
    validate: luhnValid,
  },
  // IBAN — country-code (2 letters) + check-digits (2) + BBAN (up to
  // 30 alphanum). The mod-97 validator filters away strings that
  // happen to LOOK iban-shaped.
  {
    kind: 'iban',
    re: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g,
    replace: '[redacted-iban]',
    validate: ibanValid,
  },
  // US SSN — `\d{3}-\d{2}-\d{4}`. Negative look-arounds skip the
  // sentinel 000-/666-/9xx- prefixes the SSA never assigns and
  // skip strings that are part of a longer digit run (zipcode-
  // extension dashes).
  {
    kind: 'ssn-us',
    re: /(?<!\d)(?!000-|666-|9\d{2}-)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)/g,
    replace: '[redacted-ssn]',
  },
  // UK National Insurance — two letters, six digits, one letter.
  // Excludes the never-issued prefixes (D, F, I, Q, U, V at any
  // position; O at the second position). Practical heuristic only —
  // a full HMRC validator would also exclude administrative
  // sequences.
  {
    kind: 'ni-uk',
    re: /\b[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]\b/g,
    replace: '[redacted-ni]',
  },
  // GPS coordinates — `lat,lng` with both numbers in their valid
  // ranges (lat ∈ [-90,90], lng ∈ [-180,180]). Decimal degrees only;
  // DMS notation is left as a future extension.
  //
  // We match the regex permissively and let the `validate` callback
  // enforce the range — easier to reason about than 4 alternations.
  {
    kind: 'gps-coords',
    re: /(?<![\d.])-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?(?!\d)/g,
    replace: '[redacted-gps]',
    validate: (match: string) => {
      // Split on the first comma; both halves must be parseable +
      // within the latitude / longitude ranges.
      const commaIdx = match.indexOf(',');
      if (commaIdx <= 0) return false;
      const lat = Number(match.slice(0, commaIdx).trim());
      const lng = Number(match.slice(commaIdx + 1).trim());
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      if (lat < -90 || lat > 90) return false;
      if (lng < -180 || lng > 180) return false;
      return true;
    },
  },
];

/**
 * Whether the extended pattern set is enabled. Read on each call so a
 * test can flip the env var inside its setup. The pattern array stays
 * frozen at module load — only the gate is dynamic.
 */
export function extendedPiiEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.BORJIE_PII_EXTENDED?.trim();
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'yes';
}

/**
 * Best-effort scrub of CoT thought text. Pure; idempotent. Returns
 * `{ sanitized, mutations }` so callers can log which categories fired
 * without needing to re-run the regexes.
 *
 * When the `BORJIE_PII_EXTENDED` env var is truthy, the extended
 * pattern set (credit-card with Luhn, IBAN with mod-97, US SSN, UK NI,
 * GPS coords) runs after the EAT-focused baseline. Default off
 * preserves the EAT-first posture.
 */
export function scrubCotText(input: string): {
  readonly sanitized: string;
  readonly mutations: ReadonlyArray<string>;
} {
  let text = input;
  const mutations: string[] = [];
  for (const p of COT_PII_PATTERNS) {
    if (p.re.test(text)) {
      text = text.replace(p.re, p.replace);
      mutations.push(`scrubbed:${p.kind}`);
    }
  }
  if (extendedPiiEnabled()) {
    for (const p of COT_PII_PATTERNS_EXTENDED) {
      if (p.validate) {
        // Validator gating: only redact matches that pass the
        // checksum / structural validator. Pure: a replace with a
        // function callback keeps the regex stateless across calls.
        let fired = false;
        text = text.replace(p.re, (match) => {
          if (p.validate!(match)) {
            fired = true;
            return p.replace;
          }
          return match;
        });
        if (fired) mutations.push(`scrubbed:${p.kind}`);
      } else if (p.re.test(text)) {
        text = text.replace(p.re, p.replace);
        mutations.push(`scrubbed:${p.kind}`);
      }
    }
  }
  return { sanitized: text, mutations };
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function createCotReservoir(deps: CotReservoirDeps): CotReservoir {
  const rng = deps.rng ?? Math.random;
  return {
    async maybeCapture(input) {
      if (!input.thoughtText) return { sampled: false };
      const rate = SAMPLE_RATES[input.stakes];
      if (rng() >= rate) return { sampled: false };
      // A2b-2 wire #4 — persist-boundary scrub. Covers the regional
      // PII baseline AND the Phase-D categories (API keys, model URLs,
      // M-Pesa confirmation IDs, model-named entities). Replaces the
      // capture-only `scrubCotText` so writes never land raw secrets.
      const sanitized = scrubCotForPersist(input.thoughtText).scrubbed;
      const sample: CotSample = {
        thoughtId: input.thoughtId,
        threadId: input.threadId,
        stakes: input.stakes,
        thoughtText: sanitized,
        promptHash: sha256Hex(input.thoughtText),
        responseHash: sha256Hex(sanitized),
        capturedAt: input.capturedAt,
      };
      await deps.sink.capture(sample);
      return { sampled: true };
    },
  };
}

/**
 * In-memory sink useful for tests. Production wires a Postgres-backed
 * sink at the composition root.
 */
export function createInMemoryCotReservoirSink(): CotReservoirSink & {
  samples(): ReadonlyArray<CotSample>;
} {
  const buf: CotSample[] = [];
  return {
    async capture(sample: CotSample): Promise<void> {
      buf.push(sample);
    },
    samples(): ReadonlyArray<CotSample> {
      return buf.slice();
    },
  };
}

/**
 * In-memory persona-drift sink — companion to the Cot one. Used in
 * tests to assert what the kernel detected.
 */
import type { PersonaDriftEvent, PersonaDriftSink, ProvenanceRecord, ProvenanceSink } from './kernel-types.js';

export function createInMemoryPersonaDriftSink(): PersonaDriftSink & {
  events(): ReadonlyArray<PersonaDriftEvent>;
} {
  const buf: PersonaDriftEvent[] = [];
  return {
    async record(event: PersonaDriftEvent): Promise<void> {
      buf.push(event);
    },
    events(): ReadonlyArray<PersonaDriftEvent> {
      return buf.slice();
    },
  };
}

export function createInMemoryProvenanceSink(): ProvenanceSink & {
  records(): ReadonlyArray<ProvenanceRecord>;
} {
  const buf: ProvenanceRecord[] = [];
  return {
    async record(rec: ProvenanceRecord): Promise<void> {
      buf.push(rec);
    },
    records(): ReadonlyArray<ProvenanceRecord> {
      return buf.slice();
    },
  };
}
