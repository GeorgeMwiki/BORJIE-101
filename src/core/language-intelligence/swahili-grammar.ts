/**
 * Swahili Grammar Engine
 *
 * Production-grade Swahili grammar validation, correction, and analysis.
 * Covers the 18 noun class system, agglutinative verb morphology,
 * subject-verb agreement, sentence structure, and common grammar errors
 * in Tanzanian digital Swahili.
 *
 * This is the linguistic backbone that turns Borjie from "understands Swahili"
 * to "speaks Swahili like a native banking professional."
 *
 * Key Features:
 * - Noun class detection with agreement validation
 * - Verb morphology decomposition (prefix-tense-object-root-suffix)
 * - Common grammar error detection and auto-correction
 * - Sentence formulation quality scoring
 * - Code-switching grammar rules (Swahili frame + English terms)
 * - Tanzania-specific dialect awareness
 *
 * @module swahili-grammar
 */

// ============================================================================
// Types
// ============================================================================

export interface NounClassInfo {
  readonly classNumber: number;
  readonly singularPrefix: string;
  readonly pluralPrefix: string;
  readonly subjectConcord: {
    readonly singular: string;
    readonly plural: string;
  };
  readonly objectConcord: {
    readonly singular: string;
    readonly plural: string;
  };
  readonly possessive: { readonly singular: string; readonly plural: string };
  readonly adjConcord: { readonly singular: string; readonly plural: string };
  readonly examples: readonly string[];
  readonly semantic: string;
}

export interface VerbMorphology {
  readonly subjectPrefix: string;
  readonly tenseMarker: string;
  readonly objectInfix: string | null;
  readonly root: string;
  readonly derivationalSuffix: string | null;
  readonly finalVowel: string;
  readonly isNegative: boolean;
  readonly isRelative: boolean;
  readonly meaning: string;
}

export interface GrammarIssue {
  readonly type:
    | "agreement"
    | "tense"
    | "structure"
    | "formality"
    | "spelling_grammar"
    | "loan_word";
  readonly severity: "error" | "warning" | "suggestion";
  readonly original: string;
  readonly corrected: string;
  readonly explanation: string;
  readonly position: number;
}

export interface GrammarCheckResult {
  readonly text: string;
  readonly correctedText: string;
  readonly issues: readonly GrammarIssue[];
  readonly score: number; // 0-1 quality score
  readonly hasIssues: boolean;
}

export interface SentenceAnalysis {
  readonly structure: "SVO" | "SOV" | "question" | "imperative" | "fragment";
  readonly hasSubject: boolean;
  readonly hasVerb: boolean;
  readonly hasObject: boolean;
  readonly nounClasses: readonly { word: string; classNumber: number }[];
  readonly verbForms: readonly VerbMorphology[];
  readonly formalityLevel: "formal" | "neutral" | "informal";
}

// ============================================================================
// Swahili Noun Class System (18 classes)
// ============================================================================

/**
 * Complete Swahili noun class system.
 * Classes 1-18 cover all noun categories in Standard Swahili.
 * Each class has specific prefixes and agreement patterns.
 */
export const NOUN_CLASSES: readonly NounClassInfo[] = [
  {
    classNumber: 1,
    singularPrefix: "m-",
    pluralPrefix: "wa-",
    subjectConcord: { singular: "a-", plural: "wa-" },
    objectConcord: { singular: "-m-", plural: "-wa-" },
    possessive: { singular: "w-", plural: "w-" },
    adjConcord: { singular: "m-", plural: "wa-" },
    examples: [
      "mtu/watu",
      "mwalimu/walimu",
      "mtoto/watoto",
      "mfanyakazi/wafanyakazi",
      "mkopaji/wakopaji",
    ],
    semantic: "people, animate beings",
  },
  {
    classNumber: 3,
    singularPrefix: "m-",
    pluralPrefix: "mi-",
    subjectConcord: { singular: "u-", plural: "i-" },
    objectConcord: { singular: "-u-", plural: "-i-" },
    possessive: { singular: "w-", plural: "y-" },
    adjConcord: { singular: "m-", plural: "mi-" },
    examples: [
      "mti/miti",
      "mkopo/mikopo",
      "mwezi/miezi",
      "mkataba/mikataba",
      "mfuko/mifuko",
    ],
    semantic: "trees, plants, loans, months, contracts",
  },
  {
    classNumber: 5,
    singularPrefix: "ji-/0-",
    pluralPrefix: "ma-",
    subjectConcord: { singular: "li-", plural: "ya-" },
    objectConcord: { singular: "-li-", plural: "-ya-" },
    possessive: { singular: "l-", plural: "y-" },
    adjConcord: { singular: "-", plural: "ma-" },
    examples: [
      "jicho/macho",
      "jina/majina",
      "jambo/mambo",
      "ombi/maombi",
      "malipo",
      "mapato",
    ],
    semantic: "paired things, augmentatives, abstract nouns",
  },
  {
    classNumber: 7,
    singularPrefix: "ki-",
    pluralPrefix: "vi-",
    subjectConcord: { singular: "ki-", plural: "vi-" },
    objectConcord: { singular: "-ki-", plural: "-vi-" },
    possessive: { singular: "ch-", plural: "vy-" },
    adjConcord: { singular: "ki-", plural: "vi-" },
    examples: [
      "kitu/vitu",
      "kitabu/vitabu",
      "kiasi/viasi",
      "kiwango/viwango",
      "kibali/vibali",
    ],
    semantic: "things, diminutives, amounts, standards",
  },
  {
    classNumber: 9,
    singularPrefix: "n-/0-",
    pluralPrefix: "n-/0-",
    subjectConcord: { singular: "i-", plural: "zi-" },
    objectConcord: { singular: "-i-", plural: "-zi-" },
    possessive: { singular: "y-", plural: "z-" },
    adjConcord: { singular: "n-", plural: "n-" },
    examples: [
      "nyumba/nyumba",
      "fedha/fedha",
      "benki/benki",
      "riba/riba",
      "dhamana/dhamana",
      "hisa/hisa",
    ],
    semantic: "animals, loanwords, many financial terms",
  },
  {
    classNumber: 11,
    singularPrefix: "u-",
    pluralPrefix: "n-",
    subjectConcord: { singular: "u-", plural: "zi-" },
    objectConcord: { singular: "-u-", plural: "-zi-" },
    possessive: { singular: "w-", plural: "z-" },
    adjConcord: { singular: "m-", plural: "n-" },
    examples: ["ukuta/kuta", "uso/nyuso", "uthibitisho", "usajili", "uhamisho"],
    semantic: "long/thin objects, abstract nouns, processes",
  },
  {
    classNumber: 15,
    singularPrefix: "ku-",
    pluralPrefix: "",
    subjectConcord: { singular: "ku-", plural: "" },
    objectConcord: { singular: "-ku-", plural: "" },
    possessive: { singular: "kw-", plural: "" },
    adjConcord: { singular: "ku-", plural: "" },
    examples: ["kusoma", "kulipa", "kukopa", "kufanya", "kuomba"],
    semantic: "infinitives (verbal nouns)",
  },
  {
    classNumber: 16,
    singularPrefix: "pa-",
    pluralPrefix: "",
    subjectConcord: { singular: "pa-", plural: "" },
    objectConcord: { singular: "-pa-", plural: "" },
    possessive: { singular: "p-", plural: "" },
    adjConcord: { singular: "pa-", plural: "" },
    examples: ["mahali", "pahali", "hapa"],
    semantic: "definite location (at)",
  },
  {
    classNumber: 17,
    singularPrefix: "ku-",
    pluralPrefix: "",
    subjectConcord: { singular: "ku-", plural: "" },
    objectConcord: { singular: "-ku-", plural: "" },
    possessive: { singular: "kw-", plural: "" },
    adjConcord: { singular: "ku-", plural: "" },
    examples: ["kule", "huku"],
    semantic: "indefinite location (to/toward)",
  },
  {
    classNumber: 18,
    singularPrefix: "mu-",
    pluralPrefix: "",
    subjectConcord: { singular: "mu-", plural: "" },
    objectConcord: { singular: "-mu-", plural: "" },
    possessive: { singular: "mw-", plural: "" },
    adjConcord: { singular: "mu-", plural: "" },
    examples: ["ndani", "nyumbani", "benkini"],
    semantic: "inside location (in/within)",
  },
];

// ============================================================================
// Verb Morphology Tables
// ============================================================================

/**
 * Subject prefixes for Swahili verb conjugation.
 * These attach to the front of the verb to indicate who is performing the action.
 */
const SUBJECT_PREFIXES: Record<string, string> = {
  ni: "1st person singular (I)",
  u: "2nd person singular (you) / class 3/11",
  a: "3rd person singular (he/she)",
  tu: "1st person plural (we)",
  m: "2nd person plural (you all)",
  wa: "3rd person plural (they)",
  i: "class 9 singular / class 4",
  li: "class 5 singular",
  ya: "class 6 plural",
  ki: "class 7 singular",
  vi: "class 8 plural",
  zi: "class 10 plural",
  ku: "class 15/17",
  pa: "class 16",
  mu: "class 18",
};

/**
 * Tense/aspect markers in Swahili.
 */
const TENSE_MARKERS: Record<string, { label: string; usage: string }> = {
  na: {
    label: "present continuous",
    usage: "Happening now: nina-soma = I am reading",
  },
  li: { label: "past simple", usage: "Happened before: nili-soma = I read" },
  ta: { label: "future", usage: "Will happen: nita-soma = I will read" },
  me: {
    label: "perfect/completed",
    usage: "Just completed: nime-soma = I have read",
  },
  ki: {
    label: "conditional/habitual",
    usage: "If/when: niki-soma = if I read",
  },
  nge: {
    label: "conditional hypothetical",
    usage: "Would: ninge-soma = I would read",
  },
  ngali: {
    label: "past conditional",
    usage: "Would have: ningali-soma = I would have read",
  },
  ka: {
    label: "narrative/consecutive",
    usage: "Then: aka-soma = then he read",
  },
  japo: {
    label: "concessive",
    usage: "Even though: ajaposoma = even though he reads",
  },
  sipo: {
    label: "negative conditional",
    usage: "If not: asipo-soma = if he doesn't read",
  },
  hu: {
    label: "habitual",
    usage: "Regularly does: husoma = he regularly reads",
  },
};

/**
 * Negative prefixes that negate the verb.
 */
const NEGATIVE_PATTERNS: ReadonlyArray<{ prefix: string; person: string }> = [
  { prefix: "si", person: "1st singular negative (I don't)" },
  { prefix: "hu", person: "2nd singular negative (you don't)" },
  { prefix: "ha", person: "3rd singular negative (he/she doesn't)" },
  { prefix: "hatu", person: "1st plural negative (we don't)" },
  { prefix: "ham", person: "2nd plural negative (you all don't)" },
  { prefix: "hawa", person: "3rd plural negative (they don't)" },
];

/**
 * Derivational suffixes that change verb meaning.
 */
const DERIVATIONAL_SUFFIXES: Record<string, string> = {
  isha: "causative (make someone do)",
  wa: "passive (be done to)",
  ana: "reciprocal (do to each other)",
  ia: "applicative (do for someone)",
  ika: "stative (be in a state)",
  ua: "reversive (undo)",
  esha: "intensive causative",
  iana: "reciprocal applicative",
};

// ============================================================================
// Common Swahili Verb Roots (banking/financial context)
// ============================================================================

const VERB_ROOTS: Record<string, string> = {
  lipa: "pay",
  kopa: "borrow",
  kopesha: "lend",
  omba: "request/apply",
  weka: "deposit/save",
  toa: "withdraw/give",
  fanya: "do/make",
  enda: "go",
  ja: "come",
  soma: "read/study",
  andika: "write/register",
  sajili: "register",
  thibitisha: "confirm/verify",
  kubali: "agree/approve",
  kataa: "refuse/reject",
  rejea: "refer/return",
  hamisha: "transfer",
  hifadhi: "save/preserve",
  hesabu: "calculate/count",
  tathmini: "evaluate/assess",
  kagua: "inspect/review",
  panga: "plan/arrange",
  tengeneza: "prepare/fix",
  elewa: "understand",
  eleza: "explain",
  jua: "know",
  taka: "want",
  hitaji: "need",
  weza: "can/be able",
  pata: "get/receive",
  saidia: "help",
  uliza: "ask",
  jibu: "answer",
  chagua: "choose/select",
  angalia: "look/check",
  kamilisha: "complete/finish",
  anza: "start/begin",
  endelea: "continue",
  maliza: "finish",
  funga: "close",
  fungua: "open",
  saini: "sign",
  wasilisha: "submit/present",
  pokea: "receive/accept",
  peleka: "send/take",
  leta: "bring",
  rudisha: "return/refund",
  nunua: "buy/purchase",
  uza: "sell",
  ingiza: "enter/input",
  ondoa: "remove",
  badilisha: "change/exchange",
  punguza: "reduce",
  ongeza: "increase/add",
  gawanya: "divide/distribute",
  jumlisha: "total/sum up",
};

// ============================================================================
// Noun-Class Aware Word Database
// ============================================================================

/**
 * Maps common nouns to their noun class for agreement validation.
 * Covers banking, financial, and everyday vocabulary.
 */
const NOUN_CLASS_MAP: Record<string, number> = {
  // Class 1/2 (m-/wa-) — People
  mtu: 1,
  watu: 2,
  mwalimu: 1,
  walimu: 2,
  mtoto: 1,
  watoto: 2,
  mkopaji: 1,
  wakopaji: 2,
  mfanyabiashara: 1,
  wafanyabiashara: 2,
  mteja: 1,
  wateja: 2,
  meneja: 1,
  mwenye: 1,
  mwombaji: 1,
  wombaji: 2,
  mdhamini: 1,
  wadhamini: 2,
  afisa: 1,
  maafisa: 6,
  mkaguzi: 1,
  wakaguzi: 2,
  mthibitishaji: 1,
  wathibitishaji: 2,
  // Class 3/4 (m-/mi-) — Trees, plants, abstract
  mkopo: 3,
  mikopo: 4,
  mwezi: 3,
  miezi: 4,
  mkataba: 3,
  mikataba: 4,
  mfuko: 3,
  mifuko: 4,
  muda: 3,
  mchango: 3,
  michango: 4,
  mpango: 3,
  mipango: 4,
  mti: 3,
  miti: 4,
  mto: 3,
  mito: 4,
  mradi: 3,
  miradi: 4,
  msingi: 3,
  misingi: 4,
  mwaka: 3,
  miaka: 4,
  mshahara: 3,
  mishahara: 4,
  // Class 5/6 (ji-/ma-) — Augmentatives, pairs, abstract
  jina: 5,
  majina: 6,
  jambo: 5,
  mambo: 6,
  ombi: 5,
  maombi: 6,
  jibu: 5,
  majibu: 6,
  malipo: 6,
  mapato: 6,
  matokeo: 6,
  maelezo: 6,
  maendeleo: 6,
  makubaliano: 6,
  masharti: 6,
  madeni: 6,
  mahesabu: 6,
  mazingira: 6,
  // Class 7/8 (ki-/vi-) — Things, diminutives
  kitu: 7,
  vitu: 8,
  kitabu: 7,
  vitabu: 8,
  kiasi: 7,
  viasi: 8,
  kiwango: 7,
  viwango: 8,
  kibali: 7,
  vibali: 8,
  kielelezo: 7,
  vielelezo: 8,
  kipindi: 7,
  vipindi: 8,
  kikundi: 7,
  vikundi: 8,
  // Class 9/10 (n-/n-) — Animals, loanwords, many financial terms
  nyumba: 9,
  fedha: 9,
  benki: 9,
  riba: 9,
  dhamana: 9,
  hisa: 9,
  bima: 9,
  kodi: 9,
  hati: 9,
  ada: 9,
  bei: 9,
  biashara: 9,
  akaunti: 9,
  asilimia: 9,
  leseni: 9,
  kampuni: 9,
  shirika: 9,
  simu: 9,
  sababu: 9,
  njia: 9,
  taarifa: 9,
  habari: 9,
  barua: 9,
  hatua: 9,
  faida: 9,
  hasara: 9,
  siku: 9,
  wiki: 9,
  nchi: 9,
  nafasi: 9,
  sheria: 9,
  // Class 11 (u-) — Abstract nouns, processes
  uthibitisho: 11,
  usajili: 11,
  uhamisho: 11,
  uzuri: 11,
  ubaya: 11,
  uwezo: 11,
  umri: 11,
  ukaguzi: 11,
  utaratibu: 11,
  ushirikiano: 11,
  ulipaji: 11,
  ukopaji: 11,
  uchumi: 11,
};

// ============================================================================
// Grammar Checking Functions
// ============================================================================

/**
 * Detect the noun class of a Swahili word.
 * Uses dictionary lookup first, then prefix-based heuristics.
 */
export function detectNounClass(word: string): number | null {
  const lower = word.toLowerCase();

  // Direct lookup
  if (NOUN_CLASS_MAP[lower] !== undefined) {
    return NOUN_CLASS_MAP[lower];
  }

  // Prefix-based heuristics
  if (/^(m[^aeiou])/.test(lower) && lower.length > 3) {
    // m- before consonant: class 1 or 3
    // If ends in -i or -ji, likely class 1 (agent noun)
    if (/ji$/.test(lower) || /zi$/.test(lower)) return 1;
    return 3;
  }
  if (/^wa/.test(lower) && lower.length > 3) return 2;
  if (/^mi/.test(lower) && lower.length > 3) return 4;
  if (/^ma/.test(lower) && lower.length > 3) return 6;
  if (/^ki/.test(lower) && lower.length > 3) return 7;
  if (/^vi/.test(lower) && lower.length > 3) return 8;
  if (/^u[^aeiou]/.test(lower) && lower.length > 3) return 11;
  if (/^ku/.test(lower) && lower.length > 3) return 15;

  return null;
}

/**
 * Decompose a Swahili verb into its morphological components.
 * Swahili verbs are agglutinative: SUBJECT + TENSE + (OBJECT) + ROOT + SUFFIX
 */
export function decomposeVerb(verb: string): VerbMorphology | null {
  const lower = verb.toLowerCase();

  // Skip very short words
  if (lower.length < 3) return null;

  // Check for negative forms first
  let isNegative = false;
  let remaining = lower;
  let subjectPrefix = "";

  for (const neg of NEGATIVE_PATTERNS) {
    if (remaining.startsWith(neg.prefix)) {
      isNegative = true;
      subjectPrefix = neg.prefix;
      remaining = remaining.slice(neg.prefix.length);
      break;
    }
  }

  // If not negative, extract subject prefix
  if (!isNegative) {
    const prefixes = ["ni", "tu", "wa", "u", "a", "m"];
    for (const p of prefixes) {
      if (remaining.startsWith(p) && remaining.length > p.length + 2) {
        subjectPrefix = p;
        remaining = remaining.slice(p.length);
        break;
      }
    }
  }

  // Extract tense marker
  let tenseMarker = "";
  const tenses = ["ngali", "nge", "me", "na", "li", "ta", "ki", "ka", "hu"];
  for (const t of tenses) {
    if (remaining.startsWith(t) && remaining.length > t.length + 1) {
      tenseMarker = t;
      remaining = remaining.slice(t.length);
      break;
    }
  }

  // If we couldn't find subject or tense, this might not be a conjugated verb
  if (!subjectPrefix && !tenseMarker) return null;

  // Extract object infix (if present)
  let objectInfix: string | null = null;
  const objectPrefixes = [
    "ni",
    "ku",
    "mu",
    "m",
    "tu",
    "wa",
    "ki",
    "vi",
    "li",
    "ya",
    "zi",
  ];
  for (const obj of objectPrefixes) {
    if (remaining.startsWith(obj) && remaining.length > obj.length + 2) {
      // Check if what follows is a known verb root
      const afterObj = remaining.slice(obj.length);
      const matchesRoot = Object.keys(VERB_ROOTS).some((root) =>
        afterObj.startsWith(root),
      );
      if (matchesRoot) {
        objectInfix = obj;
        remaining = afterObj;
        break;
      }
    }
  }

  // The rest is root + suffix
  const root = remaining;
  let derivationalSuffix: string | null = null;

  // Check for derivational suffixes
  for (const [suffix, _] of Object.entries(DERIVATIONAL_SUFFIXES)) {
    if (root.endsWith(suffix) && root.length > suffix.length + 1) {
      derivationalSuffix = suffix;
      break;
    }
  }

  // Final vowel (most verbs end in -a, passive in -wa, etc.)
  const finalVowel = root.slice(-1);

  // Try to find meaning from root
  let meaning = "";
  for (const [verbRoot, verbMeaning] of Object.entries(VERB_ROOTS)) {
    if (root.startsWith(verbRoot) || root === verbRoot) {
      meaning = verbMeaning;
      break;
    }
  }

  const subjectLabel = SUBJECT_PREFIXES[subjectPrefix] || subjectPrefix;
  const tenseLabel = TENSE_MARKERS[tenseMarker]?.label || tenseMarker;

  return {
    subjectPrefix,
    tenseMarker,
    objectInfix,
    root,
    derivationalSuffix,
    finalVowel,
    isNegative,
    isRelative: false,
    meaning:
      meaning ||
      `${subjectLabel} ${isNegative ? "not " : ""}${tenseLabel} ${root}`,
  };
}

// ============================================================================
// Common Grammar Error Patterns
// ============================================================================

/**
 * Common grammar errors in Tanzanian digital Swahili.
 * These patterns catch the most frequent mistakes made by
 * Swahili speakers typing on phones/computers.
 */
const GRAMMAR_ERROR_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  correction: (match: RegExpMatchArray) => string;
  type: GrammarIssue["type"];
  severity: GrammarIssue["severity"];
  explanation: string;
}> = [
  // Wrong possessive agreement: "mkopo yangu" → "mkopo wangu" (class 3)
  {
    pattern:
      /\b(mkopo|mkataba|mfuko|mpango|mwezi)\s+(yangu|yako|yake|yetu|yenu|yao)\b/gi,
    correction: (m) => {
      const possMap: Record<string, string> = {
        yangu: "wangu",
        yako: "wako",
        yake: "wake",
        yetu: "wetu",
        yenu: "wenu",
        yao: "wao",
      };
      return `${m[1]} ${possMap[m[2].toLowerCase()] || m[2]}`;
    },
    type: "agreement",
    severity: "error",
    explanation: "Class 3 nouns (m-/mi-) use w- possessives: wangu, wako, wake",
  },
  // Wrong possessive for class 9: "benki wangu" → "benki yangu"
  {
    pattern:
      /\b(benki|fedha|riba|dhamana|bima|hisa|kodi|biashara|akaunti|habari|taarifa)\s+(wangu|wako|wake|wetu|wenu|wao)\b/gi,
    correction: (m) => {
      const possMap: Record<string, string> = {
        wangu: "yangu",
        wako: "yako",
        wake: "yake",
        wetu: "yetu",
        wenu: "yenu",
        wao: "yao",
      };
      return `${m[1]} ${possMap[m[2].toLowerCase()] || m[2]}`;
    },
    type: "agreement",
    severity: "error",
    explanation: "Class 9 nouns (n-/n-) use y- possessives: yangu, yako, yake",
  },
  // Wrong subject concord: "mkopo inakuja" → "mkopo unakuja" (class 3 uses u-)
  {
    pattern: /\b(mkopo|mkataba|mpango|mwezi|muda)\s+(ina|zina|lina|yana)/gi,
    correction: (m) => `${m[1]} una${m[2].slice(m[2].indexOf("na"))}`,
    type: "agreement",
    severity: "error",
    explanation:
      "Class 3 nouns use u- subject concord: mkopo unakuja (not inakuja)",
  },
  // Wrong subject concord: "fedha inakuja" should stay (class 9 uses i-)
  // This is actually correct, so we skip it.

  // Wrong plural form: "mkopo nyingi" → "mikopo mingi"
  {
    pattern: /\b(mkopo|mkataba|mpango)\s+(nyingi|kubwa|ndogo|nzuri|mbaya)\b/gi,
    correction: (m) => {
      // If using singular noun with N-class adjective, suggest plural or class 3 adj
      const adjMap: Record<string, string> = {
        nyingi: "mwingi",
        kubwa: "mkubwa",
        ndogo: "mdogo",
        nzuri: "mzuri",
        mbaya: "mbaya",
      };
      return `${m[1]} ${adjMap[m[2].toLowerCase()] || m[2]}`;
    },
    type: "agreement",
    severity: "warning",
    explanation:
      "Class 3 singular nouns take m- adjective concord: mkopo mzuri (not nzuri)",
  },
  // Missing -a connector: "benki Tanzania" → "benki ya Tanzania"
  {
    pattern: /\b(benki|kampuni|shirika|ofisi|tawi)\s+([A-Z][a-z]+)\b/g,
    correction: (m) => `${m[1]} ya ${m[2]}`,
    type: "structure",
    severity: "suggestion",
    explanation: 'Use "ya" connector for class 9 nouns: benki ya Tanzania',
  },
  // Double negative (common in informal): "sina si-jui" → "sijui"
  {
    pattern: /\bsina\s+(si[a-z]+)\b/gi,
    correction: (m) => m[1],
    type: "structure",
    severity: "warning",
    explanation:
      "Avoid double negatives in formal Swahili. Use single negative form.",
  },
  // English loan word without Swahili adaptation: "application form" → "fomu ya maombi"
  {
    pattern: /\bapplication\s+form\b/gi,
    correction: () => "fomu ya maombi",
    type: "loan_word",
    severity: "suggestion",
    explanation: "Use Swahili equivalent: fomu ya maombi (application form)",
  },
  {
    pattern: /\bbank\s+account\b/gi,
    correction: () => "akaunti ya benki",
    type: "loan_word",
    severity: "suggestion",
    explanation: "Use Swahili equivalent: akaunti ya benki (bank account)",
  },
  {
    pattern: /\binterest\s+rate\b/gi,
    correction: () => "kiwango cha riba",
    type: "loan_word",
    severity: "suggestion",
    explanation: "Use Swahili equivalent: kiwango cha riba (interest rate)",
  },
  {
    pattern: /\bcollateral\b/gi,
    correction: () => "dhamana",
    type: "loan_word",
    severity: "suggestion",
    explanation: "Use Swahili: dhamana (collateral)",
  },
  // Informal contractions in formal context: "nimshapata" → "nimeshapata"
  {
    pattern: /\b(ni|u|a|tu|wa)(msha|lsha)/gi,
    correction: (m) => `${m[1]}mesha`,
    type: "formality",
    severity: "suggestion",
    explanation:
      'Use full form "mesha" instead of contracted "msha" in formal writing',
  },
  // Wrong tense in question: "unahitaji nini?" is correct, but "unataka nini lipa?" is not
  {
    pattern: /\b(unataka|unahitaji)\s+nini\s+(lipa|soma|fanya)\b/gi,
    correction: (m) => `${m[1]} ku${m[2]} nini`,
    type: "structure",
    severity: "error",
    explanation:
      "Questions with verbs need infinitive: unataka kulipa nini? (not nini lipa)",
  },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Check Swahili grammar in a text.
 * Returns issues found and suggested corrections.
 */
export function checkGrammar(text: string): GrammarCheckResult {
  const issues: GrammarIssue[] = [];
  let correctedText = text;

  for (const rule of GRAMMAR_ERROR_PATTERNS) {
    const matches = [
      ...text.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags)),
    ];

    for (const match of matches) {
      if (match.index === undefined) continue;

      const original = match[0];
      const corrected = rule.correction(match);

      if (original.toLowerCase() !== corrected.toLowerCase()) {
        issues.push({
          type: rule.type,
          severity: rule.severity,
          original,
          corrected,
          explanation: rule.explanation,
          position: match.index,
        });

        // Apply correction
        correctedText = correctedText.replace(original, corrected);
      }
    }
  }

  // Calculate quality score
  const words = text.split(/\s+/).filter((w) => w.length > 1);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;

  const score =
    words.length > 0
      ? Math.max(
          0,
          1 -
            (errorCount * 0.15 + warningCount * 0.05) /
              Math.max(1, words.length / 5),
        )
      : 1;

  return {
    text,
    correctedText,
    issues,
    score: Math.round(score * 100) / 100,
    hasIssues: issues.length > 0,
  };
}

/**
 * Analyze the grammatical structure of a Swahili sentence.
 */
export function analyzeSentence(text: string): SentenceAnalysis {
  const words = text.split(/\s+/).filter((w) => w.length > 1);
  const lower = text.toLowerCase();

  // Detect sentence type
  const isQuestion =
    /\?$/.test(text.trim()) ||
    /^(je|nani|nini|wapi|lini|vipi|kwa nini|gani)\b/i.test(lower);
  const isImperative =
    /^(tafadhali|naomba|fanya|lipa|soma|andika|peleka|leta)\b/i.test(lower);

  // Find noun classes
  const nounClasses: { word: string; classNumber: number }[] = [];
  for (const word of words) {
    const nc = detectNounClass(word);
    if (nc !== null) {
      nounClasses.push({ word: word.toLowerCase(), classNumber: nc });
    }
  }

  // Find verb forms
  const verbForms: VerbMorphology[] = [];
  for (const word of words) {
    const vf = decomposeVerb(word);
    if (vf !== null) {
      verbForms.push(vf);
    }
  }

  // Detect formality
  const formalIndicators = ["tafadhali", "naomba", "shikamoo", "asante sana"];
  const informalIndicators = ["mambo", "poa", "safi", "vipi", "bro", "boss"];

  let formalCount = 0;
  let informalCount = 0;
  for (const ind of formalIndicators) {
    if (lower.includes(ind)) formalCount++;
  }
  for (const ind of informalIndicators) {
    if (lower.includes(ind)) informalCount++;
  }

  const formalityLevel =
    formalCount > informalCount
      ? "formal"
      : informalCount > formalCount
        ? "informal"
        : "neutral";

  return {
    structure: isQuestion
      ? "question"
      : isImperative
        ? "imperative"
        : verbForms.length > 0
          ? "SVO"
          : "fragment",
    hasSubject:
      nounClasses.length > 0 ||
      verbForms.some((v) => v.subjectPrefix.length > 0),
    hasVerb: verbForms.length > 0,
    hasObject: nounClasses.length > 1,
    nounClasses,
    verbForms,
    formalityLevel,
  };
}

/**
 * Get grammar rules summary for LLM prompt injection.
 * Returns a compact set of Swahili grammar rules that AI can use
 * to generate grammatically correct Swahili.
 */
export function getGrammarRulesForPrompt(): string {
  return `## Swahili Grammar Rules (MUST Follow)

### Noun Class Agreement (Critical)
Swahili has noun classes. Each class requires specific possessive, adjective, and verb agreement:

| Noun | Class | Possessive | Subject | Example |
|------|-------|------------|---------|---------|
| mkopo (loan) | 3 | wangu/wako | u- | mkopo wangu unakuja |
| mikopo (loans) | 4 | yangu/yako | i- | mikopo yangu inakuja |
| fedha (money) | 9 | yangu/yako | i- | fedha yangu inafika |
| benki (bank) | 9 | yangu/yako | i- | benki yangu iko |
| kiasi (amount) | 7 | changu/chako | ki- | kiasi changu ni kikubwa |
| malipo (payments) | 6 | yangu/yako | ya- | malipo yangu yamekuja |
| dhamana (collateral) | 9 | yangu/yako | i- | dhamana yangu iko |
| mkataba (contract) | 3 | wangu/wako | u- | mkataba wangu uko |

### Verb Conjugation
Structure: SUBJECT_PREFIX + TENSE + (OBJECT) + ROOT + ENDING
- Present: ni-na-lipa (I am paying)
- Past: ni-li-lipa (I paid)
- Future: ni-ta-lipa (I will pay)
- Perfect: ni-me-lipa (I have paid)
- Negative: si-ja-lipa (I haven't paid)

### Common Banking Verbs
kulipa (pay), kukopa (borrow), kuomba (apply), kuweka (deposit), kutoa (withdraw),
kusajili (register), kuthibitisha (verify), kukubali (approve), kuhamisha (transfer)

### Word Order
Swahili is SVO (Subject-Verb-Object): Mteja analipa mkopo (The customer pays the loan)

### Connector "ya/wa/cha/za"
Use the correct connector based on noun class:
- Class 9: benki ya Tanzania (bank of Tanzania)
- Class 3: mkopo wa benki (loan of the bank)
- Class 7: kiasi cha mkopo (amount of loan)
- Class 10: fedha za mkopo (funds of the loan)

### Code-Switching Rules
When mixing Swahili and English (common in Tanzanian banking):
- Use Swahili sentence structure as frame
- Insert English technical terms naturally
- Keep Swahili grammar agreement even with English nouns
- Example: "Mkopo wako wa SME unahitaji collateral ya kutosha"

### Formality
For banking context, use formal/neutral register:
- Use "tafadhali" (please) and "asante" (thank you)
- Use "shikamoo" for elder respect
- Avoid slang: use "fedha" not "doh", use "hapana" not "ah-ah"
- Use "Je" prefix for polite questions: "Je, unahitaji msaada?"`;
}

/**
 * Validate that a Swahili sentence is well-formed for banking context.
 * Returns a score and specific issues.
 */
export function validateBankingSwahili(text: string): {
  isValid: boolean;
  score: number;
  issues: string[];
  suggestions: string[];
} {
  const grammarResult = checkGrammar(text);
  const analysis = analyzeSentence(text);
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Check for grammar errors
  for (const issue of grammarResult.issues) {
    if (issue.severity === "error") {
      issues.push(
        `${issue.explanation}: "${issue.original}" → "${issue.corrected}"`,
      );
    } else {
      suggestions.push(
        `${issue.explanation}: "${issue.original}" → "${issue.corrected}"`,
      );
    }
  }

  // Check sentence completeness
  if (!analysis.hasVerb && analysis.structure !== "fragment") {
    issues.push("Sentence appears to be missing a verb");
  }

  // Check formality for banking
  if (analysis.formalityLevel === "informal") {
    suggestions.push(
      "Consider using more formal language for banking communication",
    );
  }

  const score =
    grammarResult.score *
    (analysis.hasVerb || analysis.structure === "fragment" ? 1 : 0.7);

  return {
    isValid: issues.length === 0,
    score: Math.round(score * 100) / 100,
    issues,
    suggestions,
  };
}

/**
 * Get the correct possessive form for a noun.
 * Essential for generating grammatically correct Swahili.
 */
export function getCorrectPossessive(
  noun: string,
  person: "my" | "your" | "his" | "our" | "their",
): string {
  const nounClass = detectNounClass(noun);

  const possessives: Record<number, Record<string, string>> = {
    1: { my: "wangu", your: "wako", his: "wake", our: "wetu", their: "wao" },
    2: { my: "wangu", your: "wako", his: "wake", our: "wetu", their: "wao" },
    3: { my: "wangu", your: "wako", his: "wake", our: "wetu", their: "wao" },
    4: { my: "yangu", your: "yako", his: "yake", our: "yetu", their: "yao" },
    5: { my: "langu", your: "lako", his: "lake", our: "letu", their: "lao" },
    6: { my: "yangu", your: "yako", his: "yake", our: "yetu", their: "yao" },
    7: {
      my: "changu",
      your: "chako",
      his: "chake",
      our: "chetu",
      their: "chao",
    },
    8: {
      my: "vyangu",
      your: "vyako",
      his: "vyake",
      our: "vyetu",
      their: "vyao",
    },
    9: { my: "yangu", your: "yako", his: "yake", our: "yetu", their: "yao" },
    10: { my: "zangu", your: "zako", his: "zake", our: "zetu", their: "zao" },
    11: { my: "wangu", your: "wako", his: "wake", our: "wetu", their: "wao" },
    15: {
      my: "kwangu",
      your: "kwako",
      his: "kwake",
      our: "kwetu",
      their: "kwao",
    },
  };

  const classNum = nounClass || 9; // Default to class 9 for unknown nouns
  const poss = possessives[classNum]?.[person] || "yangu";

  return `${noun} ${poss}`;
}
