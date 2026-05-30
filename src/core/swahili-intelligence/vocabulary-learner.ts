/**
 * Vocabulary Learner: "Always Learning" Linkage System
 *
 * Every Swahili word encountered is documented. Words that appear
 * together in a sentence are linked, so encountering one later
 * triggers recall of the others. The system never forgets.
 *
 * Key insight: "If there are words that we use in the sentence today
 * and we forget, just create linkage so that the next time it's
 * already known."
 *
 * Architecture:
 *   1. Encounter tracking: logs every word, builds frequency maps
 *   2. Word linkage graph: co-occurrence pairs with strength scores
 *   3. Progressive confidence: 0.2 -> 0.4 -> 0.6 -> 0.7 -> 0.9
 *   4. Supabase persistence with LRU in-memory cache (5000 entries)
 *   5. Prompt context export for AI sessions
 */

import { tokenizeSwahili } from "./oov-detector";
import { recordUsage } from "./vocabulary-service";
import { createClient } from "@supabase/supabase-js";

// ── Types ────────────────────────────────────────────────────────────

export type EncounterSource =
  | "user_message"
  | "ai_response"
  | "officer_message"
  | "admin_message"
  | "system";

export interface WordEncounter {
  readonly word: string;
  readonly context: string;
  readonly source: EncounterSource;
  readonly userId: string | null;
  readonly timestamp: string;
}

export interface WordProfile {
  readonly word: string;
  readonly totalEncounters: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly confidence: number;
  readonly sources: ReadonlySet<EncounterSource>;
  readonly linkedWords: ReadonlyMap<string, number>; // word -> link strength
}

export interface WordLinkage {
  readonly wordA: string;
  readonly wordB: string;
  readonly strength: number; // 0-1, grows with co-occurrence frequency
  readonly coOccurrenceCount: number;
  readonly lastSeen: string;
}

export interface LearningStats {
  readonly totalWordsTracked: number;
  readonly wordsLearnedToday: number;
  readonly totalLinkages: number;
  readonly confidenceDistribution: {
    readonly justSeen: number; // 0.0 - 0.3
    readonly familiar: number; // 0.3 - 0.5
    readonly wellKnown: number; // 0.5 - 0.7
    readonly active: number; // 0.7 - 0.9
    readonly verified: number; // 0.9 - 1.0
  };
  readonly topCollocations: readonly {
    readonly pair: readonly [string, string];
    readonly strength: number;
  }[];
}

// ── Confidence Thresholds ────────────────────────────────────────────

const CONFIDENCE_JUST_SEEN = 0.2;
const CONFIDENCE_FAMILIAR = 0.4; // 3+ encounters
const CONFIDENCE_WELL_KNOWN = 0.6; // 10+ encounters
const CONFIDENCE_ACTIVE = 0.7; // used in user's own message
const CONFIDENCE_VERIFIED = 0.9; // confirmed by officer/admin

const FAMILIAR_THRESHOLD = 3;
const WELL_KNOWN_THRESHOLD = 10;

// ── LRU Cache ────────────────────────────────────────────────────────

const MAX_CACHE_ENTRIES = 5000;

interface LRUNode<T> {
  readonly key: string;
  readonly value: T;
}

function createLRUCache<T>(): {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  has: (key: string) => boolean;
  size: () => number;
  entries: () => ReadonlyArray<readonly [string, T]>;
} {
  const items = new Map<string, LRUNode<T>>();

  return {
    get(key: string): T | undefined {
      const node = items.get(key);
      if (!node) return undefined;
      // Move to end (most recent)
      items.delete(key);
      items.set(key, node);
      return node.value;
    },
    set(key: string, value: T): void {
      if (items.has(key)) {
        items.delete(key);
      } else if (items.size >= MAX_CACHE_ENTRIES) {
        // Evict least recently used (first key)
        const oldest = items.keys().next().value;
        if (oldest !== undefined) items.delete(oldest);
      }
      items.set(key, { key, value });
    },
    has(key: string): boolean {
      return items.has(key);
    },
    size(): number {
      return items.size;
    },
    entries(): ReadonlyArray<readonly [string, T]> {
      return Array.from(items.values()).map((n) => [n.key, n.value] as const);
    },
  };
}

// ── Supabase Client ──────────────────────────────────────────────────

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase credentials not configured for vocabulary learner",
    );
  }

  return createClient(url, key);
}

// ── Linkage Key Helper ───────────────────────────────────────────────

function linkageKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

// ── VocabularyLearner Class ──────────────────────────────────────────

export class VocabularyLearner {
  private readonly profiles = createLRUCache<WordProfile>();
  private readonly linkages = createLRUCache<WordLinkage>();
  private initialized = false;

  /**
   * Record every word in a message. Builds frequency maps,
   * updates confidence, and creates co-occurrence linkages
   * between all words in the same sentence.
   */
  async recordEncounter(
    word: string,
    context: string,
    source: EncounterSource,
    // eslint-disable-next-line unused-imports/no-unused-vars -- variable kept for API compatibility / destructuring clarity; prefix with _ to silence permanently
    userId: string | null = null,
  ): Promise<WordProfile> {
    const normalized = word.toLowerCase().trim();
    if (normalized.length <= 1) {
      return buildMinimalProfile(normalized);
    }

    const now = new Date().toISOString();
    const existing = this.profiles.get(normalized);

    const updatedSources = new Set(existing?.sources ?? []);
    updatedSources.add(source);

    const newEncounters = (existing?.totalEncounters ?? 0) + 1;
    const baseConfidence = existing?.confidence ?? 0;
    const newConfidence = computeConfidence(
      newEncounters,
      source,
      baseConfidence,
    );

    const updatedProfile: WordProfile = {
      word: normalized,
      totalEncounters: newEncounters,
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
      confidence: newConfidence,
      sources: updatedSources,
      linkedWords: existing?.linkedWords ?? new Map(),
    };

    this.profiles.set(normalized, updatedProfile);

    // Also tell the vocabulary-service about this usage
    recordUsage(normalized).catch(() => {
      /* silent */
    });

    return updatedProfile;
  }

  /**
   * Process an entire sentence: record every word AND create
   * linkages between all word pairs in the sentence.
   * This is the core "always learning" function.
   */
  async recordSentence(
    sentence: string,
    source: EncounterSource,
    userId: string | null = null,
  ): Promise<{
    readonly profiles: readonly WordProfile[];
    readonly newLinkages: number;
  }> {
    const tokens = tokenizeSwahili(sentence)
      .map((t) => t.toLowerCase().trim())
      .filter((t) => t.length > 1);

    const uniqueTokens = [...new Set(tokens)];

    // Record each word
    const profilePromises = uniqueTokens.map((token) =>
      this.recordEncounter(token, sentence, source, userId),
    );
    const profiles = await Promise.all(profilePromises);

    // Create linkages between every pair of words in the sentence
    let newLinkages = 0;
    for (let i = 0; i < uniqueTokens.length; i++) {
      for (let j = i + 1; j < uniqueTokens.length; j++) {
        const wasNew = this.strengthenLinkage(uniqueTokens[i], uniqueTokens[j]);
        if (wasNew) newLinkages++;
      }
    }

    return { profiles, newLinkages };
  }

  /**
   * Create or strengthen a linkage between two words.
   * Every co-occurrence increases the link strength.
   * Returns true if the linkage is brand new.
   */
  private strengthenLinkage(wordA: string, wordB: string): boolean {
    const key = linkageKey(wordA, wordB);
    const existing = this.linkages.get(key);
    const now = new Date().toISOString();

    const newCount = (existing?.coOccurrenceCount ?? 0) + 1;
    // Strength grows logarithmically: rapid early gains, slow later
    const newStrength = Math.min(1.0, Math.log2(newCount + 1) / Math.log2(50));

    const updatedLinkage: WordLinkage = {
      wordA: wordA < wordB ? wordA : wordB,
      wordB: wordA < wordB ? wordB : wordA,
      strength: newStrength,
      coOccurrenceCount: newCount,
      lastSeen: now,
    };

    this.linkages.set(key, updatedLinkage);

    // Also update the linkedWords map on both profiles
    this.addLinkToProfile(wordA, wordB, newStrength);
    this.addLinkToProfile(wordB, wordA, newStrength);

    return !existing;
  }

  /**
   * Add a linkage entry to a word's profile (immutable update).
   */
  private addLinkToProfile(
    word: string,
    linkedWord: string,
    strength: number,
  ): void {
    const profile = this.profiles.get(word);
    if (!profile) return;

    const updatedLinks = new Map(profile.linkedWords);
    updatedLinks.set(linkedWord, strength);

    const updatedProfile: WordProfile = {
      ...profile,
      linkedWords: updatedLinks,
    };

    this.profiles.set(word, updatedProfile);
  }

  /**
   * Get words linked to a given word, sorted by link strength.
   * This is the "recall" feature: seeing "biashara" recalls "mkopo".
   */
  getLinkedWords(
    word: string,
    minStrength: number = 0.1,
  ): readonly { readonly word: string; readonly strength: number }[] {
    const profile = this.profiles.get(word.toLowerCase().trim());
    if (!profile) return [];

    return Array.from(profile.linkedWords.entries())
      .filter(([, strength]) => strength >= minStrength)
      .map(([linkedWord, strength]) => ({ word: linkedWord, strength }))
      .sort((a, b) => b.strength - a.strength);
  }

  /**
   * Build a context string for AI prompts that includes known
   * vocabulary, confidence levels, and word linkages.
   */
  getVocabularyContextForPrompt(recentWords: readonly string[]): string | null {
    const sections: string[] = [];
    const normalizedRecent = recentWords.map((w) => w.toLowerCase().trim());

    // Gather profiles for recent words
    const knownRecent: { word: string; confidence: number; links: string[] }[] =
      [];

    for (const word of normalizedRecent) {
      const profile = this.profiles.get(word);
      if (!profile || profile.confidence < 0.2) continue;

      const topLinks = this.getLinkedWords(word, 0.2)
        .slice(0, 5)
        .map((l) => l.word);

      knownRecent.push({
        word: profile.word,
        confidence: profile.confidence,
        links: topLinks,
      });
    }

    if (knownRecent.length === 0) return null;

    // Section 1: Known words with confidence
    const vocabLines = knownRecent.map((w) => {
      const confLabel = confidenceLabel(w.confidence);
      const linkText =
        w.links.length > 0 ? ` [linked: ${w.links.join(", ")}]` : "";
      return `- ${w.word} (${confLabel})${linkText}`;
    });

    sections.push(
      "Vocabulary the system has learned:\n" + vocabLines.join("\n"),
    );

    // Section 2: Strong collocations among recent words
    const collocations: string[] = [];
    for (let i = 0; i < normalizedRecent.length; i++) {
      for (let j = i + 1; j < normalizedRecent.length; j++) {
        const key = linkageKey(normalizedRecent[i], normalizedRecent[j]);
        const link = this.linkages.get(key);
        if (link && link.strength >= 0.3) {
          collocations.push(
            `"${link.wordA} ... ${link.wordB}" (${Math.round(link.strength * 100)}% linked)`,
          );
        }
      }
    }

    if (collocations.length > 0) {
      sections.push("Word collocations detected:\n" + collocations.join("\n"));
    }

    return `## Learned Vocabulary Linkages\n${sections.join("\n\n")}`;
  }

  /**
   * Get learning statistics for dashboard display.
   */
  getLearningStats(): LearningStats {
    const todayStr = new Date().toISOString().slice(0, 10);
    let justSeen = 0;
    let familiar = 0;
    let wellKnown = 0;
    let active = 0;
    let verified = 0;
    let learnedToday = 0;

    const allProfiles = this.profiles.entries();

    for (const [, profile] of allProfiles) {
      const c = profile.confidence;
      if (c < 0.3) justSeen++;
      else if (c < 0.5) familiar++;
      else if (c < 0.7) wellKnown++;
      else if (c < 0.9) active++;
      else verified++;

      if (profile.firstSeen.startsWith(todayStr)) learnedToday++;
    }

    // Top collocations
    const allLinkages = this.linkages.entries();
    const sorted = [...allLinkages]
      .sort((a, b) => b[1].strength - a[1].strength)
      .slice(0, 10);

    const topCollocations = sorted.map(([, link]) => ({
      pair: [link.wordA, link.wordB] as const,
      strength: link.strength,
    }));

    return {
      totalWordsTracked: this.profiles.size(),
      wordsLearnedToday: learnedToday,
      totalLinkages: this.linkages.size(),
      confidenceDistribution: {
        justSeen,
        familiar,
        wellKnown,
        active,
        verified,
      },
      topCollocations,
    };
  }

  /**
   * Get words that need reinforcement (seen but low confidence).
   */
  getWeakWords(limit: number = 20): readonly WordProfile[] {
    const allProfiles = this.profiles.entries();
    return [...allProfiles]
      .map(([, profile]) => profile)
      .filter((p) => p.confidence >= 0.1 && p.confidence < 0.5)
      .sort((a, b) => a.confidence - b.confidence)
      .slice(0, limit);
  }

  /**
   * Persist learned vocabulary and linkages to Supabase.
   */
  async saveLearnedVocabulary(): Promise<{
    readonly profilesSaved: number;
    readonly linkagesSaved: number;
  }> {
    try {
      const supabase = getSupabase();
      const allProfiles = this.profiles.entries();
      const allLinkages = this.linkages.entries();

      // Batch upsert profiles
      const profileRows = [...allProfiles].map(([, p]) => ({
        word: p.word,
        total_encounters: p.totalEncounters,
        first_seen: p.firstSeen,
        last_seen: p.lastSeen,
        confidence: p.confidence,
        sources: [...p.sources],
        linked_words: Object.fromEntries(p.linkedWords),
      }));

      let profilesSaved = 0;
      if (profileRows.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < profileRows.length; i += batchSize) {
          const batch = profileRows.slice(i, i + batchSize);
          const { error } = await supabase
            .from("swahili_vocabulary_learner")
            .upsert(batch, { onConflict: "word" });
          if (!error) profilesSaved += batch.length;
        }
      }

      // Batch upsert linkages
      const linkageRows = [...allLinkages].map(([, l]) => ({
        word_a: l.wordA,
        word_b: l.wordB,
        strength: l.strength,
        co_occurrence_count: l.coOccurrenceCount,
        last_seen: l.lastSeen,
      }));

      let linkagesSaved = 0;
      if (linkageRows.length > 0) {
        const batchSize = 200;
        for (let i = 0; i < linkageRows.length; i += batchSize) {
          const batch = linkageRows.slice(i, i + batchSize);
          const { error } = await supabase
            .from("swahili_word_linkages")
            .upsert(batch, { onConflict: "word_a,word_b" });
          if (!error) linkagesSaved += batch.length;
        }
      }

      return { profilesSaved, linkagesSaved };
    } catch {
      return { profilesSaved: 0, linkagesSaved: 0 };
    }
  }

  /**
   * Restore learned vocabulary and linkages from Supabase.
   */
  async loadLearnedVocabulary(): Promise<{
    readonly profilesLoaded: number;
    readonly linkagesLoaded: number;
  }> {
    if (this.initialized) {
      return {
        profilesLoaded: this.profiles.size(),
        linkagesLoaded: this.linkages.size(),
      };
    }

    try {
      const supabase = getSupabase();

      // Load profiles (most recent first, up to cache limit)
      const { data: profileData } = await supabase
        .from("swahili_vocabulary_learner")
        .select("*")
        .order("last_seen", { ascending: false })
        .limit(MAX_CACHE_ENTRIES);

      let profilesLoaded = 0;
      if (profileData) {
        for (const row of profileData) {
          const linkedWords = new Map<string, number>(
            Object.entries(row.linked_words ?? {}),
          );
          const profile: WordProfile = {
            word: row.word,
            totalEncounters: row.total_encounters,
            firstSeen: row.first_seen,
            lastSeen: row.last_seen,
            confidence: row.confidence,
            sources: new Set(row.sources ?? []),
            linkedWords,
          };
          this.profiles.set(row.word, profile);
          profilesLoaded++;
        }
      }

      // Load linkages (strongest first, up to cache limit)
      const { data: linkageData } = await supabase
        .from("swahili_word_linkages")
        .select("*")
        .order("strength", { ascending: false })
        .limit(MAX_CACHE_ENTRIES);

      let linkagesLoaded = 0;
      if (linkageData) {
        for (const row of linkageData) {
          const link: WordLinkage = {
            wordA: row.word_a,
            wordB: row.word_b,
            strength: row.strength,
            coOccurrenceCount: row.co_occurrence_count,
            lastSeen: row.last_seen,
          };
          this.linkages.set(linkageKey(link.wordA, link.wordB), link);
          linkagesLoaded++;
        }
      }

      this.initialized = true;
      return { profilesLoaded, linkagesLoaded };
    } catch {
      this.initialized = true;
      return { profilesLoaded: 0, linkagesLoaded: 0 };
    }
  }
}

// ── Pure Helper Functions ────────────────────────────────────────────

function computeConfidence(
  encounters: number,
  source: EncounterSource,
  currentConfidence: number,
): number {
  // Source-based boosts
  if (source === "officer_message" || source === "admin_message") {
    return Math.max(currentConfidence, CONFIDENCE_VERIFIED);
  }
  if (source === "user_message") {
    // User actively used the word: at least "active" confidence
    const activeFloor = Math.max(currentConfidence, CONFIDENCE_ACTIVE);
    return applyEncounterBoost(encounters, activeFloor);
  }

  // For AI/system sources, use encounter-based progression
  return applyEncounterBoost(encounters, currentConfidence);
}

function applyEncounterBoost(
  encounters: number,
  currentConfidence: number,
): number {
  if (encounters >= WELL_KNOWN_THRESHOLD) {
    return Math.max(currentConfidence, CONFIDENCE_WELL_KNOWN);
  }
  if (encounters >= FAMILIAR_THRESHOLD) {
    return Math.max(currentConfidence, CONFIDENCE_FAMILIAR);
  }
  return Math.max(currentConfidence, CONFIDENCE_JUST_SEEN);
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.9) return "verified";
  if (confidence >= 0.7) return "active";
  if (confidence >= 0.5) return "well-known";
  if (confidence >= 0.3) return "familiar";
  return "just seen";
}

function buildMinimalProfile(word: string): WordProfile {
  return {
    word,
    totalEncounters: 0,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    confidence: 0,
    sources: new Set<EncounterSource>(),
    linkedWords: new Map(),
  };
}

// ── Singleton Instance ───────────────────────────────────────────────

let learnerInstance: VocabularyLearner | null = null;

export function getVocabularyLearner(): VocabularyLearner {
  if (!learnerInstance) {
    learnerInstance = new VocabularyLearner();
  }
  return learnerInstance;
}
