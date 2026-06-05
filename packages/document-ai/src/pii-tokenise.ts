/**
 * Reversible PII tokenisation for content sent to an LLM provider.
 *
 * Borjie agents process tenant documents that contain third-party PII
 * (national IDs, phone numbers, emails, GPS). Sending the raw values to a
 * US-hosted LLM is a cross-border data-residency risk (TZ DPA s.42 / GDPR
 * Ch. V). We replace each PII value with a STABLE token before the prompt
 * (`[NIDA_1]`), keep a token→value map, and restore the values in the
 * model's answer. The model reasons over tokens; the provider never sees
 * the raw PII; utility is preserved — even an extraction query returns the
 * real value after restore (unlike destructive redaction).
 */

export interface PiiTokenisation {
  readonly text: string;
  readonly map: ReadonlyMap<string, string>;
}

// High-precision PII patterns (ordered specific→general). Kept deliberately
// tight to avoid tokenising ordinary numbers/text that would hurt the
// model's comprehension.
const PII_PATTERNS: ReadonlyArray<{
  readonly kind: string;
  readonly re: RegExp;
}> = [
  { kind: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // TZ national ID (NIDA): 20 digits, often dash-grouped (8-4/5-5-2/3).
  { kind: 'NIDA', re: /\b\d{8}-?\d{4,5}-?\d{5}-?\d{2,3}\b/g },
  // TZ TRA TIN: 123-456-789 (9 digits, NNN-NNN-NNN). Primary tax-ID
  // entry (Tanzania-first, built for the world).
  { kind: 'TRA_TIN', re: /\b\d{3}-\d{3}-\d{3}\b/g },
  // KE KRA PIN: A123456789Z.
  { kind: 'KRA_PIN', re: /\b[A-Z]\d{9}[A-Z]\b/g },
  // TZ mobile: +2557xxxxxxxx / 07xxxxxxxx / +2556xxxxxxxx / 06xxxxxxxx.
  { kind: 'PHONE', re: /(?:\+?255|0)[67]\d{8}\b/g },
  // GPS coordinate pair (lat,lng with ≥4 decimals).
  { kind: 'GPS', re: /-?\d{1,2}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g },
];

export interface PiiTokeniser {
  /** Tokenise one string, sharing token numbering + dedup with prior calls. */
  tokenise(text: string): string;
  /** The accumulated token→value map for restoration. */
  readonly map: ReadonlyMap<string, string>;
}

/**
 * Create a STATEFUL tokeniser. Use one instance across all chunks of a
 * single request so tokens are globally unique — tokenising chunks
 * independently would restart the counter and make chunk A's `[EMAIL_1]`
 * collide with chunk B's, corrupting restoration.
 */
export function createPiiTokeniser(): PiiTokeniser {
  const map = new Map<string, string>();
  const valueToToken = new Map<string, string>();
  const counters: Record<string, number> = {};
  return {
    tokenise(text: string): string {
      let out = text;
      for (const { kind, re } of PII_PATTERNS) {
        out = out.replace(re, (match) => {
          const existing = valueToToken.get(match);
          if (existing) return existing;
          counters[kind] = (counters[kind] ?? 0) + 1;
          const token = `[${kind}_${counters[kind]}]`;
          map.set(token, match);
          valueToToken.set(match, token);
          return token;
        });
      }
      return out;
    },
    get map(): ReadonlyMap<string, string> {
      return map;
    },
  };
}

/**
 * Tokenise a single string. Same value → same token, so the model can
 * still reason about "the same person" within the text. For multi-chunk
 * input use `createPiiTokeniser()` so tokens stay globally unique.
 */
export function tokenisePii(text: string): PiiTokenisation {
  const t = createPiiTokeniser();
  const out = t.tokenise(text);
  return { text: out, map: t.map };
}

/** Restore original PII values from a token→value map (reverse of tokenise). */
export function restorePii(
  text: string,
  map: ReadonlyMap<string, string>,
): string {
  let out = text;
  for (const [token, value] of map) {
    out = out.split(token).join(value);
  }
  return out;
}
