/**
 * Redaction helpers — strip PII before mapping into the OCSF
 * envelope. Conservative regex set covering email, phone (E.164 +
 * common local forms), and obvious identifier-looking strings (full
 * names heuristic is intentionally out-of-scope — too many false
 * positives for SIEM consumption).
 *
 * Pure functions; deterministic; no I/O.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const E164_PHONE_RE = /\+\d[\d\s().-]{6,}\d/g;
const TZ_LOCAL_PHONE_RE = /\b0[67]\d{8}\b/g;
const KE_LOCAL_PHONE_RE = /\b07\d{8}\b/g;
const NIDA_RE = /\b\d{8}-\d{5}-\d{5}-\d{2}\b/g;
const ID_NUMBER_LIKE_RE = /\b[A-Z]{0,2}\d{6,}\b/g;

const REDACTION = "[REDACTED]";

export interface StripResult {
  readonly stripped: string;
  readonly piiFound: boolean;
}

export function stripPii(input: string): StripResult {
  if (!input) return { stripped: input, piiFound: false };
  let out = input;
  let found = false;
  for (const re of [
    EMAIL_RE,
    E164_PHONE_RE,
    TZ_LOCAL_PHONE_RE,
    KE_LOCAL_PHONE_RE,
    NIDA_RE,
    ID_NUMBER_LIKE_RE,
  ]) {
    if (re.test(out)) {
      found = true;
      out = out.replace(re, REDACTION);
    }
    re.lastIndex = 0;
  }
  return { stripped: out, piiFound: found };
}

/** Deep-clone redact — every string value gets the strip treatment. */
export function deepStripPii(
  value: unknown,
): { readonly value: unknown; readonly piiFound: boolean } {
  if (typeof value === "string") {
    const { stripped, piiFound } = stripPii(value);
    return { value: stripped, piiFound };
  }
  if (Array.isArray(value)) {
    let anyFound = false;
    const out = value.map((v) => {
      const r = deepStripPii(v);
      if (r.piiFound) anyFound = true;
      return r.value;
    });
    return { value: out, piiFound: anyFound };
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    let anyFound = false;
    for (const k of Object.keys(obj)) {
      const r = deepStripPii(obj[k]);
      if (r.piiFound) anyFound = true;
      out[k] = r.value;
    }
    return { value: out, piiFound: anyFound };
  }
  return { value, piiFound: false };
}
