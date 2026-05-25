/**
 * Local PII redactor for free-text rows in the schema-sniff layer.
 *
 * The canonical implementation lives in
 * `packages/database/src/services/sovereign-action-ledger.service.ts`
 * (`redactPayloadPii`). That export is currently not part of
 * `@borjie/database`'s public surface AND cross-package import would
 * create a backward dependency edge from `file-ingest` → `database` that
 * the package boundary is supposed to forbid (file-ingest is intended to
 * be a leaf package). We therefore copy the regex table locally.
 *
 * Keep these patterns in sync with sovereign-action-ledger.service.ts
 * (PAYLOAD_PII_PATTERNS). Any drift produces inconsistent redaction
 * between the ingest free-text path and the agency ledger payload path.
 */

const PII_PATTERNS: ReadonlyArray<{
  readonly regex: RegExp;
  readonly replacement: string;
}> = [
  // Kenya KRA PIN — A123456789B
  { regex: /\b[A-Z]\d{9}[A-Z]\b/g, replacement: '<kra-pin:redacted>' },
  // Tanzania NIDA — 20 digits total. The canonical NIDA format is
  // `YYYY-MMDD-NNNNN-NNNNNNN` (4-4-5-7 with hyphen separators). We
  // accept either:
  //   - exactly that hyphenated form, OR
  //   - 20 contiguous digits starting with 19xx or 20xx (birth year).
  // Previously the regex used `[-\s]?` (optional separators) and a
  // `{2,4}` final group, which accidentally matched 13–17-digit
  // audit timestamps like `2024051512345678`. We narrow the
  // pattern so audit log timestamps are NOT redacted.
  {
    regex: /\b(?:19|20)\d{2}-\d{4}-\d{5}-\d{7}\b/g,
    replacement: '[NIDA_ID]',
  },
  {
    regex: /\b(?:19|20)\d{2}\d{4}\d{5}\d{7}\b/g,
    replacement: '[NIDA_ID]',
  },
  // Kenya +254 mobile
  {
    regex: /\b(?:\+?254|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Tanzania +255 mobile
  {
    regex: /\b(?:\+?255|0)\s?[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Uganda +256 mobile
  {
    regex: /\b(?:\+?256|0)\s?[37]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Rwanda +250 mobile
  {
    regex: /\b(?:\+?250|0)\s?[78]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // South Africa +27 mobile
  {
    regex: /\b(?:\+?27|0)\s?[678]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,
    replacement: '[PHONE]',
  },
  // Nigeria +234 mobile
  {
    regex: /\b(?:\+?234|0)\s?[789]\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g,
    replacement: '[PHONE]',
  },
  // Generic E.164 fallback
  { regex: /\+[1-9]\d{6,14}\b/g, replacement: '[PHONE]' },
  // Email
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL]',
  },
];

/**
 * Scrub PII tokens from a free-text string. Returns a new string — never
 * mutates the input. Multiple PII tokens in the same string are all
 * replaced in a single pass per pattern.
 */
export function redactPiiFromString(input: string): string {
  let out = input;
  for (const p of PII_PATTERNS) {
    out = out.replace(p.regex, p.replacement);
  }
  return out;
}
