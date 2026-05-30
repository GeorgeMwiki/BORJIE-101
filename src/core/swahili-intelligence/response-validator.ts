/**
 * Swahili Response Validator and Terminology Enforcer
 *
 * Validates ALL Swahili AI responses before delivery to the user.
 * Checks noun class agreement, verb morphology, financial terminology,
 * and formality register. Runs in < 10ms on typical responses.
 *
 * The financial dictionary is loaded ONCE at module init and cached.
 */

import { analyzeWord } from "./morphological-analyzer";
import type { NounClass } from "./types";

// ============================================================================
// Public Types
// ============================================================================

export interface ValidationResult {
  readonly isValid: boolean;
  readonly score: number; // 0-1 quality score
  readonly issues: readonly ValidationIssue[];
  readonly correctedText: string | null; // Auto-corrected version if possible
}

export interface ValidationIssue {
  readonly type:
    | "noun_class_agreement"
    | "verb_morphology"
    | "terminology"
    | "formality"
    | "spelling";
  readonly severity: "error" | "warning" | "info";
  readonly position: number;
  readonly original: string;
  readonly suggestion: string;
  readonly explanation: string;
}

export interface ValidationContext {
  readonly formality: "formal" | "neutral" | "informal";
  readonly domain?: string;
}

export interface TerminologyCorrection {
  readonly original: string;
  readonly corrected: string;
  readonly term: string;
  readonly confidence: number;
}

// ============================================================================
// Noun Class Agreement Tables
// ============================================================================

/**
 * Noun class agreement patterns for classes 1-18.
 * Each class specifies: demonstrative prefixes (this/that),
 * possessive prefixes (my/your/etc.), adjective prefixes,
 * and subject-verb prefixes.
 */
interface NounClassAgreement {
  readonly demonstrativeThis: string; // "hii", "huu", etc.
  readonly demonstrativeThat: string; // "ile", "ule", etc.
  readonly possessivePrefix: string; // "w" -> wangu, "y" -> yangu
  readonly adjectivePrefix: string; // "m" -> mzuri, "ki" -> kizuri
  readonly subjectPrefix: string; // verb agreement: "a-", "i-", "ki-"
}

const NOUN_CLASS_AGREEMENT_TABLE: Readonly<Record<number, NounClassAgreement>> =
  {
    1: {
      demonstrativeThis: "huyu",
      demonstrativeThat: "yule",
      possessivePrefix: "w",
      adjectivePrefix: "m",
      subjectPrefix: "a",
    },
    2: {
      demonstrativeThis: "hawa",
      demonstrativeThat: "wale",
      possessivePrefix: "w",
      adjectivePrefix: "wa",
      subjectPrefix: "wa",
    },
    3: {
      demonstrativeThis: "huu",
      demonstrativeThat: "ule",
      possessivePrefix: "w",
      adjectivePrefix: "m",
      subjectPrefix: "u",
    },
    4: {
      demonstrativeThis: "hii",
      demonstrativeThat: "ile",
      possessivePrefix: "y",
      adjectivePrefix: "mi",
      subjectPrefix: "i",
    },
    5: {
      demonstrativeThis: "hili",
      demonstrativeThat: "lile",
      possessivePrefix: "l",
      adjectivePrefix: "",
      subjectPrefix: "li",
    },
    6: {
      demonstrativeThis: "haya",
      demonstrativeThat: "yale",
      possessivePrefix: "y",
      adjectivePrefix: "ma",
      subjectPrefix: "ya",
    },
    7: {
      demonstrativeThis: "hiki",
      demonstrativeThat: "kile",
      possessivePrefix: "ch",
      adjectivePrefix: "ki",
      subjectPrefix: "ki",
    },
    8: {
      demonstrativeThis: "hivi",
      demonstrativeThat: "vile",
      possessivePrefix: "vy",
      adjectivePrefix: "vi",
      subjectPrefix: "vi",
    },
    9: {
      demonstrativeThis: "hii",
      demonstrativeThat: "ile",
      possessivePrefix: "y",
      adjectivePrefix: "n",
      subjectPrefix: "i",
    },
    10: {
      demonstrativeThis: "hizi",
      demonstrativeThat: "zile",
      possessivePrefix: "z",
      adjectivePrefix: "n",
      subjectPrefix: "zi",
    },
    11: {
      demonstrativeThis: "huu",
      demonstrativeThat: "ule",
      possessivePrefix: "w",
      adjectivePrefix: "m",
      subjectPrefix: "u",
    },
    14: {
      demonstrativeThis: "huu",
      demonstrativeThat: "ule",
      possessivePrefix: "w",
      adjectivePrefix: "m",
      subjectPrefix: "u",
    },
    15: {
      demonstrativeThis: "huku",
      demonstrativeThat: "kule",
      possessivePrefix: "kw",
      adjectivePrefix: "ku",
      subjectPrefix: "ku",
    },
    16: {
      demonstrativeThis: "hapa",
      demonstrativeThat: "pale",
      possessivePrefix: "p",
      adjectivePrefix: "pa",
      subjectPrefix: "pa",
    },
    17: {
      demonstrativeThis: "huku",
      demonstrativeThat: "kule",
      possessivePrefix: "kw",
      adjectivePrefix: "ku",
      subjectPrefix: "ku",
    },
    18: {
      demonstrativeThis: "humu",
      demonstrativeThat: "mle",
      possessivePrefix: "mw",
      adjectivePrefix: "mu",
      subjectPrefix: "mu",
    },
  };

// Possessive suffixes that follow the class prefix
const POSSESSIVE_SUFFIXES: readonly string[] = [
  "angu",
  "ako",
  "ake",
  "etu",
  "enu",
  "ao",
];

// All demonstratives for quick lookup
const ALL_DEMONSTRATIVES: ReadonlySet<string> = new Set(
  Object.values(NOUN_CLASS_AGREEMENT_TABLE).flatMap((cls) => [
    cls.demonstrativeThis,
    cls.demonstrativeThat,
  ]),
);

// ============================================================================
// Subject-Verb Agreement Tables
// ============================================================================

interface SubjectVerbRule {
  readonly pronoun: string;
  readonly prefix: string;
  readonly negPrefix: string;
}

const SUBJECT_VERB_RULES: readonly SubjectVerbRule[] = [
  { pronoun: "mimi", prefix: "ni", negPrefix: "si" },
  { pronoun: "wewe", prefix: "u", negPrefix: "hu" },
  { pronoun: "yeye", prefix: "a", negPrefix: "ha" },
  { pronoun: "sisi", prefix: "tu", negPrefix: "hatu" },
  { pronoun: "ninyi", prefix: "m", negPrefix: "ham" },
  { pronoun: "wao", prefix: "wa", negPrefix: "hawa" },
];

// ============================================================================
// Formality Register Words
// ============================================================================

const INFORMAL_WORDS: ReadonlySet<string> = new Set([
  "sawa",
  "vipi",
  "mambo",
  "poa",
  "bro",
  "boss",
  "fiti",
  "safi",
  "kitu",
  "basi",
  "aisee",
  "kumbe",
  "kweli",
  "ebu",
  "hebu",
  "haki",
]);

const OVERLY_FORMAL_WORDS: ReadonlySet<string> = new Set([
  "kwa mujibu",
  "kwa kuzingatia",
  "ilhali",
  "hata hivyo",
  "kwa hivyo basi",
  "kwa sababu hiyo",
  "kutokana na",
  "kwa kadiri",
  "kulingana na",
  "kinachohusika",
]);

// ============================================================================
// Financial Dictionary Cache
// ============================================================================

interface DictionaryTerm {
  readonly id: string;
  readonly en: string;
  readonly sw: string;
  readonly category: string;
}

let cachedDictionary: readonly DictionaryTerm[] | null = null;
let cachedEnToSw: ReadonlyMap<string, string> | null = null;
let cachedSwToEn: ReadonlyMap<string, string> | null = null;

function loadDictionary(): readonly DictionaryTerm[] {
  if (cachedDictionary !== null) return cachedDictionary;

  try {
    // Dynamic import of the JSON dictionary
    // Path: src/core/swahili-intelligence/ -> ../../../ -> project root -> data/dictionaries/
    // eslint-disable-next-line @typescript-eslint/no-var-requires -- intentional `require` of a JSON data file to bypass Next.js' default ESM JSON loader behaviour at server boot
    const data = require("../../../data/dictionaries/sw-en-financial-dictionary.json");
    const terms: DictionaryTerm[] = (data.terms ?? []).map(
      (t: { id: string; en: string; sw: string; category: string }) => ({
        id: t.id,
        en: t.en,
        sw: t.sw,
        category: t.category,
      }),
    );
    cachedDictionary = terms;
    return terms;
  } catch {
    cachedDictionary = [];
    return [];
  }
}

function getEnToSwMap(): ReadonlyMap<string, string> {
  if (cachedEnToSw !== null) return cachedEnToSw;

  const terms = loadDictionary();
  const map = new Map<string, string>();
  for (const term of terms) {
    map.set(term.en.toLowerCase(), term.sw.toLowerCase());
  }
  cachedEnToSw = map;
  return map;
}

function getSwToEnMap(): ReadonlyMap<string, string> {
  if (cachedSwToEn !== null) return cachedSwToEn;

  const terms = loadDictionary();
  const map = new Map<string, string>();
  for (const term of terms) {
    map.set(term.sw.toLowerCase(), term.en.toLowerCase());
  }
  cachedSwToEn = map;
  return map;
}

// ============================================================================
// Core Validation Function
// ============================================================================

/**
 * Validate a Swahili AI response before delivery.
 * Checks noun class agreement, verb morphology, terminology, and formality.
 * Target: < 10ms for typical responses.
 */
export function validateSwahiliResponse(
  text: string,
  context: ValidationContext,
): ValidationResult {
  if (!text || text.trim().length === 0) {
    return {
      isValid: true,
      score: 1.0,
      issues: [],
      correctedText: null,
    };
  }

  const issues: ValidationIssue[] = [];

  // Run all checks
  const nounClassIssues = checkNounClassAgreement(text);
  const verbIssues = checkVerbMorphology(text);
  const terminologyIssues = checkTerminology(text);
  const formalityIssues = checkFormality(text, context.formality);

  issues.push(
    ...nounClassIssues,
    ...verbIssues,
    ...terminologyIssues,
    ...formalityIssues,
  );

  // Calculate score: errors deduct 0.15, warnings 0.05, info 0.02
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  const rawScore =
    1.0 - errorCount * 0.15 - warningCount * 0.05 - infoCount * 0.02;
  const score = Math.max(0, Math.min(1, rawScore));

  // Attempt auto-correction for errors and warnings
  const correctedText = attemptAutoCorrection(text, issues);

  return {
    isValid: errorCount === 0,
    score,
    issues,
    correctedText,
  };
}

// ============================================================================
// Check 1: Noun Class Agreement
// ============================================================================

/**
 * Known nouns with their noun classes for agreement checking.
 * Only high-frequency financial/common nouns to keep checks fast.
 */
const KNOWN_NOUNS_WITH_CLASS: ReadonlyMap<string, NounClass> = new Map<
  string,
  NounClass
>([
  // Class 1/2 (m-/wa-) - people
  ["mtu", 1],
  ["mteja", 1],
  ["mkopaji", 1],
  ["mkopeshaji", 1],
  ["mdhamini", 1],
  ["mfanyabiashara", 1],
  ["meneja", 1],
  ["afisa", 1],
  // Class 3/4 (m-/mi-) - trees, plants, abstract
  ["mkopo", 3],
  ["mkataba", 3],
  ["mpango", 3],
  ["msingi", 3],
  ["mfumo", 3],
  ["muda", 3],
  ["mwaka", 3],
  ["mwezi", 3],
  // Class 5/6 (ji-/ma-) - augmentative, paired, collective
  ["jambo", 5],
  ["jina", 5],
  ["jibu", 5],
  ["ombi", 5],
  ["deni", 5],
  ["mapato", 6],
  ["malipo", 6],
  ["maombi", 6],
  ["masharti", 6],
  // Class 7/8 (ki-/vi-) - small things, languages, manner
  ["kitu", 7],
  ["kiasi", 7],
  ["kipindi", 7],
  ["kiwango", 7],
  ["kitabu", 7],
  // Class 9/10 (n-/n-) - most foreign loans, many nouns
  ["benki", 9],
  ["riba", 9],
  ["pesa", 9],
  ["biashara", 9],
  ["bima", 9],
  ["hisa", 9],
  ["leseni", 9],
  ["soko", 9],
  ["bei", 9],
  ["faida", 9],
  ["hasara", 9],
  ["gharama", 9],
  ["akaunti", 9],
  ["shilingi", 9],
  ["fedha", 9],
  ["dhamana", 9],
  ["hatari", 9],
  ["taarifa", 9],
  ["fomu", 9],
  ["hati", 9],
  ["kampuni", 9],
  ["serikali", 9],
  // Class 11 (u-)
  ["utaratibu", 11],
  ["usalama", 11],
  ["uhakiki", 11],
  ["uwiano", 11],
  ["usajili", 11],
  // Class 14 (u-)
  ["umaskini", 14],
  ["utajiri", 14],
  ["ujasiriamali", 14],
  ["ufanisi", 14],
  // Class 15 (ku-) - verbal nouns
  ["kulipa", 15],
  ["kukopa", 15],
  ["kufanya", 15],
]);

function checkNounClassAgreement(text: string): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const words = tokenize(text);

  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i].toLowerCase();
    const nextWord = words[i + 1].toLowerCase();

    // Check if current word is a known noun
    const nounClass = KNOWN_NOUNS_WITH_CLASS.get(word);
    if (nounClass === undefined) continue;

    const agreement = NOUN_CLASS_AGREEMENT_TABLE[nounClass];
    if (!agreement) continue;

    // Check demonstrative agreement: "noun + demonstrative"
    if (ALL_DEMONSTRATIVES.has(nextWord)) {
      const correctThis = agreement.demonstrativeThis;
      const correctThat = agreement.demonstrativeThat;

      if (nextWord !== correctThis && nextWord !== correctThat) {
        issues.push({
          type: "noun_class_agreement",
          severity: "error",
          position: computePosition(text, i),
          original: `${word} ${nextWord}`,
          suggestion: `${word} ${correctThis}`,
          explanation: `"${word}" is class ${nounClass}; demonstrative should be "${correctThis}" (this) or "${correctThat}" (that), not "${nextWord}"`,
        });
      }
    }

    // Check possessive agreement: "noun + possessive"
    for (const suffix of POSSESSIVE_SUFFIXES) {
      if (nextWord.endsWith(suffix)) {
        const actualPrefix = nextWord.slice(0, nextWord.length - suffix.length);
        const expectedPrefix = agreement.possessivePrefix;

        if (
          actualPrefix.length > 0 &&
          actualPrefix !== expectedPrefix &&
          isPossessiveWord(nextWord)
        ) {
          const corrected = `${expectedPrefix}${suffix}`;
          issues.push({
            type: "noun_class_agreement",
            severity: "error",
            position: computePosition(text, i),
            original: `${word} ${nextWord}`,
            suggestion: `${word} ${corrected}`,
            explanation: `"${word}" is class ${nounClass}; possessive prefix should be "${expectedPrefix}-" (e.g. "${corrected}"), not "${actualPrefix}-"`,
          });
        }
        break;
      }
    }

    // Check adjective prefix agreement for common adjectives
    if (isSwahiliAdjective(nextWord)) {
      const adjRoot = extractAdjectiveRoot(nextWord);
      if (adjRoot) {
        const actualPrefix = nextWord.slice(
          0,
          nextWord.length - adjRoot.length,
        );
        const expectedPrefix = agreement.adjectivePrefix;

        // Only flag if the prefix is recognizable but wrong
        if (
          actualPrefix.length > 0 &&
          actualPrefix !== expectedPrefix &&
          isKnownAdjectivePrefix(actualPrefix)
        ) {
          const corrected = `${expectedPrefix}${adjRoot}`;
          issues.push({
            type: "noun_class_agreement",
            severity: "warning",
            position: computePosition(text, i),
            original: `${word} ${nextWord}`,
            suggestion: `${word} ${corrected}`,
            explanation: `"${word}" is class ${nounClass}; adjective prefix should be "${expectedPrefix}-" (e.g. "${corrected}")`,
          });
        }
      }
    }
  }

  return issues;
}

// ============================================================================
// Check 2: Verb Morphology
// ============================================================================

function checkVerbMorphology(text: string): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const words = tokenize(text);

  for (let i = 0; i < words.length - 1; i++) {
    const word = words[i].toLowerCase();
    const nextWord = words[i + 1].toLowerCase();

    // Check subject-verb agreement with pronouns
    const rule = SUBJECT_VERB_RULES.find((r) => r.pronoun === word);
    if (rule) {
      // The next word should be a verb starting with the correct prefix
      const analysis = analyzeWord(nextWord);
      if (analysis.isVerb && analysis.subjectPrefix) {
        const expectedPrefix = rule.prefix;
        const expectedNeg = rule.negPrefix;

        if (
          analysis.subjectPrefix !== expectedPrefix &&
          analysis.subjectPrefix !== expectedNeg &&
          // Allow negation prefix combinations
          !(analysis.negation && analysis.subjectPrefix === expectedPrefix)
        ) {
          // Build the corrected form
          const correctedVerb = rebuildVerb(analysis, expectedPrefix);
          if (correctedVerb) {
            issues.push({
              type: "verb_morphology",
              severity: "error",
              position: computePosition(text, i),
              original: `${word} ${nextWord}`,
              suggestion: `${word} ${correctedVerb}`,
              explanation: `"${word}" requires subject prefix "${expectedPrefix}-" on the verb, found "${analysis.subjectPrefix}-"`,
            });
          }
        }
      }
    }

    // Check final vowel consistency
    if (i > 0) {
      const analysis = analyzeWord(word);
      if (analysis.isVerb && analysis.finalVowel) {
        // In negative constructions, final vowel should often be -i (not -a)
        if (analysis.negation && analysis.finalVowel === "a") {
          // This is a common but not universal rule; flag as info
          issues.push({
            type: "verb_morphology",
            severity: "info",
            position: computePosition(text, i - 1),
            original: word,
            suggestion: `${word.slice(0, -1)}i`,
            explanation:
              "Negative verb forms typically end in -i instead of -a in Standard Kiswahili",
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Rebuild a verb with a corrected subject prefix.
 */
function rebuildVerb(
  analysis: ReturnType<typeof analyzeWord>,
  correctPrefix: string,
): string | null {
  if (!analysis.isVerb) return null;

  const parts: string[] = [];
  if (analysis.negation) parts.push(analysis.negation);
  parts.push(correctPrefix);
  if (analysis.tenseMarker) parts.push(analysis.tenseMarker);
  if (analysis.objectPrefix) parts.push(analysis.objectPrefix);
  parts.push(analysis.root);
  for (const suffix of analysis.derivationalSuffixes) {
    // Map suffix type back to the most common suffix string
    const suffixMap: Record<string, string> = {
      causative: "ish",
      passive: "w",
      reciprocal: "an",
      stative: "ik",
      applicative: "i",
      reversive: "u",
    };
    parts.push(suffixMap[suffix] ?? "");
  }
  if (analysis.finalVowel) parts.push(analysis.finalVowel);

  return parts.join("");
}

// ============================================================================
// Check 3: Terminology Enforcement
// ============================================================================

function checkTerminology(text: string): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const enToSw = getEnToSwMap();
  const lowerText = text.toLowerCase();

  // Scan for English financial terms that should be in Swahili
  for (const [enTerm, swTerm] of enToSw) {
    // Only check multi-character terms to avoid false positives
    if (enTerm.length < 4) continue;

    const enIndex = lowerText.indexOf(enTerm);
    if (enIndex === -1) continue;

    // Check word boundaries to avoid partial matches
    const charBefore = enIndex > 0 ? lowerText[enIndex - 1] : " ";
    const charAfter =
      enIndex + enTerm.length < lowerText.length
        ? lowerText[enIndex + enTerm.length]
        : " ";

    if (!isWordBoundary(charBefore) || !isWordBoundary(charAfter)) continue;

    // Skip terms that are commonly left in English (acronyms, tech terms)
    if (isAcceptableEnglish(enTerm)) continue;

    issues.push({
      type: "terminology",
      severity: "warning",
      position: enIndex,
      original: text.slice(enIndex, enIndex + enTerm.length),
      suggestion: swTerm,
      explanation: `Financial term "${enTerm}" has an approved Swahili translation: "${swTerm}"`,
    });
  }

  return issues;
}

// Terms acceptable to keep in English even in Swahili context
const ACCEPTABLE_ENGLISH_TERMS: ReadonlySet<string> = new Set([
  "dsr",
  "ltv",
  "roi",
  "atm",
  "pin",
  "sim",
  "ussd",
  "api",
  "crb",
  "bot",
  "ipo",
  "gdp",
  "ngo",
  "sme",
  "kyc",
  "aml",
  "collateral",
  "equity",
  "portfolio",
  "premium",
  "default",
]);

function isAcceptableEnglish(term: string): boolean {
  return ACCEPTABLE_ENGLISH_TERMS.has(term.toLowerCase());
}

// ============================================================================
// Check 4: Formality Register
// ============================================================================

function checkFormality(
  text: string,
  formality: "formal" | "neutral" | "informal",
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const words = tokenize(text);

  if (formality === "formal") {
    // Flag informal words in formal context
    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase();
      if (INFORMAL_WORDS.has(word)) {
        issues.push({
          type: "formality",
          severity: "warning",
          position: computePosition(text, i),
          original: word,
          suggestion: getFormalAlternative(word),
          explanation: `"${word}" is informal; consider a more formal alternative in this context`,
        });
      }
    }
  } else if (formality === "informal") {
    // Flag overly formal constructions in informal context
    const lowerText = text.toLowerCase();
    for (const phrase of OVERLY_FORMAL_WORDS) {
      const idx = lowerText.indexOf(phrase);
      if (idx !== -1) {
        issues.push({
          type: "formality",
          severity: "info",
          position: idx,
          original: text.slice(idx, idx + phrase.length),
          suggestion: getInformalAlternative(phrase),
          explanation: `"${phrase}" sounds overly formal for casual conversation`,
        });
      }
    }
  }

  return issues;
}

function getFormalAlternative(word: string): string {
  const alternatives: Readonly<Record<string, string>> = {
    sawa: "ndio",
    vipi: "je",
    mambo: "habari",
    poa: "nzuri",
    bro: "ndugu",
    boss: "bwana",
    fiti: "vizuri",
    safi: "vizuri",
    kitu: "jambo",
    basi: "hivyo",
    aisee: "",
    kumbe: "kwa kweli",
    kweli: "hakika",
    ebu: "tafadhali",
    hebu: "tafadhali",
    haki: "kweli",
  };
  return alternatives[word] ?? word;
}

function getInformalAlternative(phrase: string): string {
  const alternatives: Readonly<Record<string, string>> = {
    "kwa mujibu": "kulingana na",
    "kwa kuzingatia": "kwa sababu",
    ilhali: "wakati",
    "hata hivyo": "lakini",
    "kwa hivyo basi": "kwa hiyo",
    "kwa sababu hiyo": "kwa hiyo",
    "kutokana na": "kwa sababu ya",
    "kwa kadiri": "kadri",
    "kulingana na": "kama",
    kinachohusika: "husika",
  };
  return alternatives[phrase] ?? phrase;
}

// ============================================================================
// Terminology Enforcer (Standalone Export)
// ============================================================================

/**
 * Enforce consistent use of approved financial terminology.
 * Scans text for incorrect or inconsistent translations and returns corrections.
 */
export function enforceTerminology(
  text: string,
  targetLang: "sw" | "en",
): {
  readonly correctedText: string;
  readonly corrections: readonly TerminologyCorrection[];
} {
  const corrections: TerminologyCorrection[] = [];
  let correctedText = text;

  if (targetLang === "sw") {
    // Scan for English terms that should be in Swahili
    const enToSw = getEnToSwMap();

    for (const [enTerm, swTerm] of enToSw) {
      if (enTerm.length < 4) continue;
      if (isAcceptableEnglish(enTerm)) continue;

      const regex = new RegExp(`\\b${escapeRegExp(enTerm)}\\b`, "gi");
      const match = regex.exec(correctedText);
      if (match) {
        corrections.push({
          original: match[0],
          corrected: swTerm,
          term: enTerm,
          confidence: 0.85,
        });
        correctedText = correctedText.replace(regex, swTerm);
      }
    }
  } else {
    // Scan for Swahili terms, suggest English equivalents
    const swToEn = getSwToEnMap();

    for (const [swTerm, enTerm] of swToEn) {
      if (swTerm.length < 4) continue;

      const regex = new RegExp(`\\b${escapeRegExp(swTerm)}\\b`, "gi");
      const match = regex.exec(correctedText);
      if (match) {
        corrections.push({
          original: match[0],
          corrected: enTerm,
          term: swTerm,
          confidence: 0.85,
        });
        correctedText = correctedText.replace(regex, enTerm);
      }
    }
  }

  return { correctedText, corrections };
}

// ============================================================================
// Auto-Correction
// ============================================================================

function attemptAutoCorrection(
  text: string,
  issues: readonly ValidationIssue[],
): string | null {
  // Only auto-correct errors and warnings, not info
  const correctableIssues = issues.filter(
    (i) =>
      (i.severity === "error" || i.severity === "warning") &&
      i.suggestion.length > 0,
  );

  if (correctableIssues.length === 0) return null;

  let corrected = text;
  // Apply corrections from end to start to preserve positions
  const sorted = [...correctableIssues].sort((a, b) => b.position - a.position);

  for (const issue of sorted) {
    // Find the original text at position and replace
    const idx = corrected.toLowerCase().indexOf(issue.original.toLowerCase());
    if (idx !== -1) {
      corrected =
        corrected.slice(0, idx) +
        issue.suggestion +
        corrected.slice(idx + issue.original.length);
    }
  }

  return corrected !== text ? corrected : null;
}

// ============================================================================
// Utility Functions
// ============================================================================

function tokenize(text: string): readonly string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

function computePosition(text: string, wordIndex: number): number {
  const words = text.split(/\s+/);
  let pos = 0;
  for (let i = 0; i < wordIndex && i < words.length; i++) {
    pos += words[i].length + 1; // +1 for space
  }
  return pos;
}

function isWordBoundary(char: string): boolean {
  return /[\s,.;:!?()[\]{}'"/-]/.test(char) || char === " ";
}

function isPossessiveWord(word: string): boolean {
  const possessives = new Set([
    "wangu",
    "wako",
    "wake",
    "wetu",
    "wenu",
    "wao",
    "yangu",
    "yako",
    "yake",
    "yetu",
    "yenu",
    "yao",
    "langu",
    "lako",
    "lake",
    "letu",
    "lenu",
    "lao",
    "changu",
    "chako",
    "chake",
    "chetu",
    "chenu",
    "chao",
    "vyangu",
    "vyako",
    "vyake",
    "vyetu",
    "vyenu",
    "vyao",
    "zangu",
    "zako",
    "zake",
    "zetu",
    "zenu",
    "zao",
    "pangu",
    "pako",
    "pake",
    "petu",
    "penu",
    "pao",
    "kwangu",
    "kwako",
    "kwake",
    "kwetu",
    "kwenu",
    "kwao",
    "mwangu",
    "mwako",
    "mwake",
    "mwetu",
    "mwenu",
    "mwao",
  ]);
  return possessives.has(word.toLowerCase());
}

// Common Swahili adjective roots
const ADJECTIVE_ROOTS: ReadonlySet<string> = new Set([
  "zuri",
  "baya",
  "kubwa",
  "dogo",
  "refu",
  "fupi",
  "pya",
  "kuu",
  "ingi",
  "chache",
  "gumu",
  "rahisi",
  "pana",
  "embamba",
  "zito",
  "epesi",
]);

function isSwahiliAdjective(word: string): boolean {
  const lower = word.toLowerCase();
  for (const root of ADJECTIVE_ROOTS) {
    if (lower.endsWith(root)) return true;
  }
  return false;
}

function extractAdjectiveRoot(word: string): string | null {
  const lower = word.toLowerCase();
  for (const root of ADJECTIVE_ROOTS) {
    if (lower.endsWith(root)) return root;
  }
  return null;
}

// Known adjective prefixes for cross-checking
const KNOWN_ADJ_PREFIXES: ReadonlySet<string> = new Set([
  "m",
  "wa",
  "mi",
  "ma",
  "ki",
  "vi",
  "n",
  "ku",
  "pa",
  "mu",
  "",
]);

function isKnownAdjectivePrefix(prefix: string): boolean {
  return KNOWN_ADJ_PREFIXES.has(prefix);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================================
// Relative Marker (unused as public, but referenced in analysis)
// ============================================================================
// The relativeMarker field in MorphemeBreakdown is populated by the analyzer
// but not checked here; it's structural, not an agreement issue.
