/**
 * Terminology adherence scorer — delegates the glossary lookup to an
 * injected `TranslationSotaPort` (Wave 19I sibling); falls back to a
 * simple substring + canonical-form check when no port is wired.
 *
 * The mining glossary is a list of `{lang, canonical, accept[]}` triples
 * — `canonical` is the preferred surface form for Mr. Mwikila to emit
 * ("Tumemadini", "leseni", "parseli"); `accept` is the set of
 * alternative surfaces that are linguistically valid (lowercase,
 * inflected, etc.). A text that uses the canonical form scores 1.0;
 * a text that uses an accepted alternative scores 0.7; a text that
 * uses neither (even though the underlying concept is present) scores
 * 0.0 for that term.
 *
 * Per term aggregate: arithmetic mean across the glossary terms whose
 * concept the text actually mentions (skipping non-applicable terms).
 */

import type { LanguageTag } from '../types.js';

export interface GlossaryTerm {
  readonly lang: LanguageTag;
  readonly canonical: string;
  readonly accept: ReadonlyArray<string>;
  /**
   * Conceptual triggers — substrings whose presence indicates the user
   * is talking about this term's concept (even if neither canonical nor
   * accepted surface is used). For "leseni" the triggers might be
   * ["licen", "kibali"]. If `triggers` is empty, the term is checked
   * against every text.
   */
  readonly triggers: ReadonlyArray<string>;
}

export interface TerminologyResult {
  readonly score: number;
  readonly applicable: number;
  readonly canonicalHits: ReadonlyArray<string>;
  readonly acceptedHits: ReadonlyArray<string>;
  readonly missed: ReadonlyArray<string>;
}

export interface TranslationSotaPort {
  glossaryAdherence(
    text: string,
    lang: LanguageTag,
    glossary: ReadonlyArray<GlossaryTerm>,
  ): Promise<TerminologyResult>;
}

const MINING_GLOSSARY_BASE: ReadonlyArray<GlossaryTerm> = Object.freeze([
  Object.freeze({
    lang: 'sw' as const,
    canonical: 'tumemadini',
    accept: Object.freeze(['Tumemadini', 'TUMEMADINI']),
    triggers: Object.freeze(['leseni', 'licen', 'kibali']),
  }),
  Object.freeze({
    lang: 'sw' as const,
    canonical: 'parseli',
    accept: Object.freeze(['Parseli', 'parcel', 'parcels']),
    triggers: Object.freeze(['parcel', 'shipment']),
  }),
  Object.freeze({
    lang: 'sw' as const,
    canonical: 'NEMC',
    accept: Object.freeze(['nemc', 'Nemc']),
    triggers: Object.freeze(['environment', 'mazingira']),
  }),
  Object.freeze({
    lang: 'sw' as const,
    canonical: 'leseni',
    accept: Object.freeze(['Leseni', 'license', 'licence']),
    triggers: Object.freeze(['licen', 'kibali']),
  }),
]);

export const MINING_GLOSSARY: ReadonlyArray<GlossaryTerm> = MINING_GLOSSARY_BASE;

/**
 * Default deterministic port — used in tests and as a sane fallback when
 * the real Wave 19I `translation-sota` package is not yet wired.
 */
export const defaultTerminologyPort: TranslationSotaPort = Object.freeze({
  async glossaryAdherence(
    text: string,
    lang: LanguageTag,
    glossary: ReadonlyArray<GlossaryTerm>,
  ): Promise<TerminologyResult> {
    return computeGlossaryAdherence(text, lang, glossary);
  },
});

/**
 * Pure-function glossary adherence used by `defaultTerminologyPort` and
 * directly by tests. Exposed for callers that want zero-port wiring.
 */
export function computeGlossaryAdherence(
  text: string,
  lang: LanguageTag,
  glossary: ReadonlyArray<GlossaryTerm>,
): TerminologyResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return Object.freeze({
      score: 1,
      applicable: 0,
      canonicalHits: Object.freeze([]),
      acceptedHits: Object.freeze([]),
      missed: Object.freeze([]),
    });
  }
  const lowered = text.toLowerCase();
  let applicable = 0;
  const canonicalHits: string[] = [];
  const acceptedHits: string[] = [];
  const missed: string[] = [];
  let scoreSum = 0;

  for (const term of glossary) {
    if (term.lang !== lang && term.lang !== 'sw') {
      continue;
    }
    const triggered =
      term.triggers.length === 0 ||
      term.triggers.some((t) => lowered.includes(t.toLowerCase())) ||
      lowered.includes(term.canonical.toLowerCase()) ||
      term.accept.some((a) => lowered.includes(a.toLowerCase()));
    if (!triggered) {
      continue;
    }
    applicable++;
    if (lowered.includes(term.canonical.toLowerCase())) {
      canonicalHits.push(term.canonical);
      scoreSum += 1;
    } else if (term.accept.some((a) => lowered.includes(a.toLowerCase()))) {
      acceptedHits.push(term.canonical);
      scoreSum += 0.7;
    } else {
      missed.push(term.canonical);
      scoreSum += 0;
    }
  }

  const score = applicable === 0 ? 1 : scoreSum / applicable;
  return Object.freeze({
    score,
    applicable,
    canonicalHits: Object.freeze(canonicalHits),
    acceptedHits: Object.freeze(acceptedHits),
    missed: Object.freeze(missed),
  });
}

export async function scoreTerminology(
  text: string,
  lang: LanguageTag,
  glossary: ReadonlyArray<GlossaryTerm>,
  port: TranslationSotaPort,
): Promise<TerminologyResult> {
  try {
    return await port.glossaryAdherence(text, lang, glossary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Terminology scorer: port failed — ${message}`);
  }
}
