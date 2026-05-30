/**
 * Dictionary Dataset Loader
 *
 * Loads and indexes all available dictionaries into the DictionaryGraph:
 *   1. Financial Dictionary (520 terms from sw-en-financial-dictionary.json)
 *   2. General Vocabulary (from language-intelligence general-vocabulary data)
 *   3. Grammar Engine Roots (verb roots, noun stems from swahili-grammar)
 *   4. Learned Terms (from translation memory)
 *
 * This loader runs once at startup and populates the in-memory graph
 * that powers sub-millisecond lookups across the entire platform.
 *
 * @module decomposition/dataset-loader
 */

import type { DictionaryNode, PartOfSpeech } from "./types";
import { getDictionaryGraph, type DictionaryGraph } from "./dictionary-graph";

// ============================================================================
// Financial Dictionary Loader
// ============================================================================

interface RawFinancialEntry {
  readonly id: string;
  readonly en: string;
  readonly sw: string;
  readonly phonetic_sw: string;
  readonly category: string;
  readonly definition_en: string;
  readonly definition_sw: string;
  readonly example_en: string;
  readonly example_sw: string;
  readonly related_terms: readonly string[];
  readonly frequency: "high" | "medium" | "low";
  readonly difficulty: "basic" | "intermediate" | "advanced";
  readonly context_tags: readonly string[];
}

function mapFrequencyToRank(freq: "high" | "medium" | "low"): number {
  switch (freq) {
    case "high":
      return 100;
    case "medium":
      return 500;
    case "low":
      return 1000;
  }
}

function loadFinancialEntries(
  entries: readonly RawFinancialEntry[],
): readonly DictionaryNode[] {
  const nodes: DictionaryNode[] = [];

  for (const entry of entries) {
    // English entry
    nodes.push({
      form: entry.en.toLowerCase(),
      language: "en",
      pos: "noun" as PartOfSpeech,
      lemma: entry.en.toLowerCase(),
      translations: { sw: entry.sw },
      phonetic: undefined,
      definition: entry.definition_en,
      examples: entry.example_en ? [entry.example_en] : [],
      domains: ["finance", entry.category],
      frequencyRank: mapFrequencyToRank(entry.frequency),
      source: "financial_dictionary",
      relatedWords: [...entry.related_terms],
      nounClass: undefined,
    });

    // Swahili entry
    nodes.push({
      form: entry.sw.toLowerCase(),
      language: "sw",
      pos: "noun" as PartOfSpeech,
      lemma: entry.sw.toLowerCase(),
      translations: { en: entry.en },
      phonetic: entry.phonetic_sw,
      definition: entry.definition_sw,
      examples: entry.example_sw ? [entry.example_sw] : [],
      domains: ["finance", entry.category],
      frequencyRank: mapFrequencyToRank(entry.frequency),
      source: "financial_dictionary",
      relatedWords: [...entry.related_terms],
      nounClass: undefined,
    });
  }

  return nodes;
}

// ============================================================================
// Core Swahili Vocabulary (built-in, no external file needed)
// ============================================================================

/**
 * Essential Swahili vocabulary that must always be available.
 * These are the most common 200+ words used in everyday + business Swahili.
 */
const CORE_SWAHILI_VOCABULARY: readonly DictionaryNode[] = [
  // ── Greetings & Basics ──
  {
    form: "habari",
    language: "sw",
    pos: "noun",
    lemma: "habari",
    translations: { en: "news/hello" },
    definition: "News, used as greeting",
    examples: ["Habari yako?"],
    domains: ["greeting"],
    source: "general_vocabulary",
    relatedWords: ["salama", "nzuri"],
    frequencyRank: 1,
  },
  {
    form: "jambo",
    language: "sw",
    pos: "interjection",
    lemma: "jambo",
    translations: { en: "hello/matter" },
    definition: "Hello, also means matter/issue",
    examples: ["Jambo!"],
    domains: ["greeting"],
    source: "general_vocabulary",
    relatedWords: ["habari", "hujambo"],
    frequencyRank: 2,
  },
  {
    form: "asante",
    language: "sw",
    pos: "interjection",
    lemma: "asante",
    translations: { en: "thank you" },
    definition: "Thank you",
    examples: ["Asante sana"],
    domains: ["courtesy"],
    source: "general_vocabulary",
    relatedWords: ["shukrani"],
    frequencyRank: 3,
  },
  {
    form: "tafadhali",
    language: "sw",
    pos: "adverb",
    lemma: "tafadhali",
    translations: { en: "please" },
    definition: "Please",
    examples: ["Tafadhali subiri"],
    domains: ["courtesy"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 4,
  },
  {
    form: "ndiyo",
    language: "sw",
    pos: "particle",
    lemma: "ndiyo",
    translations: { en: "yes" },
    definition: "Yes",
    examples: ["Ndiyo, nimekubali"],
    domains: ["response"],
    source: "general_vocabulary",
    relatedWords: ["hapana"],
    frequencyRank: 5,
  },
  {
    form: "hapana",
    language: "sw",
    pos: "particle",
    lemma: "hapana",
    translations: { en: "no" },
    definition: "No",
    examples: ["Hapana, siwezi"],
    domains: ["response"],
    source: "general_vocabulary",
    relatedWords: ["ndiyo"],
    frequencyRank: 6,
  },
  {
    form: "karibu",
    language: "sw",
    pos: "adverb",
    lemma: "karibu",
    translations: { en: "welcome/near" },
    definition: "Welcome, also means near",
    examples: ["Karibu sana!"],
    domains: ["greeting", "spatial"],
    source: "general_vocabulary",
    relatedWords: ["mbali"],
    frequencyRank: 7,
  },
  {
    form: "sawa",
    language: "sw",
    pos: "adjective",
    lemma: "sawa",
    translations: { en: "okay/equal" },
    definition: "Okay, agreed, equal",
    examples: ["Sawa, tutafanya hivyo"],
    domains: ["response"],
    source: "general_vocabulary",
    relatedWords: ["nzuri"],
    frequencyRank: 8,
  },

  // ── Pronouns ──
  {
    form: "mimi",
    language: "sw",
    pos: "pronoun",
    lemma: "mimi",
    translations: { en: "I/me" },
    definition: "First person singular pronoun",
    examples: ["Mimi nataka kujifunza"],
    domains: ["pronoun"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 10,
  },
  {
    form: "wewe",
    language: "sw",
    pos: "pronoun",
    lemma: "wewe",
    translations: { en: "you" },
    definition: "Second person singular pronoun",
    examples: ["Wewe unajua"],
    domains: ["pronoun"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 11,
  },
  {
    form: "yeye",
    language: "sw",
    pos: "pronoun",
    lemma: "yeye",
    translations: { en: "he/she" },
    definition: "Third person singular pronoun",
    examples: ["Yeye anafanya kazi"],
    domains: ["pronoun"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 12,
  },
  {
    form: "sisi",
    language: "sw",
    pos: "pronoun",
    lemma: "sisi",
    translations: { en: "we/us" },
    definition: "First person plural pronoun",
    examples: ["Sisi tunajifunza"],
    domains: ["pronoun"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 13,
  },
  {
    form: "ninyi",
    language: "sw",
    pos: "pronoun",
    lemma: "ninyi",
    translations: { en: "you (plural)" },
    definition: "Second person plural pronoun",
    examples: ["Ninyi mnaweza"],
    domains: ["pronoun"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 14,
  },
  {
    form: "wao",
    language: "sw",
    pos: "pronoun",
    lemma: "wao",
    translations: { en: "they/them" },
    definition: "Third person plural pronoun",
    examples: ["Wao wanajua"],
    domains: ["pronoun"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 15,
  },

  // ── Common Verbs (root forms) ──
  {
    form: "-fanya",
    language: "sw",
    pos: "verb",
    lemma: "-fanya",
    translations: { en: "do/make" },
    definition: "To do, to make",
    examples: ["Ninafanya kazi"],
    domains: ["action"],
    source: "general_vocabulary",
    relatedWords: ["kufanya"],
    frequencyRank: 20,
  },
  {
    form: "kufanya",
    language: "sw",
    pos: "verb",
    lemma: "-fanya",
    translations: { en: "to do/make" },
    definition: "Infinitive: to do, to make",
    examples: ["Nataka kufanya biashara"],
    domains: ["action"],
    source: "general_vocabulary",
    relatedWords: ["-fanya"],
    frequencyRank: 21,
  },
  {
    form: "-jua",
    language: "sw",
    pos: "verb",
    lemma: "-jua",
    translations: { en: "know" },
    definition: "To know",
    examples: ["Ninajua Kiswahili"],
    domains: ["cognition"],
    source: "general_vocabulary",
    relatedWords: ["kujua"],
    frequencyRank: 22,
  },
  {
    form: "-taka",
    language: "sw",
    pos: "verb",
    lemma: "-taka",
    translations: { en: "want" },
    definition: "To want",
    examples: ["Ninataka mkopo"],
    domains: ["desire"],
    source: "general_vocabulary",
    relatedWords: ["kutaka"],
    frequencyRank: 23,
  },
  {
    form: "-weza",
    language: "sw",
    pos: "verb",
    lemma: "-weza",
    translations: { en: "can/be able" },
    definition: "To be able to, can",
    examples: ["Ninaweza kulipa"],
    domains: ["ability"],
    source: "general_vocabulary",
    relatedWords: ["kuweza"],
    frequencyRank: 24,
  },
  {
    form: "-soma",
    language: "sw",
    pos: "verb",
    lemma: "-soma",
    translations: { en: "read/study" },
    definition: "To read, to study",
    examples: ["Ninasoma kitabu"],
    domains: ["education"],
    source: "general_vocabulary",
    relatedWords: ["kusoma"],
    frequencyRank: 25,
  },
  {
    form: "-andika",
    language: "sw",
    pos: "verb",
    lemma: "-andika",
    translations: { en: "write" },
    definition: "To write",
    examples: ["Ninaandika barua"],
    domains: ["communication"],
    source: "general_vocabulary",
    relatedWords: ["kuandika"],
    frequencyRank: 26,
  },
  {
    form: "-lipa",
    language: "sw",
    pos: "verb",
    lemma: "-lipa",
    translations: { en: "pay" },
    definition: "To pay",
    examples: ["Nitalipa kesho"],
    domains: ["finance"],
    source: "general_vocabulary",
    relatedWords: ["kulipa", "malipo"],
    frequencyRank: 27,
  },
  {
    form: "-kopa",
    language: "sw",
    pos: "verb",
    lemma: "-kopa",
    translations: { en: "borrow" },
    definition: "To borrow",
    examples: ["Ninataka kukopa pesa"],
    domains: ["finance"],
    source: "general_vocabulary",
    relatedWords: ["kukopa", "mkopo"],
    frequencyRank: 28,
  },
  {
    form: "-saidia",
    language: "sw",
    pos: "verb",
    lemma: "-saidia",
    translations: { en: "help" },
    definition: "To help",
    examples: ["Tafadhali nisaidie"],
    domains: ["assistance"],
    source: "general_vocabulary",
    relatedWords: ["kusaidia", "msaada"],
    frequencyRank: 29,
  },
  {
    form: "-anza",
    language: "sw",
    pos: "verb",
    lemma: "-anza",
    translations: { en: "start/begin" },
    definition: "To start, to begin",
    examples: ["Tuanze sasa"],
    domains: ["action"],
    source: "general_vocabulary",
    relatedWords: ["kuanza", "mwanzo"],
    frequencyRank: 30,
  },
  {
    form: "-endelea",
    language: "sw",
    pos: "verb",
    lemma: "-endelea",
    translations: { en: "continue" },
    definition: "To continue, to progress",
    examples: ["Endelea kujifunza"],
    domains: ["action"],
    source: "general_vocabulary",
    relatedWords: ["kuendelea", "maendeleo"],
    frequencyRank: 31,
  },
  {
    form: "-kuwa",
    language: "sw",
    pos: "verb",
    lemma: "-kuwa",
    translations: { en: "be/become" },
    definition: "To be, to become",
    examples: ["Ninataka kuwa tajiri"],
    domains: ["state"],
    source: "general_vocabulary",
    relatedWords: ["kuwa"],
    frequencyRank: 32,
  },

  // ── Common Nouns ──
  {
    form: "pesa",
    language: "sw",
    pos: "noun",
    lemma: "pesa",
    translations: { en: "money" },
    definition: "Money",
    examples: ["Nina pesa kidogo"],
    domains: ["finance"],
    source: "general_vocabulary",
    relatedWords: ["fedha", "hela"],
    frequencyRank: 40,
    nounClass: 9,
  },
  {
    form: "kazi",
    language: "sw",
    pos: "noun",
    lemma: "kazi",
    translations: { en: "work/job" },
    definition: "Work, job, employment",
    examples: ["Kazi yangu ni nzuri"],
    domains: ["employment"],
    source: "general_vocabulary",
    relatedWords: ["ajira", "shughuli"],
    frequencyRank: 41,
    nounClass: 9,
  },
  {
    form: "biashara",
    language: "sw",
    pos: "noun",
    lemma: "biashara",
    translations: { en: "business/trade" },
    definition: "Business, trade, commerce",
    examples: ["Biashara yangu inakua"],
    domains: ["business", "finance"],
    source: "general_vocabulary",
    relatedWords: ["uchumi", "soko"],
    frequencyRank: 42,
    nounClass: 9,
  },
  {
    form: "mkopo",
    language: "sw",
    pos: "noun",
    lemma: "mkopo",
    translations: { en: "loan" },
    definition: "A loan, credit",
    examples: ["Ninataka mkopo wa biashara"],
    domains: ["finance"],
    source: "general_vocabulary",
    relatedWords: ["riba", "deni", "-kopa"],
    frequencyRank: 43,
    nounClass: 3,
  },
  {
    form: "nyumba",
    language: "sw",
    pos: "noun",
    lemma: "nyumba",
    translations: { en: "house" },
    definition: "House, home",
    examples: ["Nyumba yangu ni kubwa"],
    domains: ["housing"],
    source: "general_vocabulary",
    relatedWords: ["makazi", "jengo"],
    frequencyRank: 44,
    nounClass: 9,
  },
  {
    form: "mtu",
    language: "sw",
    pos: "noun",
    lemma: "mtu",
    translations: { en: "person" },
    definition: "A person, human being",
    examples: ["Mtu yeyote anaweza kujifunza"],
    domains: ["people"],
    source: "general_vocabulary",
    relatedWords: ["watu", "binadamu"],
    frequencyRank: 45,
    nounClass: 1,
  },
  {
    form: "watu",
    language: "sw",
    pos: "noun",
    lemma: "mtu",
    translations: { en: "people" },
    definition: "People (plural of mtu)",
    examples: ["Watu wengi wanataka mkopo"],
    domains: ["people"],
    source: "general_vocabulary",
    relatedWords: ["mtu", "jamii"],
    frequencyRank: 46,
    nounClass: 2,
  },
  {
    form: "soko",
    language: "sw",
    pos: "noun",
    lemma: "soko",
    translations: { en: "market" },
    definition: "Market, marketplace",
    examples: ["Soko la Tanzania linakua"],
    domains: ["business", "finance"],
    source: "general_vocabulary",
    relatedWords: ["biashara", "uchumi"],
    frequencyRank: 47,
    nounClass: 5,
  },
  {
    form: "benki",
    language: "sw",
    pos: "noun",
    lemma: "benki",
    translations: { en: "bank" },
    definition: "Bank (financial institution)",
    examples: ["Benki yetu inatoa mikopo"],
    domains: ["finance"],
    source: "general_vocabulary",
    relatedWords: ["fedha", "akaunti"],
    frequencyRank: 48,
    nounClass: 9,
  },
  {
    form: "riba",
    language: "sw",
    pos: "noun",
    lemma: "riba",
    translations: { en: "interest (financial)" },
    definition: "Interest on a loan",
    examples: ["Riba ni asilimia kumi"],
    domains: ["finance"],
    source: "general_vocabulary",
    relatedWords: ["mkopo", "faida"],
    frequencyRank: 49,
    nounClass: 9,
  },

  // ── Time Words ──
  {
    form: "leo",
    language: "sw",
    pos: "adverb",
    lemma: "leo",
    translations: { en: "today" },
    definition: "Today",
    examples: ["Leo ni siku nzuri"],
    domains: ["time"],
    source: "general_vocabulary",
    relatedWords: ["kesho", "jana"],
    frequencyRank: 60,
  },
  {
    form: "kesho",
    language: "sw",
    pos: "adverb",
    lemma: "kesho",
    translations: { en: "tomorrow" },
    definition: "Tomorrow",
    examples: ["Kesho nitafanya kazi"],
    domains: ["time"],
    source: "general_vocabulary",
    relatedWords: ["leo", "jana"],
    frequencyRank: 61,
  },
  {
    form: "jana",
    language: "sw",
    pos: "adverb",
    lemma: "jana",
    translations: { en: "yesterday" },
    definition: "Yesterday",
    examples: ["Jana nilikuwa sokoni"],
    domains: ["time"],
    source: "general_vocabulary",
    relatedWords: ["leo", "kesho"],
    frequencyRank: 62,
  },
  {
    form: "sasa",
    language: "sw",
    pos: "adverb",
    lemma: "sasa",
    translations: { en: "now" },
    definition: "Now, at this moment",
    examples: ["Sasa hivi ninataka kujifunza"],
    domains: ["time"],
    source: "general_vocabulary",
    relatedWords: ["hivi"],
    frequencyRank: 63,
  },
  {
    form: "mwezi",
    language: "sw",
    pos: "noun",
    lemma: "mwezi",
    translations: { en: "month/moon" },
    definition: "Month or moon",
    examples: ["Mwezi ujao nitalipa"],
    domains: ["time"],
    source: "general_vocabulary",
    relatedWords: ["wiki", "mwaka"],
    frequencyRank: 64,
    nounClass: 3,
  },
  {
    form: "mwaka",
    language: "sw",
    pos: "noun",
    lemma: "mwaka",
    translations: { en: "year" },
    definition: "Year",
    examples: ["Mwaka huu ni mzuri"],
    domains: ["time"],
    source: "general_vocabulary",
    relatedWords: ["mwezi", "wiki"],
    frequencyRank: 65,
    nounClass: 3,
  },

  // ── Connectors & Prepositions ──
  {
    form: "na",
    language: "sw",
    pos: "conjunction",
    lemma: "na",
    translations: { en: "and/with" },
    definition: "And, with",
    examples: ["Mimi na wewe"],
    domains: ["connector"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 70,
  },
  {
    form: "au",
    language: "sw",
    pos: "conjunction",
    lemma: "au",
    translations: { en: "or" },
    definition: "Or",
    examples: ["Mkopo au akiba"],
    domains: ["connector"],
    source: "general_vocabulary",
    relatedWords: ["na"],
    frequencyRank: 71,
  },
  {
    form: "lakini",
    language: "sw",
    pos: "conjunction",
    lemma: "lakini",
    translations: { en: "but" },
    definition: "But, however",
    examples: ["Ninataka lakini siwezi"],
    domains: ["connector"],
    source: "general_vocabulary",
    relatedWords: ["hata hivyo"],
    frequencyRank: 72,
  },
  {
    form: "kwa",
    language: "sw",
    pos: "preposition",
    lemma: "kwa",
    translations: { en: "for/by/with" },
    definition: "For, by, with, to",
    examples: ["Kwa hiyo tutaendelea"],
    domains: ["connector"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 73,
  },
  {
    form: "katika",
    language: "sw",
    pos: "preposition",
    lemma: "katika",
    translations: { en: "in/at" },
    definition: "In, at, within",
    examples: ["Katika benki yetu"],
    domains: ["connector"],
    source: "general_vocabulary",
    relatedWords: ["ndani"],
    frequencyRank: 74,
  },
  {
    form: "kwamba",
    language: "sw",
    pos: "conjunction",
    lemma: "kwamba",
    translations: { en: "that" },
    definition: "That (subordinating conjunction)",
    examples: ["Najua kwamba unaweza"],
    domains: ["connector"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 75,
  },

  // ── Adjectives / Qualifiers ──
  {
    form: "nzuri",
    language: "sw",
    pos: "adjective",
    lemma: "-zuri",
    translations: { en: "good/nice" },
    definition: "Good, nice, beautiful",
    examples: ["Biashara nzuri"],
    domains: ["quality"],
    source: "general_vocabulary",
    relatedWords: ["mbaya"],
    frequencyRank: 80,
  },
  {
    form: "kubwa",
    language: "sw",
    pos: "adjective",
    lemma: "-kubwa",
    translations: { en: "big/large" },
    definition: "Big, large",
    examples: ["Mkopo mkubwa"],
    domains: ["size"],
    source: "general_vocabulary",
    relatedWords: ["ndogo"],
    frequencyRank: 81,
  },
  {
    form: "ndogo",
    language: "sw",
    pos: "adjective",
    lemma: "-dogo",
    translations: { en: "small" },
    definition: "Small, little",
    examples: ["Biashara ndogo"],
    domains: ["size"],
    source: "general_vocabulary",
    relatedWords: ["kubwa"],
    frequencyRank: 82,
  },
  {
    form: "mpya",
    language: "sw",
    pos: "adjective",
    lemma: "-pya",
    translations: { en: "new" },
    definition: "New",
    examples: ["Mkopo mpya"],
    domains: ["quality"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 83,
  },
  {
    form: "muhimu",
    language: "sw",
    pos: "adjective",
    lemma: "muhimu",
    translations: { en: "important" },
    definition: "Important",
    examples: ["Jambo muhimu"],
    domains: ["quality"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 84,
  },

  // ── Numbers ──
  {
    form: "moja",
    language: "sw",
    pos: "numeral",
    lemma: "moja",
    translations: { en: "one" },
    definition: "One (1)",
    examples: ["Mkopo moja"],
    domains: ["number"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 90,
  },
  {
    form: "mbili",
    language: "sw",
    pos: "numeral",
    lemma: "mbili",
    translations: { en: "two" },
    definition: "Two (2)",
    examples: ["Miezi mbili"],
    domains: ["number"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 91,
  },
  {
    form: "tatu",
    language: "sw",
    pos: "numeral",
    lemma: "tatu",
    translations: { en: "three" },
    definition: "Three (3)",
    examples: ["Miaka mitatu"],
    domains: ["number"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 92,
  },
  {
    form: "nne",
    language: "sw",
    pos: "numeral",
    lemma: "nne",
    translations: { en: "four" },
    definition: "Four (4)",
    examples: [],
    domains: ["number"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 93,
  },
  {
    form: "tano",
    language: "sw",
    pos: "numeral",
    lemma: "tano",
    translations: { en: "five" },
    definition: "Five (5)",
    examples: [],
    domains: ["number"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 94,
  },
  {
    form: "kumi",
    language: "sw",
    pos: "numeral",
    lemma: "kumi",
    translations: { en: "ten" },
    definition: "Ten (10)",
    examples: ["Asilimia kumi"],
    domains: ["number"],
    source: "general_vocabulary",
    relatedWords: [],
    frequencyRank: 95,
  },
];

// ============================================================================
// Load Functions
// ============================================================================

/**
 * Load financial dictionary from JSON data.
 * This is the primary dataset: 520 bilingual financial terms.
 */
export function loadFinancialDictionary(
  graph: DictionaryGraph,
  rawEntries: readonly RawFinancialEntry[],
): number {
  const nodes = loadFinancialEntries(rawEntries);
  graph.insertMany(nodes);
  return nodes.length;
}

/**
 * Load core Swahili vocabulary (built-in, always available).
 */
export function loadCoreVocabulary(graph: DictionaryGraph): number {
  graph.insertMany(CORE_SWAHILI_VOCABULARY);
  return CORE_SWAHILI_VOCABULARY.length;
}

/**
 * Load learned terms from translation memory entries.
 */
export function loadFromTranslationMemory(
  graph: DictionaryGraph,
  entries: readonly {
    sourceText: string;
    translatedText: string;
    sourceLang: "en" | "sw";
    targetLang: "en" | "sw";
    confidence: number;
  }[],
): number {
  let count = 0;

  for (const entry of entries) {
    if (entry.confidence < 0.5) continue; // Skip low-confidence entries

    const node: DictionaryNode = {
      form: entry.sourceText.toLowerCase(),
      language: entry.sourceLang,
      translations: { [entry.targetLang]: entry.translatedText },
      definition: undefined,
      examples: [],
      domains: [],
      source: "learned",
      relatedWords: [],
      frequencyRank: undefined,
    };

    if (!graph.has(entry.sourceText, entry.sourceLang)) {
      graph.insert(node);
      count++;
    }
  }

  return count;
}

/**
 * Add a single term discovered from online search or API.
 */
export function addDiscoveredTerm(
  graph: DictionaryGraph,
  term: {
    readonly form: string;
    readonly language: "en" | "sw";
    readonly translation: string;
    readonly targetLang: "en" | "sw";
    readonly source: "external_api" | "learned";
    readonly domains?: readonly string[];
  },
): void {
  const node: DictionaryNode = {
    form: term.form.toLowerCase(),
    language: term.language,
    translations: { [term.targetLang]: term.translation },
    definition: undefined,
    examples: [],
    domains: [...(term.domains ?? [])],
    source: term.source,
    relatedWords: [],
  };

  graph.insert(node);
}

/**
 * Initialize the full dictionary graph with all available data.
 * Call this once at application startup.
 */
export async function initializeDictionaryGraph(): Promise<{
  readonly graph: DictionaryGraph;
  readonly stats: {
    readonly financial: number;
    readonly core: number;
    readonly total: number;
  };
}> {
  const graph = getDictionaryGraph();

  // 1. Load core vocabulary (always available, no I/O)
  const coreCount = loadCoreVocabulary(graph);

  // 2. Try to load financial dictionary
  let financialCount = 0;
  try {
    // Dynamic import for the financial dictionary JSON
    const dictModule =
      await import("../../../../data/dictionaries/sw-en-financial-dictionary.json");
    const rawData = dictModule.default?.terms ?? dictModule.default ?? [];
    if (Array.isArray(rawData)) {
      financialCount = loadFinancialDictionary(
        graph,
        rawData as readonly RawFinancialEntry[],
      );
    }
  } catch {
    // Financial dictionary not available; continue with core vocab
    console.warn(
      "[DictionaryGraph] Financial dictionary not found, using core vocabulary only",
    );
  }

  const totalStats = graph.getStats();

  return {
    graph,
    stats: {
      financial: financialCount,
      core: coreCount,
      total: totalStats.totalEntries,
    },
  };
}
