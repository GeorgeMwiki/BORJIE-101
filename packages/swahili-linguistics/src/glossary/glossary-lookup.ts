/**
 * Glossary lookup (Wave 19H).
 *
 * Register-aware bilingual glossary lookup. The seed glossary lives in
 * `mining-terms.ts`; callers can extend it by passing an additional
 * term array to `createGlossaryLookup()`.
 */

import type { Register, SwahiliTerm } from '../types.js';
import { MINING_TERMS_SEED } from './mining-terms.js';

export interface GlossaryLookup {
  /** Resolve Swahili → SwahiliTerm with register preference. */
  bySwahili(term: string, register?: Register): SwahiliTerm | null;
  /** Resolve English → SwahiliTerm with register preference. */
  byEnglish(en: string, register?: Register): SwahiliTerm | null;
  /** List all entries in a domain tag. */
  byDomain(domain: string): ReadonlyArray<SwahiliTerm>;
  /** Total number of entries. */
  size(): number;
}

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Build a glossary lookup over the seed + any extension entries.
 * Returns frozen handle.
 */
export function createGlossaryLookup(
  extraTerms: ReadonlyArray<SwahiliTerm> = [],
): GlossaryLookup {
  const entries: ReadonlyArray<SwahiliTerm> = Object.freeze([
    ...MINING_TERMS_SEED,
    ...extraTerms,
  ]);

  function pickByRegister(
    matches: ReadonlyArray<SwahiliTerm>,
    register: Register | undefined,
  ): SwahiliTerm | null {
    if (matches.length === 0) return null;
    if (register !== undefined) {
      const preferred = matches.find((m) => m.register === register);
      if (preferred) return preferred;
    }
    const formal = matches.find((m) => m.register === 'formal');
    return formal ?? matches[0] ?? null;
  }

  return Object.freeze({
    bySwahili(term: string, register?: Register): SwahiliTerm | null {
      const needle = normalise(term);
      const matches = entries.filter(
        (e) => normalise(e.term) === needle || normalise(e.lemma) === needle,
      );
      return pickByRegister(matches, register);
    },
    byEnglish(en: string, register?: Register): SwahiliTerm | null {
      const needle = normalise(en);
      const matches = entries.filter(
        (e) => normalise(e.enEquivalent) === needle,
      );
      return pickByRegister(matches, register);
    },
    byDomain(domain: string): ReadonlyArray<SwahiliTerm> {
      const needle = normalise(domain);
      return Object.freeze(
        entries.filter((e) => normalise(e.domain) === needle),
      );
    },
    size(): number {
      return entries.length;
    },
  });
}
