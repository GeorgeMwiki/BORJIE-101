/**
 * Swahili Morpheme Pre-Tokenizer
 *
 * Decomposes Swahili words before sending to LLMs so they understand
 * the agglutinative structure. Appends parenthetical morpheme hints
 * for words with confident decomposition.
 *
 * Example:
 *   "hatutakwenda" -> "hatutakwenda (ha-tu-ta-kwend-a: NEG-1PL-FUT-go-FV)"
 *
 * Also provides grammar rules that can be injected into LLM system prompts
 * so Claude/GPT can reason about Swahili morphology without external tools.
 */

import {
  analyzeWord,
  formatMorphemeString,
  looksLikeSwahili,
} from "./morphological-analyzer";

/** Minimum confidence to include a morpheme hint */
const MIN_CONFIDENCE_FOR_HINT = 0.6;

/** Maximum words to annotate per message (avoid noise) */
const MAX_ANNOTATIONS_PER_MESSAGE = 8;

/**
 * Pre-tokenize a Swahili text by appending morpheme breakdowns
 * to words that the analyzer can confidently decompose.
 *
 * For each Swahili word with confidence >= 0.6, appends a parenthetical
 * morpheme hint that helps LLMs understand the agglutinative structure.
 *
 * @param text - The input text (may be mixed Swahili/English)
 * @returns The text with morpheme annotations inline
 */
export function morphemePreTokenize(text: string): string {
  const words = text.split(/(\s+)/);
  let annotationCount = 0;

  const processed = words.map((segment) => {
    // Preserve whitespace segments as-is
    if (/^\s+$/.test(segment)) return segment;

    // Strip trailing punctuation for analysis, preserve it for output
    const punctMatch = segment.match(/^([a-zA-Z']+)([^a-zA-Z']*)$/);
    if (!punctMatch) return segment;

    const word = punctMatch[1];
    const trailing = punctMatch[2];

    // Skip very short words, obvious English, and already-annotated words
    if (word.length < 3) return segment;
    if (!looksLikeSwahili(word)) return segment;
    if (annotationCount >= MAX_ANNOTATIONS_PER_MESSAGE) return segment;

    const breakdown = analyzeWord(word);

    if (breakdown.confidence >= MIN_CONFIDENCE_FOR_HINT) {
      const morphemeStr = formatMorphemeString(breakdown);

      // Only annotate if the formatting produced something useful
      if (morphemeStr !== word.toLowerCase() && morphemeStr !== word) {
        annotationCount++;
        return `${word} (${morphemeStr})${trailing}`;
      }
    }

    return segment;
  });

  return processed.join("");
}

/**
 * Returns Swahili grammar rules to inject into LLM prompts.
 * Covers noun class agreement, verb morphology template, and
 * common patterns that help the LLM produce and understand correct Swahili.
 *
 * @param language - 'sw' for Swahili context, 'en' for English context
 * @returns Grammar rules string, or null for non-Swahili contexts
 */
export function getGrammarRulesForPrompt(language: "sw" | "en"): string | null {
  if (language !== "sw") return null;

  return SWAHILI_GRAMMAR_RULES;
}

// ============================================================================
// Grammar Rules Reference (injected into LLM prompts)
// ============================================================================

const SWAHILI_GRAMMAR_RULES = `## Swahili Morphology Reference

### Verb Template
NEG + SUBJ + TENSE + (REL) + (OBJ) + ROOT + (DERIV) + FV

| Slot | Morphemes | Example |
|------|-----------|---------|
| NEG | ha-, si- | ha-tu-ta-end-a (we will not go) |
| SUBJ | ni/u/a/tu/m/wa + cl. agreement | a-na-som-a (he reads) |
| TENSE | na(pres), li(past), ta(fut), me(perf), ki(cond), ka(cons) | tu-me-fik-a (we arrived) |
| REL | -ye-(cl1), -cho-(cl7), -vyo-(cl8), -lo-(cl5), -po-(cl16), -ko-(cl17) | a-na-ye-som-a (who reads) |
| OBJ | ni/ku/m/mw/tu/wa/ki/vi/i/zi/li/ya | a-na-ni-pend-a (he loves me) |
| DERIV | -ish(caus), -w(pass), -an(recip), -ik(stat), -i(appl) | pend-ish-a (cause to love) |
| FV | -a (indicative), -e (subjunctive), -i (negative) | a-som-e (let him read) |

### Noun Class Agreement
| Class | SG Prefix | PL Prefix | Example |
|-------|-----------|-----------|---------|
| 1/2 | m-/mw- | wa- | mtu/watu (person) |
| 3/4 | m-/mw- | mi- | mti/miti (tree) |
| 5/6 | ji-/0 | ma- | jicho/macho (eye) |
| 7/8 | ki-/ch- | vi- | kitu/vitu (thing) |
| 9/10 | N-/0 | N-/0 | nyumba (house) |
| 11/14 | u- | - | ubao (board) |
| 15 | ku- | - | kusoma (reading) |
| 16/17/18 | pa-/ku-/mu- | - | mahali (place) |

### Class 9/10 Nasal Rules
N + b -> mb, N + d -> nd, N + g -> ng, N + j -> nj, N + y -> ny, N + z -> nz

### Derivational Suffix Stacking
Swahili allows chaining: ROOT + CAUS + APPL + RECIP + PASS + FV
Example: pend-esh-e-an-w-a (be made to love each other for)
Maximum practical depth: 4 suffixes.

### Copular Forms
- ni (is/am), si (is not), ndio (it is indeed)
- -ko/-po/-mo (locative: there is at/here/in)
- -na (have): nina (I have), kuna (there is), hakuna (there is not)

### Common Patterns
- Infinitive: ku- + root + -a (kusoma = to read)
- Habitual: hu- + root + -a (husoma = reads habitually)
- Perfect: SUBJ + me + root (nimesoma = I have read)
- Negative past: SUBJ + ku + root + -a (sikusoma = I didn't read)`;
