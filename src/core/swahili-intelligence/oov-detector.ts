/**
 * Swahili OOV (Out-of-Vocabulary) Detector
 *
 * Detects unknown Swahili words in real-time during conversation.
 * When a word is unknown, generates a natural clarification question
 * in Swahili (or English) so the AI can learn from the user.
 *
 * Philosophy: Better to ask and learn than to assume and be wrong.
 * But also don't ask too much; max 2 clarifications per message.
 */

import type {
  OOVDetectionResult,
  ClarificationRequest,
  SwahiliEngineConfig,
} from "./types";
import { analyzeWord, looksLikeSwahili } from "./morphological-analyzer";
import { lookupBulk } from "./vocabulary-service";

// ============================================================================
// Common Swahili Stop Words (never flag these as unknown)
// ============================================================================

const SWAHILI_STOP_WORDS: ReadonlySet<string> = new Set([
  // Pronouns
  "mimi",
  "wewe",
  "yeye",
  "sisi",
  "nyinyi",
  "wao",
  // Possessives
  "yangu",
  "yako",
  "yake",
  "yetu",
  "yenu",
  "yao",
  "wangu",
  "wako",
  "wake",
  "wetu",
  "wenu",
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
  // Demonstratives
  "hii",
  "hiyo",
  "ile",
  "hizi",
  "hizo",
  "zile",
  "huyu",
  "huyo",
  "yule",
  "hawa",
  "hao",
  "wale",
  "hiki",
  "hicho",
  "kile",
  "hivi",
  "hivyo",
  "vile",
  "hili",
  "hilo",
  "lile",
  "haya",
  "hayo",
  "yale",
  // Conjunctions & particles
  "na",
  "au",
  "lakini",
  "kwa",
  "ya",
  "wa",
  "za",
  "la",
  "pia",
  "bado",
  "sana",
  "tu",
  "kama",
  "ili",
  "kwamba",
  "hata",
  "ingawa",
  "bali",
  "wala",
  "ama",
  "hivyo",
  "ndio",
  "ndiyo",
  "hapana",
  "naam",
  "siyo",
  // Prepositions
  "katika",
  "kutoka",
  "hadi",
  "mpaka",
  "kuhusu",
  "kati",
  "juu",
  "chini",
  "ndani",
  "nje",
  "mbele",
  "nyuma",
  // Question words
  "nani",
  "nini",
  "wapi",
  "lini",
  "vipi",
  "kwa nini",
  "je",
  // Common verbs (short forms, always known)
  "ni",
  "si",
  "kuwa",
  "ana",
  "ina",
  "una",
  // Time words
  "sasa",
  "leo",
  "jana",
  "kesho",
  "mwaka",
  "mwezi",
  "wiki",
  "asubuhi",
  "mchana",
  "jioni",
  "usiku",
  // Numbers
  "moja",
  "mbili",
  "tatu",
  "nne",
  "tano",
  "sita",
  "saba",
  "nane",
  "tisa",
  "kumi",
  // Common adjectives
  "kubwa",
  "ndogo",
  "nzuri",
  "mbaya",
  "nyingi",
  "ndefu",
  "fupi",
  "mpya",
  "zamani",
  // Greetings and interjections
  "habari",
  "salaam",
  "asante",
  "tafadhali",
  "samahani",
  "karibu",
  "kwaheri",
  "pole",
  "hodi",
  "shikamoo",
  "marahaba",
  "mambo",
  "vipi",
  "poa",
  "safi",
  "freshi",
]);

// English words commonly used in Swahili code-switching (don't flag)
const CODE_SWITCH_ENGLISH: ReadonlySet<string> = new Set([
  "okay",
  "ok",
  "yes",
  "no",
  "please",
  "sorry",
  "thanks",
  "hello",
  "hi",
  "bye",
  "meeting",
  "phone",
  "email",
  "bank",
  "loan",
  "business",
  "office",
  "manager",
  "report",
  "system",
  "data",
  "file",
  "computer",
  "online",
  "internet",
  "mobile",
  "app",
  "website",
  "account",
  "password",
  "login",
  "download",
  "upload",
]);

// ============================================================================
// Core OOV Detection
// ============================================================================

/**
 * Tokenize a Swahili message into words.
 */
export function tokenizeSwahili(message: string): readonly string[] {
  return message
    .replace(/[.,;:!?()[\]{}"'`/\\@#$%^&*+=~<>|]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Detect unknown words in a Swahili message.
 * Returns detection results for each non-trivial token.
 */
export async function detectOOVWords(
  message: string,
  config: SwahiliEngineConfig = {
    confidenceThresholdForClarification: 0.3,
    confidenceThresholdForVerified: 0.8,
    maxClarificationPerMessage: 2,
    enableCommunityLearning: true,
    enableAutoInference: true,
    priorityDomains: ["finance", "agriculture", "credit", "business"],
  },
): Promise<readonly OOVDetectionResult[]> {
  const tokens = tokenizeSwahili(message);
  const results: OOVDetectionResult[] = [];

  // Skip tokens that are obviously known
  const tokensToCheck = tokens.filter((t) => {
    const lower = t.toLowerCase();
    // Skip numbers
    if (/^\d+$/.test(lower)) return false;
    // Skip single characters
    if (lower.length <= 1) return false;
    // Skip stop words
    if (SWAHILI_STOP_WORDS.has(lower)) return false;
    // Skip common English code-switch words
    if (CODE_SWITCH_ENGLISH.has(lower)) return false;
    return true;
  });

  if (tokensToCheck.length === 0) return [];

  // Bulk lookup for efficiency
  const lookupResults = await lookupBulk(tokensToCheck);

  for (const token of tokensToCheck) {
    const vocabEntry = lookupResults.get(token) ?? null;
    const morphBreakdown = analyzeWord(token);
    const isSwahiliLike = looksLikeSwahili(token);

    if (vocabEntry) {
      // Known word
      results.push({
        token,
        isKnown: true,
        confidence: vocabEntry.confidence,
        morphemeBreakdown: morphBreakdown,
        rootFound: true,
        suggestedMeaning: vocabEntry.definitionEn,
        needsClarification: false,
        similarKnownWords: [],
      });
    } else if (
      morphBreakdown.confidence >= 0.5 &&
      morphBreakdown.root !== token.toLowerCase()
    ) {
      // Morphologically decomposable (we know the structure even if not the exact word)
      results.push({
        token,
        isKnown: false,
        confidence: morphBreakdown.confidence * 0.7,
        morphemeBreakdown: morphBreakdown,
        rootFound: morphBreakdown.confidence >= 0.6,
        suggestedMeaning: null,
        needsClarification:
          morphBreakdown.confidence * 0.7 <
            config.confidenceThresholdForClarification && isSwahiliLike,
        similarKnownWords: [],
      });
    } else if (isSwahiliLike) {
      // Looks like Swahili but we don't know it
      results.push({
        token,
        isKnown: false,
        confidence: 0.1,
        morphemeBreakdown: morphBreakdown,
        rootFound: false,
        suggestedMeaning: null,
        needsClarification: true,
        similarKnownWords: [],
      });
    } else {
      // Probably not Swahili (English or other)
      results.push({
        token,
        isKnown: false,
        confidence: 0,
        morphemeBreakdown: null,
        rootFound: false,
        suggestedMeaning: null,
        needsClarification: false,
        similarKnownWords: [],
      });
    }
  }

  return results;
}

// ============================================================================
// Clarification Question Generator
// ============================================================================

/**
 * Generate natural clarification questions for unknown words.
 * Returns at most `maxQuestions` clarification requests.
 */
export function generateClarifications(
  oovResults: readonly OOVDetectionResult[],
  originalMessage: string,
  maxQuestions: number = 2,
): readonly ClarificationRequest[] {
  const unknowns = oovResults.filter((r) => r.needsClarification);

  if (unknowns.length === 0) return [];

  // Prioritize: shorter words (more likely to be real words) and
  // words that look more Swahili
  const sorted = [...unknowns].sort((a, b) => {
    // Prefer words with some morphological structure
    const aScore =
      (a.morphemeBreakdown?.confidence ?? 0) + (a.rootFound ? 0.2 : 0);
    const bScore =
      (b.morphemeBreakdown?.confidence ?? 0) + (b.rootFound ? 0.2 : 0);
    return bScore - aScore;
  });

  const selected = sorted.slice(0, maxQuestions);

  return selected.map((oov) => buildClarificationRequest(oov, originalMessage));
}

function buildClarificationRequest(
  oov: OOVDetectionResult,
  contextSentence: string,
): ClarificationRequest {
  const word = oov.token;
  const hasRoot =
    oov.morphemeBreakdown && oov.morphemeBreakdown.root !== word.toLowerCase();

  // Build Swahili question (natural, conversational)
  let questionSw: string;
  let questionEn: string;

  if (hasRoot && oov.morphemeBreakdown) {
    const root = oov.morphemeBreakdown.root;
    questionSw =
      `Samahani, sijaelewa vizuri neno "${word}". ` +
      `Naona mzizi wake unaweza kuwa "${root}". ` +
      `Je, unaweza kunieleza maana yake?`;
    questionEn =
      `I noticed the word "${word}" (root: "${root}"). ` +
      `Could you explain what it means? I want to learn it.`;
  } else {
    questionSw =
      `Samahani, sijui neno "${word}". ` +
      `Je, unaweza kunieleza maana yake? Nataka kujifunza.`;
    questionEn =
      `I don't know the word "${word}" yet. ` +
      `Could you tell me what it means? I'd like to learn it.`;
  }

  return {
    unknownWord: word,
    contextSentence,
    questionSw,
    questionEn,
    morphemeHint: oov.morphemeBreakdown,
  };
}

// ============================================================================
// Response Analysis (detect when user teaches us a word)
// ============================================================================

/**
 * Check if a user's message is teaching us a word we asked about.
 * Patterns: "X means Y", "X ni Y", "it means Y", "maana yake ni Y"
 */
export function detectTeachingResponse(
  userMessage: string,
  previouslyAskedWord: string | null,
): { word: string; definition: string } | null {
  const message = userMessage.trim();

  // Pattern: "X means Y" or "X ni Y"
  const meansPattern =
    /^["']?(\w+)["']?\s+(?:means?|ni|maana yake ni|maana ni)\s+(.+)/i;
  const meansMatch = message.match(meansPattern);
  if (meansMatch) {
    return { word: meansMatch[1], definition: meansMatch[2].trim() };
  }

  // Pattern: "it means Y" (assumes we just asked about a word)
  if (previouslyAskedWord) {
    const itMeansPattern =
      /^(?:it\s+means?|maana yake ni|maana ni|ni|that means)\s+(.+)/i;
    const itMeansMatch = message.match(itMeansPattern);
    if (itMeansMatch) {
      return {
        word: previouslyAskedWord,
        definition: itMeansMatch[1].trim(),
      };
    }

    // Pattern: simple one-line definition (if we asked and they just replied with the meaning)
    if (
      message.split(/\s+/).length <= 10 &&
      !message.includes("?") &&
      previouslyAskedWord
    ) {
      // Heuristic: if the reply is short and doesn't contain a question,
      // they might be defining the word. But be cautious.
      return null; // Too ambiguous, don't assume
    }
  }

  return null;
}

// ============================================================================
// Conversation Context Builder (for RAG injection into prompts)
// ============================================================================

/**
 * Build a vocabulary context block for the AI prompt.
 * This is injected into the system prompt so the AI knows
 * what Swahili words it has learned and their meanings.
 */
export function buildVocabularyContextBlock(
  oovResults: readonly OOVDetectionResult[],
  sessionLearnedWords: ReadonlyMap<string, string>,
): string | null {
  const parts: string[] = [];

  // Known words from vocabulary
  const knownWords = oovResults.filter((r) => r.isKnown && r.suggestedMeaning);
  if (knownWords.length > 0) {
    parts.push(
      "Swahili vocabulary in this message:\n" +
        knownWords.map((w) => `- ${w.token}: ${w.suggestedMeaning}`).join("\n"),
    );
  }

  // Words learned this session
  if (sessionLearnedWords.size > 0) {
    parts.push(
      "Words learned this session:\n" +
        Array.from(sessionLearnedWords.entries())
          .map(([word, def]) => `- ${word}: ${def} [user-taught]`)
          .join("\n"),
    );
  }

  // Unknown words that need clarification
  const unknowns = oovResults.filter((r) => r.needsClarification);
  if (unknowns.length > 0) {
    parts.push(
      "Unknown Swahili words (ASK the user what they mean, don't guess):\n" +
        unknowns.map((w) => `- "${w.token}"`).join("\n"),
    );
  }

  if (parts.length === 0) return null;

  return `## Swahili Intelligence\n${parts.join("\n\n")}`;
}
