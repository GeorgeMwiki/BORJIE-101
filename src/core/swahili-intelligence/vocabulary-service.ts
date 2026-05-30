/**
 * Swahili Vocabulary Service
 *
 * Manages the living Swahili vocabulary database. Handles lookups,
 * insertions, confidence scoring, and community-sourced learning.
 * Uses Supabase for persistent storage with in-memory cache for speed.
 */

import type {
  VocabularyEntry,
  UserVocabularySubmission,
  VocabularySource,
  VocabularyStatus,
  LearningEvent,
  LearningEventType,
  VocabularyExample,
  MorphemeBreakdown,
  NounClass,
  PartOfSpeech,
  Dialect,
} from "./types";
import { extractRoot, analyzeWord } from "./morphological-analyzer";
import { createClient } from "@supabase/supabase-js";

// ============================================================================
// In-Memory Cache (for hot-path lookups during conversation)
// ============================================================================

interface CacheEntry {
  readonly entry: VocabularyEntry;
  readonly cachedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 2000;
const vocabularyCache = new Map<string, CacheEntry>();

function getCached(key: string): VocabularyEntry | null {
  const entry = vocabularyCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    vocabularyCache.delete(key);
    return null;
  }
  return entry.entry;
}

function setCache(key: string, entry: VocabularyEntry): void {
  if (vocabularyCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest
    const oldest = vocabularyCache.keys().next().value;
    if (oldest !== undefined) vocabularyCache.delete(oldest);
  }
  vocabularyCache.set(key, { entry, cachedAt: Date.now() });
}

// ============================================================================
// Database Client (lazy initialization)
// ============================================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase credentials not configured for Swahili vocabulary service",
    );
  }

  return createClient(url, key);
}

// ============================================================================
// Fuzzy Matching (Levenshtein Distance)
// ============================================================================

/**
 * Compute Levenshtein distance between two strings.
 * Used for recovering from typos, ASR transcription errors, and
 * pronunciation-based misspellings (e.g., "silingi" for "shilingi").
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Single-row optimization: only need previous row + current row
  let prev = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }
    prev = curr;
  }

  return prev[n];
}

/**
 * Common Swahili ASR phoneme confusions (used for weighted fuzzy matching).
 * These pairs are frequently confused in voice transcription and should
 * count as 0.5 distance instead of 1.0.
 */
// eslint-disable-next-line unused-imports/no-unused-vars -- variable kept for API compatibility / destructuring clarity; prefix with _ to silence permanently
const PHONEME_CONFUSIONS: ReadonlyMap<string, string> = new Map([
  ["sh", "s"], // shilingi → silingi
  ["j", "d"], // Juma → Duma
  ["ch", "c"], // chama → cama
  ["ng", "n"], // ng'ombe → n'ombe
  ["th", "t"], // thamani → tamani
  ["dh", "d"], // dhamana → damana
  ["gh", "g"], // gharama → garama
]);

/**
 * Find the closest fuzzy match from a collection of known words.
 * Only returns matches within distance threshold (default: 1 edit for short words, 2 for longer).
 */
function findFuzzyMatch(
  target: string,
  candidates: Iterable<string>,
): { word: string; distance: number } | null {
  const maxDistance = target.length <= 4 ? 1 : 2;
  let bestMatch: { word: string; distance: number } | null = null;

  for (const candidate of candidates) {
    // Skip if length difference is already too large
    if (Math.abs(candidate.length - target.length) > maxDistance) continue;

    const dist = levenshteinDistance(target, candidate);
    if (dist <= maxDistance && dist > 0) {
      if (!bestMatch || dist < bestMatch.distance) {
        bestMatch = { word: candidate, distance: dist };
      }
    }
  }

  return bestMatch;
}

// ============================================================================
// Core Lookup Functions
// ============================================================================

/**
 * Look up a Swahili word. Tries exact match first, then root-based,
 * then fuzzy matching to recover from typos and ASR transcription errors.
 * Returns null if the word is completely unknown.
 */
export async function lookupWord(
  word: string,
): Promise<VocabularyEntry | null> {
  const normalized = word.toLowerCase().trim();

  // 1. Check cache (exact match)
  const cached = getCached(normalized);
  if (cached) return cached;

  // 2. Check cache (root match)
  const root = extractRoot(normalized);
  const rootCached = getCached(`root:${root}`);
  if (rootCached) return rootCached;

  try {
    const supabase = getSupabase();

    // 3. DB exact match
    const { data: exactMatch } = await supabase
      .from("swahili_vocabulary")
      .select("*")
      .eq("word", normalized)
      .gte("confidence", 0.3)
      .order("confidence", { ascending: false })
      .limit(1)
      .single();

    if (exactMatch) {
      const entry = dbRowToEntry(exactMatch);
      setCache(normalized, entry);
      return entry;
    }

    // 4. DB root match
    const { data: rootMatch } = await supabase
      .from("swahili_vocabulary")
      .select("*")
      .eq("root", root)
      .gte("confidence", 0.3)
      .order("confidence", { ascending: false })
      .limit(1)
      .single();

    if (rootMatch) {
      const entry = dbRowToEntry(rootMatch);
      setCache(`root:${root}`, entry);
      return entry;
    }

    // 5. Fuzzy match: find closest word in DB (within edit distance 1-2)
    // Fetch candidate words with similar length for fuzzy comparison
    const minLen = Math.max(1, normalized.length - 2);
    const maxLen = normalized.length + 2;
    const { data: candidates } = await supabase
      .from("swahili_vocabulary")
      .select("word")
      .gte("confidence", 0.5)
      .gte("word", "a".repeat(minLen))
      .limit(500);

    if (candidates && candidates.length > 0) {
      const candidateWords = candidates
        .map((c: { word: string }) => c.word)
        .filter((w: string) => w.length >= minLen && w.length <= maxLen);

      const fuzzy = findFuzzyMatch(normalized, candidateWords);
      if (fuzzy) {
        const { data: fuzzyMatch } = await supabase
          .from("swahili_vocabulary")
          .select("*")
          .eq("word", fuzzy.word)
          .limit(1)
          .single();

        if (fuzzyMatch) {
          const entry = dbRowToEntry(fuzzyMatch);
          // Cache with the misspelled key too, so next lookup is instant
          setCache(normalized, entry);
          return entry;
        }
      }
    }

    // 6. Fuzzy match against seed vocabulary
    return lookupWithFuzzy(normalized, root);
  } catch {
    // DB unavailable, try seed vocabulary with fuzzy matching
    return lookupWithFuzzy(normalized, root);
  }
}

/**
 * Seed vocabulary lookup with fuzzy fallback.
 */
function lookupWithFuzzy(word: string, root: string): VocabularyEntry | null {
  // Exact match first
  const exact = SEED_VOCABULARY.get(word) ?? SEED_VOCABULARY.get(root);
  if (exact) return exact;

  // Fuzzy match against seed vocabulary
  const fuzzy = findFuzzyMatch(word, SEED_VOCABULARY.keys());
  if (fuzzy) {
    return SEED_VOCABULARY.get(fuzzy.word) ?? null;
  }

  return null;
}

/**
 * Look up multiple words in bulk (for processing entire messages).
 * Returns a map of word -> entry (null if unknown).
 */
export async function lookupBulk(
  words: readonly string[],
): Promise<ReadonlyMap<string, VocabularyEntry | null>> {
  const results = new Map<string, VocabularyEntry | null>();
  const uncached: string[] = [];

  // Check cache first
  for (const word of words) {
    const cached = getCached(word.toLowerCase().trim());
    if (cached) {
      results.set(word, cached);
    } else {
      uncached.push(word);
    }
  }

  if (uncached.length === 0) return results;

  try {
    const supabase = getSupabase();
    const normalized = uncached.map((w) => w.toLowerCase().trim());

    const { data } = await supabase
      .from("swahili_vocabulary")
      .select("*")
      .in("word", normalized)
      .gte("confidence", 0.3);

    const dbEntries = new Map<string, VocabularyEntry>();
    if (data) {
      for (const row of data) {
        const entry = dbRowToEntry(row);
        dbEntries.set(entry.word, entry);
        setCache(entry.word, entry);
      }
    }

    for (const word of uncached) {
      const norm = word.toLowerCase().trim();
      results.set(word, dbEntries.get(norm) ?? null);
    }
  } catch {
    // DB unavailable, set all uncached as null
    for (const word of uncached) {
      results.set(word, null);
    }
  }

  return results;
}

// ============================================================================
// Vocabulary Learning (User-Taught Words)
// ============================================================================

/**
 * Record a new word that a user taught us.
 * Creates a candidate entry that needs community verification.
 */
export async function learnFromUser(
  submission: UserVocabularySubmission,
): Promise<VocabularyEntry> {
  const breakdown = analyzeWord(submission.word);
  const root = breakdown.root;

  const newEntry: VocabularyEntry = {
    id: crypto.randomUUID(),
    word: submission.word.toLowerCase().trim(),
    root,
    nounClass: breakdown.nounClass,
    partOfSpeech: breakdown.isVerb
      ? "verb"
      : breakdown.isNoun
        ? "noun"
        : "unknown",
    definitionSw: null,
    definitionEn: submission.definitionProvided,
    examples: [
      {
        sentence: submission.contextSentence,
        translation: null,
        source: "conversation",
      },
    ],
    morphemeBreakdown: breakdown,
    source: "user_taught",
    confidence: 0.35, // Initial confidence for user-taught words
    usageCount: 1,
    dialect: "standard",
    domains: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const supabase = getSupabase();

    // Check if word already exists
    const { data: existing } = await supabase
      .from("swahili_vocabulary")
      .select("id, confidence, usage_count")
      .eq("word", newEntry.word)
      .limit(1)
      .single();

    if (existing) {
      // Word exists, boost confidence
      const newConfidence = Math.min(existing.confidence + 0.1, 1.0);
      await supabase
        .from("swahili_vocabulary")
        .update({
          confidence: newConfidence,
          usage_count: existing.usage_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      return { ...newEntry, id: existing.id, confidence: newConfidence };
    }

    // Insert new entry
    await supabase.from("swahili_vocabulary").insert({
      id: newEntry.id,
      word: newEntry.word,
      root: newEntry.root,
      noun_class: newEntry.nounClass,
      part_of_speech: newEntry.partOfSpeech,
      definition_sw: newEntry.definitionSw,
      definition_en: newEntry.definitionEn,
      examples: newEntry.examples,
      morpheme_breakdown: newEntry.morphemeBreakdown,
      source: newEntry.source,
      confidence: newEntry.confidence,
      usage_count: newEntry.usageCount,
      dialect: newEntry.dialect,
      domains: newEntry.domains,
    });

    // Also save to user submissions table for audit
    await supabase.from("swahili_user_vocabulary").insert({
      submitted_by: submission.submittedBy,
      word: submission.word,
      definition_provided: submission.definitionProvided,
      context_sentence: submission.contextSentence,
      conversation_id: submission.conversationId,
      status: "candidate" as VocabularyStatus,
    });

    // Log learning event
    await logLearningEvent({
      word: newEntry.word,
      vocabularyId: newEntry.id,
      eventType: "user_taught",
      userId: submission.submittedBy,
      conversationContext: submission.contextSentence,
      confidenceBefore: 0,
      confidenceAfter: newEntry.confidence,
      createdAt: new Date().toISOString(),
    });

    // Cache the new entry
    setCache(newEntry.word, newEntry);

    return newEntry;
  } catch {
    // DB unavailable; still return the entry for in-memory use
    setCache(newEntry.word, newEntry);
    return newEntry;
  }
}

/**
 * Confirm a word meaning (boosts confidence).
 * Called when another user uses the same word with matching context.
 */
export async function confirmWord(
  word: string,
  userId: string | null,
): Promise<void> {
  try {
    const supabase = getSupabase();

    const { data: existing } = await supabase
      .from("swahili_vocabulary")
      .select("id, confidence, usage_count")
      .eq("word", word.toLowerCase().trim())
      .limit(1)
      .single();

    if (existing) {
      const newConfidence = Math.min(existing.confidence + 0.05, 1.0);
      await supabase
        .from("swahili_vocabulary")
        .update({
          confidence: newConfidence,
          usage_count: existing.usage_count + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      await logLearningEvent({
        word: word.toLowerCase().trim(),
        vocabularyId: existing.id,
        eventType: "confirmed",
        userId,
        conversationContext: "",
        confidenceBefore: existing.confidence,
        confidenceAfter: newConfidence,
        createdAt: new Date().toISOString(),
      });
    }
  } catch {
    // Silent fail on DB issues
  }
}

/**
 * Increment usage count for a known word (called on every encounter).
 */
export async function recordUsage(word: string): Promise<void> {
  try {
    const supabase = getSupabase();
    const normalized = word.toLowerCase().trim();

    await supabase.rpc("increment_swahili_usage", { target_word: normalized });
  } catch {
    // Silent fail
  }
}

// ============================================================================
// Learning Event Logging
// ============================================================================

async function logLearningEvent(event: LearningEvent): Promise<void> {
  try {
    const supabase = getSupabase();

    await supabase.from("swahili_learning_events").insert({
      word: event.word,
      vocabulary_id: event.vocabularyId,
      event_type: event.eventType,
      user_id: event.userId,
      conversation_context: event.conversationContext,
      confidence_before: event.confidenceBefore,
      confidence_after: event.confidenceAfter,
    });
  } catch {
    // Silent fail on logging
  }
}

// ============================================================================
// Vocabulary Statistics
// ============================================================================

export interface VocabularyStats {
  readonly totalWords: number;
  readonly verifiedWords: number;
  readonly userTaughtWords: number;
  readonly averageConfidence: number;
  readonly topDomains: readonly { domain: string; count: number }[];
  readonly recentLearnings: readonly LearningEvent[];
}

export async function getVocabularyStats(): Promise<VocabularyStats> {
  try {
    const supabase = getSupabase();

    const { count: totalWords } = await supabase
      .from("swahili_vocabulary")
      .select("*", { count: "exact", head: true });

    const { count: verifiedWords } = await supabase
      .from("swahili_vocabulary")
      .select("*", { count: "exact", head: true })
      .gte("confidence", 0.8);

    const { count: userTaughtWords } = await supabase
      .from("swahili_vocabulary")
      .select("*", { count: "exact", head: true })
      .eq("source", "user_taught");

    const { data: recentEvents } = await supabase
      .from("swahili_learning_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    return {
      totalWords: totalWords ?? 0,
      verifiedWords: verifiedWords ?? 0,
      userTaughtWords: userTaughtWords ?? 0,
      averageConfidence: 0,
      topDomains: [],
      recentLearnings: (recentEvents ?? []).map(dbRowToLearningEvent),
    };
  } catch {
    return {
      totalWords: 0,
      verifiedWords: 0,
      userTaughtWords: 0,
      averageConfidence: 0,
      topDomains: [],
      recentLearnings: [],
    };
  }
}

// ============================================================================
// Seed Vocabulary (in-memory fallback when DB is unavailable)
// ============================================================================

const SEED_VOCABULARY: ReadonlyMap<string, VocabularyEntry> = new Map(
  buildSeedEntries().map((e) => [e.word, e]),
);

function buildSeedEntries(): VocabularyEntry[] {
  const now = new Date().toISOString();
  const seed = (
    word: string,
    root: string,
    pos: VocabularyEntry["partOfSpeech"],
    en: string,
    sw: string | null = null,
  ): VocabularyEntry => ({
    id: crypto.randomUUID(),
    word,
    root,
    nounClass: null,
    partOfSpeech: pos,
    definitionSw: sw,
    definitionEn: en,
    examples: [],
    morphemeBreakdown: null,
    source: "seed",
    confidence: 1.0,
    usageCount: 0,
    dialect: "standard",
    domains: ["finance"],
    createdAt: now,
    updatedAt: now,
  });

  return [
    // Finance/Credit domain
    seed("mkopo", "kopo", "noun", "loan, credit", "fedha inayokopeshwa"),
    seed("mikopo", "kopo", "noun", "loans (plural)", "fedha zinazokopeshwa"),
    seed("riba", "riba", "noun", "interest rate", "asilimia ya mkopo"),
    seed("deni", "deni", "noun", "debt", "fedha inayodaiwa"),
    seed("madeni", "deni", "noun", "debts (plural)", "fedha zinazodaiwa"),
    seed("benki", "benki", "noun", "bank", "taasisi ya fedha"),
    seed("pesa", "pesa", "noun", "money", "fedha, sarafu"),
    seed("fedha", "fedha", "noun", "money, currency, finance", "pesa, sarafu"),
    seed(
      "faida",
      "faida",
      "noun",
      "profit, benefit",
      "mapato zaidi ya gharama",
    ),
    seed("hasara", "hasara", "noun", "loss", "kupoteza fedha"),
    seed("bei", "bei", "noun", "price", "kiasi cha fedha"),
    seed(
      "biashara",
      "biashara",
      "noun",
      "business, trade",
      "shughuli ya kununua na kuuza",
    ),
    seed("soko", "soko", "noun", "market", "mahali pa biashara"),
    seed(
      "mtaji",
      "taji",
      "noun",
      "capital, investment",
      "fedha ya kuanzisha biashara",
    ),
    seed("hisa", "hisa", "noun", "shares, stock", "sehemu ya umiliki"),
    seed("mapato", "pato", "noun", "income, revenue", "fedha inayopatikana"),
    seed("gharama", "gharama", "noun", "cost, expense", "fedha inayotumika"),
    seed(
      "shilingi",
      "shilingi",
      "noun",
      "shilling (currency)",
      "sarafu ya Tanzania",
    ),
    seed("akaunti", "akaunti", "noun", "account", "akaunti ya benki"),
    seed(
      "dhamana",
      "dhamana",
      "noun",
      "collateral, guarantee",
      "kitu kinacholinda mkopo",
    ),
    seed("bima", "bima", "noun", "insurance", "ulinzi wa fedha"),
    seed("kodi", "kodi", "noun", "tax", "ushuru"),
    seed("mshahara", "shahara", "noun", "salary", "malipo ya kazi"),
    seed("bajeti", "bajeti", "noun", "budget", "mpango wa matumizi"),
    seed("hesabu", "hesabu", "noun", "calculation, account", "mahesabu"),
    seed("malipo", "lipo", "noun", "payment", "fedha inayolipwa"),

    // Agriculture domain
    seed("shamba", "shamba", "noun", "farm, field", "eneo la kilimo"),
    seed("mashamba", "shamba", "noun", "farms (plural)", "maeneo ya kilimo"),
    seed(
      "kilimo",
      "limo",
      "noun",
      "agriculture, farming",
      "shughuli ya kulima",
    ),
    seed("mazao", "zao", "noun", "crops, harvest", "matunda ya kilimo"),
    seed("mvua", "vua", "noun", "rain", "maji yanayoanguka kutoka angani"),
    seed("msimu", "simu", "noun", "season", "kipindi cha mwaka"),
    seed("mbolea", "bolea", "noun", "fertilizer", "kitu kinachoimarisha ardhi"),
    seed("mbegu", "begu", "noun", "seeds", "kitu kinachopandwa"),
    seed("ng'ombe", "ng'ombe", "noun", "cattle, cow", "mnyama wa ufugaji"),
    seed("kuku", "kuku", "noun", "chicken", "ndege wa nyumbani"),

    // Common verbs
    seed("kulipa", "lipa", "verb", "to pay", "kutoa malipo"),
    seed("kukopa", "kopa", "verb", "to borrow", "kuchukua mkopo"),
    seed("kukopesha", "kopa", "verb", "to lend", "kutoa mkopo"),
    seed("kuuza", "uza", "verb", "to sell", "kutoa bidhaa kwa fedha"),
    seed("kununua", "nunua", "verb", "to buy", "kuchukua bidhaa kwa fedha"),
    seed("kulima", "lima", "verb", "to farm, to cultivate", "kufanya kilimo"),
    seed("kuhifadhi", "hifadhi", "verb", "to save, to store", "kuweka salama"),
    seed("kufanya", "fanya", "verb", "to do, to make", "kutenda"),
    seed("kusoma", "soma", "verb", "to read, to study", "kujifunza"),
    seed("kuelewa", "elewa", "verb", "to understand", "kufahamu"),
    seed("kusaidia", "saidia", "verb", "to help", "kutoa msaada"),
    seed("kuomba", "omba", "verb", "to request, to pray", "kutaka msaada"),
    seed("kujifunza", "funza", "verb", "to learn", "kupata elimu"),
    seed("kuandika", "andika", "verb", "to write", "kuweka maandishi"),

    // Common adjectives/adverbs
    seed("kubwa", "kubwa", "adjective", "big, large", "si ndogo"),
    seed("ndogo", "ndogo", "adjective", "small", "si kubwa"),
    seed("bora", "bora", "adjective", "best, excellent", "nzuri sana"),
    seed("mpya", "pya", "adjective", "new", "si zamani"),
    seed("sana", "sana", "adverb", "very, a lot", "kwa wingi"),
    seed("haraka", "haraka", "adverb", "quickly, fast", "kwa kasi"),
    seed("polepole", "polepole", "adverb", "slowly", "kwa taratibu"),

    // Greetings and common phrases
    seed("habari", "habari", "noun", "news, how are you", "hali, taarifa"),
    seed("asante", "asante", "interjection", "thank you", "shukrani"),
    seed("tafadhali", "tafadhali", "interjection", "please", "kwa heshima"),
    seed(
      "samahani",
      "samahani",
      "interjection",
      "sorry, excuse me",
      "naomba msamaha",
    ),
    seed(
      "karibu",
      "karibu",
      "interjection",
      "welcome, come in",
      "pokea, ingia",
    ),
    seed("kwaheri", "kwaheri", "interjection", "goodbye", "tutaonana"),
    seed("ndiyo", "ndiyo", "particle", "yes", "kukubaliana"),
    seed("hapana", "hapana", "particle", "no", "kukataa"),
  ];
}

// ============================================================================
// DB Row Converters
// ============================================================================

interface VocabularyRow {
  readonly id: string;
  readonly word: string;
  readonly root: string;
  readonly noun_class: NounClass | null;
  readonly part_of_speech: PartOfSpeech;
  readonly definition_sw: string | null;
  readonly definition_en: string | null;
  readonly examples?: ReadonlyArray<VocabularyExample> | null;
  readonly morpheme_breakdown: MorphemeBreakdown | null;
  readonly source: VocabularySource;
  readonly confidence: number;
  readonly usage_count: number;
  readonly dialect?: Dialect | null;
  readonly domains?: ReadonlyArray<string> | null;
  readonly created_at: string;
  readonly updated_at: string;
}

interface LearningEventRow {
  readonly word: string;
  readonly vocabulary_id: string | null;
  readonly event_type: LearningEventType;
  readonly user_id: string | null;
  readonly conversation_context?: string | null;
  readonly confidence_before?: number | null;
  readonly confidence_after?: number | null;
  readonly created_at: string;
}

function dbRowToEntry(row: VocabularyRow): VocabularyEntry {
  return {
    id: row.id,
    word: row.word,
    root: row.root,
    nounClass: row.noun_class,
    partOfSpeech: row.part_of_speech,
    definitionSw: row.definition_sw,
    definitionEn: row.definition_en,
    examples: row.examples ?? [],
    morphemeBreakdown: row.morpheme_breakdown,
    source: row.source,
    confidence: row.confidence,
    usageCount: row.usage_count,
    dialect: row.dialect ?? "standard",
    domains: row.domains ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function dbRowToLearningEvent(row: LearningEventRow): LearningEvent {
  return {
    word: row.word,
    vocabularyId: row.vocabulary_id,
    eventType: row.event_type,
    userId: row.user_id,
    conversationContext: row.conversation_context ?? "",
    confidenceBefore: row.confidence_before ?? 0,
    confidenceAfter: row.confidence_after ?? 0,
    createdAt: row.created_at,
  };
}
