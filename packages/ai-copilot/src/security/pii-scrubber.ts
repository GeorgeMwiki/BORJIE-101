/* eslint-disable borjie/no-jurisdictional-literal --
 * PII scrubber pattern catalogue: NIDA / TIN / KRA-PIN / +254 / +255
 * references are redaction-pattern labels and replacement placeholders,
 * not flowing logic. The country-coupled placeholders ARE the contract
 * — security taxonomy needs the named PII type per regulator (Case 3).
 */
/**
 * BORJIE AI PII scrubber — Wave-11 AI security hardening.
 *
 * Removes personally-identifiable information from text BEFORE it reaches the
 * LLM (or a log sink). Tailored for East Africa:
 *   - Tanzania NIDA national ID
 *   - Tanzania TIN
 *   - +255 / +254 mobile numbers (Swahili + English context lines)
 *   - Email, credit card, SSN-like, IP, passport, API-key-ish tokens
 *
 * Swahili-aware: context patterns like "namba yangu ni …" or "kitambulisho
 * changu ni …" trigger scrubbing even when the surrounded number does not
 * match a standalone PII pattern.
 *
 * The scrubber is idempotent — running it twice on the same input returns the
 * same output (placeholders themselves are not re-matched).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PiiType =
  | 'national_id'
  | 'tin_number'
  | 'kra_pin'
  | 'phone_number'
  | 'email'
  | 'credit_card'
  | 'bank_account'
  | 'passport'
  | 'ssn'
  | 'ip_address'
  | 'api_key'
  | 'date_of_birth'
  // Round-3 audit H13 — Nigerian National Identification Number
  // (11 digits, optionally prefixed by "NIN" context word).
  | 'nin'
  // Round-3 audit H13 — M-Pesa PIN (4-6 digit numeric, typically
  // surrounded by "PIN yangu ni" / "my pin is" context phrasing).
  | 'mpesa_pin'
  // Round-3 audit C13 — base64-encoded PII detected by speculative
  // decode + re-scan. Adds defence-in-depth against attackers who
  // wrap a payload in base64 to bypass surface-level scans.
  | 'base64_pii';

export interface PiiMatch {
  readonly type: PiiType;
  readonly value: string;
  readonly replacement: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface PiiScrubResult {
  readonly scrubbed: string;
  readonly original: string;
  readonly piiFound: readonly PiiMatch[];
  readonly hasPii: boolean;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

interface PiiPattern {
  readonly type: PiiType;
  readonly regex: RegExp;
  readonly replacement: string;
}

// Note: we intentionally do NOT mark patterns as /g here to avoid lastIndex
// state bleed across calls — we precompile the global regex ONCE per
// pattern below (round-3 audit M3 — the previous implementation
// recompiled 14+ regexes on every `scrubPii` call, a hot path that
// runs for every LLM turn).
const PII_PATTERNS: readonly PiiPattern[] = [
  // Tanzania NIDA — 20 digits often dash-separated.
  {
    type: 'national_id',
    regex: /\b(19|20)\d{2}[-\s]?\d{4}[-\s]?\d{5}[-\s]?\d{2,4}\b/,
    replacement: '[NIDA_ID]',
  },
  // Tanzania TIN — labelled form.
  {
    type: 'tin_number',
    regex: /\bTIN[\s:]*\d{3}[-\s]?\d{3}[-\s]?\d{3}\b/i,
    replacement: '[TIN]',
  },
  // Kenya KRA PIN — A2b-2 wire #3. 11 chars: uppercase letter + 9
  // digits + uppercase letter. Narrow shape to avoid product SKU
  // collisions.
  {
    type: 'kra_pin',
    regex: /\b[A-Z]\d{9}[A-Z]\b/,
    replacement: '<kra-pin:redacted>',
  },
  // Kenya +254 mobiles.
  {
    type: 'phone_number',
    regex: /\b(?:\+?254|0)\s?7\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/,
    replacement: '[PHONE]',
  },
  // Tanzania +255 mobiles.
  {
    type: 'phone_number',
    regex: /\b(?:\+?255|0)\s?[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/,
    replacement: '[PHONE]',
  },
  // Malaysia +60 mobiles — 9 or 10 digits after +60/0 prefix.
  {
    type: 'phone_number',
    regex: /\b(?:\+?60|0)\s?1\d[\s-]?\d{3,4}[\s-]?\d{4}\b/,
    replacement: '[PHONE]',
  },
  // International fallback — conservative.
  {
    type: 'phone_number',
    regex: /\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b/,
    replacement: '[PHONE]',
  },
  // Email.
  {
    type: 'email',
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    replacement: '[EMAIL]',
  },
  // Credit card.
  {
    type: 'credit_card',
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{3,7}\b/,
    replacement: '[CARD]',
  },
  // Labelled bank account.
  {
    type: 'bank_account',
    regex: /\b(?:account|a\/c|acct|akaunti)[\s:#]*\d{8,16}\b/i,
    replacement: '[ACCOUNT]',
  },
  // Passport.
  {
    type: 'passport',
    regex: /\b(?:passport|pasipoti)[\s:#]*[A-Z]{1,2}\d{6,9}\b/i,
    replacement: '[PASSPORT]',
  },
  // SSN-ish.
  {
    type: 'ssn',
    regex: /\b\d{3}-\d{2}-\d{4}\b/,
    replacement: '[SSN]',
  },
  // IP.
  {
    type: 'ip_address',
    regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
    replacement: '[IP]',
  },
  // API-key shape. Requires prefix to avoid every long word.
  {
    type: 'api_key',
    regex: /\b(?:sk|pk|api[_-]?key|token)[-_][A-Za-z0-9]{16,}\b/i,
    replacement: '[API_KEY]',
  },
  // D9: Date of birth — multiple formats. The patterns are
  // free-floating (no DOB context word) so they intentionally
  // false-positive on calendar dates that are not birthdays —
  // callers that need to keep property construction-year dates
  // should pre-filter via context (audit 4.5).
  {
    type: 'date_of_birth',
    regex:
      /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/,
    replacement: '[DOB]',
  },
  {
    type: 'date_of_birth',
    regex:
      /\b(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d{2}\b/,
    replacement: '[DOB]',
  },
  {
    type: 'date_of_birth',
    regex:
      /\b(?:0?[1-9]|[12]\d|3[01])\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:19|20)\d{2}\b/i,
    replacement: '[DOB]',
  },
];

// Round-3 audit C13 / H13 — pre-compiled globals + context patterns
// for jurisdiction-specific PII the standalone patterns can't catch.
const NIN_CONTEXT_RX = /(?:\bNIN\b|national\s+identification\s+number|nin\s+yangu\s+ni)[\s:]*(\d{11})\b/i;
const MPESA_PIN_CONTEXT_RX =
  /(?:m[-\s]?pesa\s+pin|mpesa\s+pin|pin\s+ya\s+m[-\s]?pesa|pin\s+yangu\s+ya\s+m[-\s]?pesa|my\s+m[-\s]?pesa\s+pin)\s+(?:is\s+|ni\s+)?(\d{4,6})\b/i;

// Round-3 audit C13 — base64 detection.
// We deliberately require the decoded string to be valid UTF-8 AND
// contain something that smells like a phone / email / KRA PIN before
// flagging. This avoids false-positives on every long base64 blob
// (e.g. JWT payloads, image data URIs).
const BASE64_CANDIDATE_RX = /\b[A-Za-z0-9+/]{16,}={0,2}\b/g;

interface ContextPattern {
  readonly regex: RegExp;
  readonly piiRegex: RegExp;
  readonly type: PiiType;
  readonly replacement: string;
}

const CONTEXT_PATTERNS: readonly ContextPattern[] = [
  // English/Swahili phone context.
  {
    regex:
      /(?:my\s+(?:phone\s+)?number\s+is|namba\s+yangu\s+ni|piga\s+simu|call\s+me\s+(?:on|at))\s+/i,
    piiRegex: /\+?\d[\d\s-]{7,}/,
    type: 'phone_number',
    replacement: '[PHONE]',
  },
  // Email context.
  {
    regex: /(?:my\s+email\s+is|email\s+yangu\s+ni|send\s+to)\s+/i,
    piiRegex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    type: 'email',
    replacement: '[EMAIL]',
  },
  // NIDA / national ID.
  {
    regex:
      /(?:my\s+(?:national\s+)?id(?:\s+number)?\s+is|kitambulisho\s+changu(?:\s+ni)?|nida\s+yangu(?:\s+ni)?)\s+/i,
    piiRegex: /\d[\d\s-]{8,}/,
    type: 'national_id',
    replacement: '[NIDA_ID]',
  },
  // A2b-2 wire #3 — KRA PIN context-aware: English + Swahili.
  // Trigger phrase first, then the canonical 11-char PIN in tail.
  {
    regex:
      /(?:my\s+kra(?:\s+pin)?(?:\s+is)?|nambari\s+yangu\s+ya\s+kra(?:\s+ni)?|kra\s+pin\s+is)\s+/i,
    piiRegex: /[A-Z]\d{9}[A-Z]/,
    type: 'kra_pin',
    replacement: '<kra-pin:redacted>',
  },
];

// Monetary patterns — we do not scrub monetary amounts. The pattern set
// is centralised in `./currency-patterns.ts` so every detector across the
// codebase (policy-gate, self-rag, sovereign-action-ledger) shares the
// same global ISO-4217 + symbol coverage.
import { MONETARY_PATTERNS as SHARED_MONETARY_PATTERNS } from './currency-patterns.js';
const MONETARY_PATTERNS: readonly RegExp[] = SHARED_MONETARY_PATTERNS;

// Placeholders we emit — never re-scrub them.
const PLACEHOLDER_RX =
  /\[(?:NIDA_ID|TIN|PHONE|EMAIL|CARD|ACCOUNT|PASSPORT|SSN|IP|API_KEY|DOB|NIN|MPESA_PIN|BASE64_PII)\]|<kra-pin:redacted>/;

// Round-3 audit M3 — precompile a global-flag regex for every PII
// pattern at module load. Each `scrubPii` call now reuses the same
// `RegExp` instance via `exec` (which is safe because we always
// reset `lastIndex = 0` before the loop). This eliminates 14+
// `new RegExp(...)` allocations from the hot path.
interface CompiledPiiPattern extends PiiPattern {
  readonly globalRegex: RegExp;
}

const COMPILED_PII_PATTERNS: readonly CompiledPiiPattern[] = PII_PATTERNS.map(
  (p) => ({
    ...p,
    globalRegex: new RegExp(
      p.regex.source,
      p.regex.flags.includes('g') ? p.regex.flags : `${p.regex.flags}g`
    ),
  })
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMonetary(text: string, start: number, end: number): boolean {
  const ctxStart = Math.max(0, start - 40);
  const ctxEnd = Math.min(text.length, end + 20);
  const ctx = text.slice(ctxStart, ctxEnd);
  return MONETARY_PATTERNS.some((rx) => rx.test(ctx));
}

function overlapsPlaceholder(
  text: string,
  start: number,
  end: number,
): boolean {
  const ctxStart = Math.max(0, start - 10);
  const ctxEnd = Math.min(text.length, end + 10);
  return PLACEHOLDER_RX.test(text.slice(ctxStart, ctxEnd));
}

function dedupe(matches: readonly PiiMatch[]): readonly PiiMatch[] {
  if (matches.length <= 1) return matches;
  const sorted = [...matches].sort((a, b) => a.startIndex - b.startIndex);
  const first = sorted[0];
  if (first === undefined) return matches;
  const result: PiiMatch[] = [first];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    const prev = result[result.length - 1];
    if (cur === undefined || prev === undefined) continue;
    if (cur.startIndex < prev.endIndex) {
      if (cur.endIndex - cur.startIndex > prev.endIndex - prev.startIndex) {
        result[result.length - 1] = cur;
      }
    } else {
      result.push(cur);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function scrubPii(message: string): PiiScrubResult {
  if (!message) {
    return { scrubbed: '', original: message ?? '', piiFound: [], hasPii: false };
  }

  const matches: PiiMatch[] = [];

  for (const p of COMPILED_PII_PATTERNS) {
    // Round-3 audit M3 — reuse the precompiled global regex. Reset
    // lastIndex defensively before each scan to avoid bleed across
    // calls (we never throw mid-loop, but a future caller might).
    p.globalRegex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.globalRegex.exec(message)) !== null) {
      const start = m.index;
      const end = m.index + m[0].length;
      if (overlapsPlaceholder(message, start, end)) continue;
      if (p.type !== 'email' && p.type !== 'api_key') {
        if (isMonetary(message, start, end)) continue;
      }
      // Very short digit runs are likely false positives. DOBs are
      // excluded — they carry structural markers (separators / months).
      if (
        p.type !== 'email' &&
        p.type !== 'api_key' &&
        p.type !== 'date_of_birth' &&
        m[0].replace(/[\s-]/g, '').length < 6
      ) {
        continue;
      }
      matches.push({
        type: p.type,
        value: m[0],
        replacement: p.replacement,
        startIndex: start,
        endIndex: end,
      });
    }
  }

  for (const ctx of CONTEXT_PATTERNS) {
    const ctxMatch = ctx.regex.exec(message);
    if (!ctxMatch) continue;
    const tail = message.slice(ctxMatch.index + ctxMatch[0].length);
    const piiMatch = ctx.piiRegex.exec(tail);
    if (!piiMatch) continue;
    const absoluteStart = ctxMatch.index + ctxMatch[0].length + piiMatch.index;
    const absoluteEnd = absoluteStart + piiMatch[0].length;
    if (overlapsPlaceholder(message, absoluteStart, absoluteEnd)) continue;
    matches.push({
      type: ctx.type,
      value: piiMatch[0],
      replacement: ctx.replacement,
      startIndex: absoluteStart,
      endIndex: absoluteEnd,
    });
  }

  // Round-3 audit H13 fix — NIN (Nigerian National Identification
  // Number) is 11 numeric digits surrounded by an explicit context
  // phrase. Standalone 11-digit runs are too noisy (phone numbers,
  // order ids); we require the "NIN" or "nin yangu ni" trigger.
  {
    const m = NIN_CONTEXT_RX.exec(message);
    if (m && m[1]) {
      const start = m.index + m[0].indexOf(m[1]);
      const end = start + m[1].length;
      if (!overlapsPlaceholder(message, start, end)) {
        matches.push({
          type: 'nin',
          value: m[1],
          replacement: '[NIN]',
          startIndex: start,
          endIndex: end,
        });
      }
    }
  }

  // Round-3 audit H13 fix — M-Pesa PIN (4-6 digit numeric) only
  // detected when the input carries an explicit "M-Pesa PIN" /
  // "PIN yangu ya M-Pesa" / "my Mpesa pin" phrase. Standalone 4-6
  // digit numbers are far too noisy (years, quantities) to redact
  // without context.
  {
    const m = MPESA_PIN_CONTEXT_RX.exec(message);
    if (m && m[1]) {
      const start = m.index + m[0].indexOf(m[1]);
      const end = start + m[1].length;
      if (!overlapsPlaceholder(message, start, end)) {
        matches.push({
          type: 'mpesa_pin',
          value: m[1],
          replacement: '[MPESA_PIN]',
          startIndex: start,
          endIndex: end,
        });
      }
    }
  }

  // Round-3 audit C13 fix — base64 detection.
  // We speculatively decode every base64-shaped run and re-run the
  // scrubber against the decoded text. If the decoded text contains
  // PII, we redact the ORIGINAL base64 (not the decoded form) so the
  // attacker cannot inspect what the scrubber saw.
  {
    let m: RegExpExecArray | null;
    BASE64_CANDIDATE_RX.lastIndex = 0;
    while ((m = BASE64_CANDIDATE_RX.exec(message)) !== null) {
      const candidate = m[0];
      let decoded: string;
      try {
        decoded = Buffer.from(candidate, 'base64').toString('utf8');
      } catch {
        continue;
      }
      // Skip if decoded text is mostly non-printable — likely binary,
      // not a payload an attacker is hoping the LLM reads.
      const printable = decoded.replace(/[^\x20-\x7E\u00a0-\uffff\s]/g, '');
      if (printable.length < decoded.length * 0.6) continue;
      if (printable.trim().length < 4) continue;

      // Re-scan decoded text with the surface patterns only (no
      // recursion). If anything matches, flag the ORIGINAL base64
      // candidate for redaction. Round-3 audit M3 — uses precompiled
      // regexes, but each must reset lastIndex because a previous
      // `test()` call may have advanced it on a different string.
      let decodedHasPii = false;
      for (const p of COMPILED_PII_PATTERNS) {
        p.globalRegex.lastIndex = 0;
        if (p.globalRegex.test(decoded)) {
          decodedHasPii = true;
          break;
        }
      }
      if (!decodedHasPii) continue;

      const start = m.index;
      const end = start + candidate.length;
      if (overlapsPlaceholder(message, start, end)) continue;
      matches.push({
        type: 'base64_pii',
        value: candidate,
        replacement: '[BASE64_PII]',
        startIndex: start,
        endIndex: end,
      });
    }
  }

  const deduped = dedupe(matches);
  let scrubbed = message;
  const reverseOrder = [...deduped].sort((a, b) => b.startIndex - a.startIndex);
  for (const m of reverseOrder) {
    scrubbed =
      scrubbed.slice(0, m.startIndex) +
      m.replacement +
      scrubbed.slice(m.endIndex);
  }

  return {
    scrubbed,
    original: message,
    piiFound: deduped,
    hasPii: deduped.length > 0,
  };
}

/**
 * Audit record for compliance logs. Never contains the PII values themselves.
 *
 * Round-3 audit M4 fix — always returns the `piiDetected` flag so
 * downstream graphs can distinguish "scrubber ran and found nothing"
 * from "scrubber was never invoked". Previously the function returned
 * `{}` on a clean message, which was indistinguishable from a missing
 * scrubber call.
 */
export function buildPiiAuditRecord(result: PiiScrubResult): Readonly<Record<string, unknown>> {
  if (!result.hasPii) {
    return { piiDetected: false, piiCount: 0 };
  }
  const types = [...new Set(result.piiFound.map((m) => m.type))];
  return {
    piiDetected: true,
    piiTypes: types,
    piiCount: result.piiFound.length,
  };
}
