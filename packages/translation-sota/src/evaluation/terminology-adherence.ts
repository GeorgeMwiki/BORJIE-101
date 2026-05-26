/**
 * Mr. Mwikila terminology adherence — Borjie-specific eval.
 *
 * Percentage of glossary terms that survived the round trip. Computed
 * pure-JS in this module. Threshold for production ship: ≥ 99 % (see
 * Docs/DESIGN/TRANSLATION_SOTA_SPEC.md §6 #4).
 *
 * For a given run we have:
 *   - the list of `GlossaryEntry` rows whose source-side term the lock
 *     substituted into placeholders.
 *   - the final translated text after the placeholders were unlocked.
 *
 * Adherence = (entries whose target-side `targetTerm` survives verbatim
 * in the final output) / (total entries used).
 *
 * This is intentionally stricter than COMET / BLEU on entities — if
 * the provider drops a placeholder OR mutates the substituted target
 * term (capitalisation, leading whitespace, …), the entry is counted
 * as a violation. The runner uses the score (a) to decide whether to
 * accept the tier-1 output or demote, and (b) for the nightly drift
 * dashboard.
 */

import type { GlossaryEntry } from '../types.js';

export interface AdherenceResult {
  readonly score: number;
  readonly survived: ReadonlyArray<GlossaryEntry>;
  readonly violated: ReadonlyArray<GlossaryEntry>;
}

/**
 * Compute terminology adherence over a finalised translation.
 *
 * @param finalOutput  the post-substituted output (after `unlockTerms`).
 * @param entriesUsed  glossary entries that fired during pass 1.
 */
export function computeTerminologyAdherence(
  finalOutput: string,
  entriesUsed: ReadonlyArray<GlossaryEntry>,
): AdherenceResult {
  if (entriesUsed.length === 0) {
    return Object.freeze({
      score: 1,
      survived: Object.freeze([]),
      violated: Object.freeze([]),
    });
  }

  const survived: GlossaryEntry[] = [];
  const violated: GlossaryEntry[] = [];

  for (const entry of entriesUsed) {
    if (containsExact(finalOutput, entry.targetTerm)) {
      survived.push(entry);
    } else {
      violated.push(entry);
    }
  }

  return Object.freeze({
    score: survived.length / entriesUsed.length,
    survived: Object.freeze([...survived]),
    violated: Object.freeze([...violated]),
  });
}

/**
 * Case-insensitive containment with word-boundary respect.
 *
 * We want "USD" to match "USD 50,000" but not "USDA". For ASCII brand
 * tokens this matters; for multiword honorifics ("Dear sir or madam")
 * we relax to substring containment because the trailing comma / case
 * variations are common.
 */
function containsExact(haystack: string, needle: string): boolean {
  if (needle.length === 0) {
    return true;
  }
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  let pos = 0;
  while (pos <= lowerHaystack.length - lowerNeedle.length) {
    const idx = lowerHaystack.indexOf(lowerNeedle, pos);
    if (idx < 0) {
      return false;
    }
    const leftChar = idx > 0 ? lowerHaystack[idx - 1] : undefined;
    const rightChar =
      idx + lowerNeedle.length < lowerHaystack.length
        ? lowerHaystack[idx + lowerNeedle.length]
        : undefined;
    if (isBoundary(leftChar) && isBoundary(rightChar)) {
      return true;
    }
    pos = idx + 1;
  }
  return false;
}

function isBoundary(ch: string | undefined): boolean {
  if (ch === undefined) {
    return true;
  }
  return /[^\p{L}\p{N}_]/u.test(ch);
}
