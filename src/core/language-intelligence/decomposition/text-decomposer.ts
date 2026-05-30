/**
 * Universal Text Decomposer
 *
 * The core engine that breaks ANY text into its atomic components:
 *   Text -> Paragraphs -> Sentences -> Phrases -> Tokens -> Morphemes
 *
 * This is the universal standard for document decomposition across Borjie.
 * Every piece of text that flows through the platform (chat messages, voice
 * transcripts, uploaded documents, UI text) can be decomposed to this level.
 *
 * For Swahili, this includes full agglutinative morphological analysis.
 * For English, standard tokenization with financial term recognition.
 *
 * The decomposer validates every token against the dictionary graph and
 * flags unresolved tokens for gap-filling via online search or AI.
 *
 * @module decomposition/text-decomposer
 */

import { v4 as uuidv4 } from "uuid";
import type {
  DocumentAtom,
  Paragraph,
  Sentence,
  Phrase,
  Token,
  PhraseType,
  PartOfSpeech,
} from "./types";
import { getDictionaryGraph, type DictionaryGraph } from "./dictionary-graph";

// ============================================================================
// Language Detection (lightweight, no external deps)
// ============================================================================

// Common Swahili function words for quick detection
const SWAHILI_MARKERS = new Set([
  "na",
  "ni",
  "ya",
  "wa",
  "kwa",
  "katika",
  "au",
  "lakini",
  "hii",
  "hiyo",
  "hizo",
  "yake",
  "yangu",
  "yako",
  "wetu",
  "wao",
  "sisi",
  "mimi",
  "wewe",
  "yeye",
  "ninyi",
  "ndio",
  "ndiyo",
  "hapana",
  "sawa",
  "asante",
  "tafadhali",
  "habari",
  "jambo",
  "karibu",
  "kwamba",
  "kama",
  "ili",
  "hata",
  "bado",
  "sana",
  "kidogo",
  "kabisa",
  "tu",
  "pia",
  "halafu",
  "kwanza",
  "baada",
]);

const ENGLISH_MARKERS = new Set([
  "the",
  "is",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "will",
  "would",
  "can",
  "could",
  "should",
  "must",
  "may",
  "might",
  "this",
  "that",
  "these",
  "those",
  "with",
  "from",
  "for",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "your",
  "our",
  "their",
]);

function detectLanguage(text: string): "en" | "sw" | "mixed" {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "en";

  let swCount = 0;
  let enCount = 0;

  for (const w of words) {
    if (SWAHILI_MARKERS.has(w)) swCount++;
    if (ENGLISH_MARKERS.has(w)) enCount++;
  }

  const total = swCount + enCount;
  if (total === 0) return "en"; // Default

  const swRatio = swCount / total;
  if (swRatio > 0.7) return "sw";
  if (swRatio < 0.3) return "en";
  return "mixed";
}

// ============================================================================
// Sentence Splitting
// ============================================================================

function splitSentences(text: string): readonly string[] {
  // Handle common abbreviations that use periods
  const cleaned = text
    .replace(/\b(Mr|Mrs|Dr|Prof|Inc|Ltd|Co|vs|etc|e\.g|i\.e)\./gi, "$1\u200B")
    .replace(/(\d)\./g, "$1\u200B");

  // Split on sentence-ending punctuation
  const parts = cleaned.split(/(?<=[.!?])\s+/);

  return parts
    .map((s) => s.replace(/\u200B/g, ".").trim())
    .filter((s) => s.length > 0);
}

// ============================================================================
// Tokenization
// ============================================================================

function tokenize(text: string): readonly string[] {
  // Split on whitespace and punctuation, keeping punctuation as separate tokens
  return text
    .split(/(\s+|(?<=[.,!?;:()"\[\]{}])|(?=[.,!?;:()"\[\]{}]))/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ============================================================================
// Token Analysis
// ============================================================================

function analyzeToken(
  surface: string,
  position: { start: number; end: number },
  graph: DictionaryGraph,
): Token {
  const normalized = surface.toLowerCase();
  const isPunctuation = /^[.,!?;:()"\[\]{}]+$/.test(surface);

  if (isPunctuation) {
    return {
      surface,
      normalized,
      lemma: surface,
      language: "en",
      pos: "particle" as PartOfSpeech,
      morphemes: [],
      translations: {},
      dictionaryConfidence: 1,
      verified: true,
      verificationSource: "general_dictionary",
      position,
      domains: [],
      isFinancialTerm: false,
    };
  }

  // Check if it's a number
  if (/^\d[\d,.]*$/.test(surface)) {
    return {
      surface,
      normalized,
      lemma: surface,
      language: "en",
      pos: "numeral" as PartOfSpeech,
      morphemes: [],
      translations: {},
      dictionaryConfidence: 1,
      verified: true,
      verificationSource: "general_dictionary",
      position,
      domains: [],
      isFinancialTerm: false,
    };
  }

  // Try Swahili dictionary first
  const swLookup = graph.lookup(normalized, "sw");
  if (swLookup) {
    return {
      surface,
      normalized,
      lemma: swLookup.lemma ?? normalized,
      language: "sw",
      pos: (swLookup.pos ?? "unknown") as PartOfSpeech,
      morphemes: swLookup.morphemes ?? [],
      translations: swLookup.translations,
      dictionaryConfidence: 1.0,
      verified: true,
      verificationSource: mapSource(swLookup.source),
      position,
      domains: [...swLookup.domains],
      isFinancialTerm:
        swLookup.domains.includes("finance") ||
        swLookup.source === "financial_dictionary",
      phonetic: swLookup.phonetic,
    };
  }

  // Try English dictionary
  const enLookup = graph.lookup(normalized, "en");
  if (enLookup) {
    return {
      surface,
      normalized,
      lemma: enLookup.lemma ?? normalized,
      language: "en",
      pos: (enLookup.pos ?? "unknown") as PartOfSpeech,
      morphemes: [],
      translations: enLookup.translations,
      dictionaryConfidence: 1.0,
      verified: true,
      verificationSource: mapSource(enLookup.source),
      position,
      domains: [...enLookup.domains],
      isFinancialTerm:
        enLookup.domains.includes("finance") ||
        enLookup.source === "financial_dictionary",
    };
  }

  // Try Swahili morphological decomposition
  const morphResult = graph.decompose(normalized);
  if (morphResult.found) {
    return {
      surface,
      normalized,
      lemma: morphResult.root,
      language: "sw",
      pos: (morphResult.node?.pos as PartOfSpeech) ?? ("verb" as PartOfSpeech),
      morphemes: [...morphResult.morphemes],
      translations: morphResult.node?.translations ?? {},
      dictionaryConfidence: morphResult.confidence,
      verified: morphResult.confidence > 0.6,
      verificationSource:
        morphResult.confidence > 0.6 ? "grammar_engine" : "unverified",
      position,
      domains: morphResult.node?.domains ? [...morphResult.node.domains] : [],
      isFinancialTerm: false,
    };
  }

  // Unresolved token
  const guessedLang = SWAHILI_MARKERS.has(normalized) ? "sw" : "en";
  return {
    surface,
    normalized,
    lemma: normalized,
    language: guessedLang,
    pos: "unknown" as PartOfSpeech,
    morphemes: [],
    translations: {},
    dictionaryConfidence: 0,
    verified: false,
    verificationSource: "unverified",
    position,
    domains: [],
    isFinancialTerm: false,
  };
}

function mapSource(source: string): Token["verificationSource"] {
  switch (source) {
    case "financial_dictionary":
      return "financial_dictionary";
    case "general_vocabulary":
    case "kamusi":
    case "bakita":
      return "general_dictionary";
    case "learned":
      return "translation_memory";
    case "external_api":
      return "external_api";
    default:
      return "general_dictionary";
  }
}

// ============================================================================
// Phrase Grouping
// ============================================================================

function groupPhrases(tokens: readonly Token[]): readonly Phrase[] {
  // Simple phrase grouping: consecutive tokens of same language form a phrase
  // Financial multi-word terms get special treatment
  const phrases: Phrase[] = [];
  let currentTokens: Token[] = [];
  let currentType: PhraseType = "unknown";

  const flush = () => {
    if (currentTokens.length > 0) {
      const text = currentTokens.map((t) => t.surface).join(" ");
      const hasFinancial = currentTokens.some((t) => t.isFinancialTerm);

      phrases.push({
        text,
        type: hasFinancial ? "financial_term" : currentType,
        tokens: [...currentTokens],
        translations: {},
        isIdiomatic: false,
        confidence:
          currentTokens.reduce((sum, t) => sum + t.dictionaryConfidence, 0) /
          currentTokens.length,
      });
      currentTokens = [];
      currentType = "unknown";
    }
  };

  for (const token of tokens) {
    // Punctuation breaks phrases
    if (/^[.,!?;:()"\[\]{}]+$/.test(token.surface)) {
      flush();
      continue;
    }

    // Detect phrase type from POS
    if (
      token.pos === "noun" ||
      token.pos === "pronoun" ||
      token.pos === "determiner"
    ) {
      if (currentType !== "noun_phrase") {
        flush();
        currentType = "noun_phrase";
      }
    } else if (token.pos === "verb" || token.pos === "auxiliary") {
      if (currentType !== "verb_phrase") {
        flush();
        currentType = "verb_phrase";
      }
    } else if (token.pos === "preposition") {
      flush();
      currentType = "prepositional_phrase";
    }

    currentTokens.push(token);
  }

  flush();
  return phrases;
}

// ============================================================================
// Main Decomposition Function
// ============================================================================

export interface DecompositionOptions {
  /** Source type for metadata */
  readonly sourceType?: DocumentAtom["sourceType"];
  /** Source document ID */
  readonly sourceId?: string;
  /** Skip morphological analysis (faster but less detailed) */
  readonly skipMorphology?: boolean;
  /** Maximum tokens to process (for very large documents) */
  readonly maxTokens?: number;
}

/**
 * Decompose any text into its atomic components.
 * This is the UNIVERSAL entry point for all text decomposition.
 */
export function decomposeText(
  text: string,
  options: DecompositionOptions = {},
): DocumentAtom {
  const startTime = Date.now();
  const graph = getDictionaryGraph();

  const { sourceType = "other", sourceId, maxTokens = 50000 } = options;

  // Split into paragraphs
  const rawParagraphs = text
    .split(/\n\s*\n/)
    .filter((p) => p.trim().length > 0);
  if (rawParagraphs.length === 0 && text.trim().length > 0) {
    rawParagraphs.push(text.trim());
  }

  let totalTokenCount = 0;
  const allUnresolved: DocumentAtom["unresolvedTokens"] = [];

  const paragraphs: Paragraph[] = rawParagraphs.map((paraText, paraIdx) => {
    const sentences: Sentence[] = [];
    const rawSentences = splitSentences(paraText);

    for (let sentIdx = 0; sentIdx < rawSentences.length; sentIdx++) {
      const sentText = rawSentences[sentIdx];
      const sentLang = detectLanguage(sentText);

      // Tokenize
      const rawTokens = tokenize(sentText);
      const tokens: Token[] = [];
      let charOffset = 0;

      for (const raw of rawTokens) {
        if (totalTokenCount >= maxTokens) break;

        const start = sentText.indexOf(raw, charOffset);
        const end = start + raw.length;
        charOffset = end;

        const token = analyzeToken(raw, { start, end }, graph);
        tokens.push(token);
        totalTokenCount++;

        // Track unresolved tokens
        if (
          !token.verified &&
          token.pos !== "particle" &&
          !/^\d/.test(token.surface)
        ) {
          const contextStart = Math.max(0, start - 30);
          const contextEnd = Math.min(sentText.length, end + 30);

          allUnresolved.push({
            surface: token.surface,
            position: { start, end },
            context: sentText.slice(contextStart, contextEnd),
            suggestedTranslations: [],
          });
        }
      }

      // Group phrases
      const phrases = groupPhrases(tokens);

      // Detect sentence type
      const lastChar = sentText.trim().slice(-1);
      const sentType =
        lastChar === "?"
          ? "interrogative"
          : lastChar === "!"
            ? "exclamatory"
            : sentText.trim().startsWith("Please") ||
                sentText.trim().startsWith("Tafadhali")
              ? "imperative"
              : "declarative";

      // Grammar score (simplified; the full grammar engine can be called separately)
      const verifiedRatio =
        tokens.length > 0
          ? tokens.filter((t) => t.verified).length / tokens.length
          : 1;

      sentences.push({
        text: sentText,
        language: sentLang,
        type: sentType as Sentence["type"],
        phrases: phrases as Phrase[],
        tokens,
        translations: {},
        formality: "neutral",
        hasCodeSwitching: sentLang === "mixed",
        grammarScore: verifiedRatio,
        index: sentIdx,
      });
    }

    const paraLang = detectLanguage(paraText);
    const paraDomains = [
      ...new Set(sentences.flatMap((s) => s.tokens.flatMap((t) => t.domains))),
    ];

    return {
      text: paraText,
      sentences,
      language: paraLang,
      domains: paraDomains,
      index: paraIdx,
    };
  });

  // Compute stats
  const allTokens = paragraphs.flatMap((p) =>
    p.sentences.flatMap((s) => s.tokens),
  );
  const uniqueTokenSet = new Set(allTokens.map((t) => t.normalized));
  const verifiedTokens = allTokens.filter((t) => t.verified);
  const financialTokens = allTokens.filter((t) => t.isFinancialTerm);
  const swTokens = allTokens.filter((t) => t.language === "sw");
  const enTokens = allTokens.filter((t) => t.language === "en");
  const allMorphemes = allTokens.flatMap((t) => t.morphemes);
  const grammarScores = paragraphs.flatMap((p) =>
    p.sentences.map((s) => s.grammarScore),
  );
  const avgGrammar =
    grammarScores.length > 0
      ? grammarScores.reduce((a, b) => a + b, 0) / grammarScores.length
      : 1;

  const processingTimeMs = Date.now() - startTime;

  return {
    id: uuidv4(),
    sourceId,
    sourceType,
    rawText: text,
    primaryLanguage: detectLanguage(text),
    paragraphs,
    stats: {
      totalParagraphs: paragraphs.length,
      totalSentences: paragraphs.reduce(
        (sum, p) => sum + p.sentences.length,
        0,
      ),
      totalTokens: allTokens.length,
      totalMorphemes: allMorphemes.length,
      uniqueTokens: uniqueTokenSet.size,
      verifiedTokens: verifiedTokens.length,
      unverifiedTokens: allTokens.length - verifiedTokens.length,
      financialTerms: financialTokens.length,
      swahiliTokens: swTokens.length,
      englishTokens: enTokens.length,
      dictionaryCoverage:
        allTokens.length > 0 ? verifiedTokens.length / allTokens.length : 1,
      grammarScore: avgGrammar,
    },
    unresolvedTokens: allUnresolved,
    metadata: {
      decomposedAt: new Date().toISOString(),
      processingTimeMs,
      engineVersion: "1.0.0",
      usedOnlineSearch: false,
      usedNeuralFallback: false,
    },
  };
}

/**
 * Quick decomposition that returns just the key stats.
 * Use for real-time analysis of chat messages.
 */
export function quickAnalyze(text: string): {
  readonly language: "en" | "sw" | "mixed";
  readonly tokenCount: number;
  readonly dictionaryCoverage: number;
  readonly hasUnknownTerms: boolean;
  readonly financialTermCount: number;
  readonly unknownTerms: readonly string[];
} {
  const atom = decomposeText(text, { sourceType: "chat_message" });
  return {
    language: atom.primaryLanguage,
    tokenCount: atom.stats.totalTokens,
    dictionaryCoverage: atom.stats.dictionaryCoverage,
    hasUnknownTerms: atom.stats.unverifiedTokens > 0,
    financialTermCount: atom.stats.financialTerms,
    unknownTerms: atom.unresolvedTokens.map((u) => u.surface),
  };
}
