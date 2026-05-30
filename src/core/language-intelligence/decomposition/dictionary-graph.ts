/**
 * Dictionary Graph Store
 *
 * In-memory trie + hash map for sub-millisecond dictionary lookups.
 * This is Layer 1 of the Swahili Intelligence Engine:
 *
 *   L1: Dictionary Graph (this file) — <0.5ms per lookup
 *   L2: Translation Memory Cache — <0.5ms (existing translation-memory.ts)
 *   L3: Neural/API Fallback — ~100ms (existing external-dictionary-service.ts)
 *
 * The graph stores every word from:
 *   1. Financial Dictionary (520 terms)
 *   2. General Vocabulary (greetings, connectors, etc.)
 *   3. Grammar Engine roots (from swahili-grammar.ts)
 *   4. Learned terms (from translation memory)
 *   5. External API results (cached permanently)
 *
 * Swahili morphological awareness: When a word like "walikuwa" isn't found
 * directly, the graph strips prefixes using noun class / verb morphology
 * rules until it finds the root "-kuwa" (to be).
 *
 * @module decomposition/dictionary-graph
 */

import type { DictionaryNode, Morpheme, MorphemeType } from "./types";

// ============================================================================
// Trie Node for Prefix-Based Lookups
// ============================================================================

interface TrieNode {
  readonly children: Map<string, TrieNode>;
  entry: DictionaryNode | null;
}

function createTrieNode(): TrieNode {
  return { children: new Map(), entry: null };
}

// ============================================================================
// Swahili Verb Prefixes for Morphological Stripping
// ============================================================================

const SUBJECT_PREFIXES: ReadonlyArray<{
  readonly prefix: string;
  readonly person: string;
}> = [
  { prefix: "ni", person: "1sg" },
  { prefix: "u", person: "2sg" },
  { prefix: "a", person: "3sg" },
  { prefix: "tu", person: "1pl" },
  { prefix: "m", person: "2pl" },
  { prefix: "wa", person: "3pl" },
];

const TENSE_MARKERS: ReadonlyArray<{
  readonly marker: string;
  readonly tense: string;
}> = [
  { marker: "li", tense: "past" },
  { marker: "na", tense: "present" },
  { marker: "ta", tense: "future" },
  { marker: "me", tense: "perfect" },
  { marker: "ki", tense: "habitual" },
  { marker: "nge", tense: "conditional" },
  { marker: "ngali", tense: "conditional" },
];

const NEGATIVE_PREFIXES = ["ha", "si"] as const;

const DERIVATIONAL_SUFFIXES: ReadonlyArray<{
  readonly suffix: string;
  readonly type: string;
  readonly gloss: string;
}> = [
  { suffix: "isha", type: "causative", gloss: "cause to" },
  { suffix: "sha", type: "causative", gloss: "cause to" },
  { suffix: "wa", type: "passive", gloss: "be done to" },
  { suffix: "ana", type: "reciprocal", gloss: "each other" },
  { suffix: "ia", type: "applicative", gloss: "for/to" },
  { suffix: "ika", type: "stative", gloss: "be able to" },
];

// Common Swahili noun class prefixes for stripping
const NOUN_PREFIXES: ReadonlyArray<{
  readonly prefix: string;
  readonly classNum: number;
  readonly number: "sg" | "pl";
}> = [
  { prefix: "m", classNum: 1, number: "sg" },
  { prefix: "wa", classNum: 2, number: "pl" },
  { prefix: "m", classNum: 3, number: "sg" },
  { prefix: "mi", classNum: 4, number: "pl" },
  { prefix: "ji", classNum: 5, number: "sg" },
  { prefix: "ma", classNum: 6, number: "pl" },
  { prefix: "ki", classNum: 7, number: "sg" },
  { prefix: "vi", classNum: 8, number: "pl" },
  { prefix: "n", classNum: 9, number: "sg" },
  { prefix: "n", classNum: 10, number: "pl" },
  { prefix: "u", classNum: 11, number: "sg" },
  { prefix: "ku", classNum: 15, number: "sg" },
  { prefix: "pa", classNum: 16, number: "sg" },
  { prefix: "mu", classNum: 18, number: "sg" },
];

// ============================================================================
// Dictionary Graph Class
// ============================================================================

export interface MorphologicalResult {
  readonly found: boolean;
  readonly node: DictionaryNode | null;
  readonly morphemes: readonly Morpheme[];
  readonly root: string;
  readonly confidence: number;
}

export interface GraphStats {
  readonly totalEntries: number;
  readonly swahiliEntries: number;
  readonly englishEntries: number;
  readonly financialTerms: number;
  readonly sources: Record<string, number>;
}

export class DictionaryGraph {
  private readonly swTrie: TrieNode = createTrieNode();
  private readonly enTrie: TrieNode = createTrieNode();
  private readonly swMap: Map<string, DictionaryNode> = new Map();
  private readonly enMap: Map<string, DictionaryNode> = new Map();
  private readonly lemmaIndex: Map<string, readonly DictionaryNode[]> =
    new Map();

  // ── Insert ──────────────────────────────────────────────────────────

  insert(node: DictionaryNode): void {
    const key = node.form.toLowerCase();
    const trie = node.language === "sw" ? this.swTrie : this.enTrie;
    const map = node.language === "sw" ? this.swMap : this.enMap;

    // Insert into hash map
    map.set(key, node);

    // Insert into trie
    let current = trie;
    for (const char of key) {
      if (!current.children.has(char)) {
        current.children.set(char, createTrieNode());
      }
      current = current.children.get(char)!;
    }
    current.entry = node;

    // Index by lemma
    if (node.lemma) {
      const lemmaKey = node.lemma.toLowerCase();
      const existing = this.lemmaIndex.get(lemmaKey) ?? [];
      this.lemmaIndex.set(lemmaKey, [...existing, node]);
    }
  }

  // ── Direct Lookup ───────────────────────────────────────────────────

  lookup(word: string, language: "en" | "sw"): DictionaryNode | null {
    const map = language === "sw" ? this.swMap : this.enMap;
    return map.get(word.toLowerCase()) ?? null;
  }

  // ── Prefix Search (for autocomplete / partial matching) ─────────────

  prefixSearch(
    prefix: string,
    language: "en" | "sw",
    limit: number = 20,
  ): readonly DictionaryNode[] {
    const trie = language === "sw" ? this.swTrie : this.enTrie;
    const results: DictionaryNode[] = [];
    const lowerPrefix = prefix.toLowerCase();

    // Navigate to prefix node
    let current: TrieNode | undefined = trie;
    for (const char of lowerPrefix) {
      current = current?.children.get(char);
      if (!current) return [];
    }

    // Collect all entries under this prefix
    const collect = (node: TrieNode) => {
      if (results.length >= limit) return;
      if (node.entry) results.push(node.entry);
      for (const child of node.children.values()) {
        if (results.length >= limit) break;
        collect(child);
      }
    };

    collect(current);
    return results;
  }

  // ── Lemma Lookup ────────────────────────────────────────────────────

  lookupByLemma(lemma: string): readonly DictionaryNode[] {
    return this.lemmaIndex.get(lemma.toLowerCase()) ?? [];
  }

  // ── Morphological Decomposition (Swahili) ───────────────────────────

  /**
   * Attempts to decompose a Swahili word into morphemes by stripping
   * known prefixes/suffixes and searching for the root in the dictionary.
   *
   * Example: "walipokuwa" ->
   *   wa- (3pl subject) + li- (past tense) + po- (when/relative) + -kuwa (root: to be)
   */
  decompose(word: string): MorphologicalResult {
    const lower = word.toLowerCase();

    // 1. Direct lookup first
    const direct = this.swMap.get(lower);
    if (direct) {
      return {
        found: true,
        node: direct,
        morphemes: direct.morphemes ?? [
          {
            form: lower,
            type: "standalone" as MorphemeType,
            gloss: direct.translations.en ?? lower,
            confidence: 1.0,
          },
        ],
        root: direct.lemma ?? lower,
        confidence: 1.0,
      };
    }

    // 2. Try verb morphology decomposition
    const verbResult = this.decomposeVerb(lower);
    if (verbResult.found) return verbResult;

    // 3. Try noun prefix stripping
    const nounResult = this.decomposeNoun(lower);
    if (nounResult.found) return nounResult;

    // 4. Not found
    return {
      found: false,
      node: null,
      morphemes: [
        {
          form: lower,
          type: "standalone" as MorphemeType,
          gloss: "?",
          confidence: 0,
        },
      ],
      root: lower,
      confidence: 0,
    };
  }

  private decomposeVerb(word: string): MorphologicalResult {
    const morphemes: Morpheme[] = [];
    let remaining = word;
    let confidence = 0.3; // Start low, increase as we find matches

    // Check for negative prefix
    let isNegative = false;
    for (const neg of NEGATIVE_PREFIXES) {
      if (remaining.startsWith(neg) && remaining.length > neg.length + 2) {
        isNegative = true;
        morphemes.push({
          form: neg,
          type: "negative" as MorphemeType,
          gloss: "not",
          confidence: 0.8,
        });
        remaining = remaining.slice(neg.length);
        break;
      }
    }

    // Try subject prefix
    let foundSubject = false;
    for (const sp of SUBJECT_PREFIXES) {
      if (
        remaining.startsWith(sp.prefix) &&
        remaining.length > sp.prefix.length + 1
      ) {
        morphemes.push({
          form: sp.prefix,
          type: "prefix" as MorphemeType,
          gloss: `subject ${sp.person}`,
          person: sp.person as Morpheme["person"],
          confidence: 0.7,
        });
        remaining = remaining.slice(sp.prefix.length);
        foundSubject = true;
        confidence += 0.1;
        break;
      }
    }

    if (!foundSubject && !isNegative) {
      return {
        found: false,
        node: null,
        morphemes: [],
        root: word,
        confidence: 0,
      };
    }

    // Try tense marker
    for (const tm of TENSE_MARKERS) {
      if (
        remaining.startsWith(tm.marker) &&
        remaining.length > tm.marker.length
      ) {
        morphemes.push({
          form: tm.marker,
          type: "tense_marker" as MorphemeType,
          gloss: tm.tense,
          tense: tm.tense as Morpheme["tense"],
          confidence: 0.8,
        });
        remaining = remaining.slice(tm.marker.length);
        confidence += 0.2;
        break;
      }
    }

    // Check for relative marker
    if (
      remaining.startsWith("po") ||
      remaining.startsWith("ko") ||
      remaining.startsWith("mo")
    ) {
      morphemes.push({
        form: remaining.slice(0, 2),
        type: "relative" as MorphemeType,
        gloss: "relative/when",
        confidence: 0.7,
      });
      remaining = remaining.slice(2);
      confidence += 0.1;
    }

    // The remaining should be the root (+ possible derivational suffix)
    if (remaining.length >= 2) {
      // Check derivational suffixes
      let rootPart = remaining;
      for (const ds of DERIVATIONAL_SUFFIXES) {
        if (
          remaining.endsWith(ds.suffix) &&
          remaining.length > ds.suffix.length + 1
        ) {
          rootPart = remaining.slice(0, -ds.suffix.length);
          morphemes.push({
            form: rootPart,
            type: "root" as MorphemeType,
            gloss: "root",
            confidence: 0.6,
          });
          morphemes.push({
            form: ds.suffix,
            type: "derivational" as MorphemeType,
            gloss: ds.gloss,
            confidence: 0.7,
          });
          break;
        }
      }

      // If no derivational suffix found, whole remaining is root
      if (rootPart === remaining) {
        morphemes.push({
          form: remaining,
          type: "root" as MorphemeType,
          gloss: "root",
          confidence: 0.6,
        });
      }

      // Try to find the root in the dictionary
      const rootLookup =
        this.swMap.get(remaining) ?? this.swMap.get(`-${remaining}`);
      if (rootLookup) {
        confidence += 0.3;
        return {
          found: true,
          node: rootLookup,
          morphemes,
          root: remaining,
          confidence: Math.min(confidence, 1.0),
        };
      }

      // Even without dictionary match, if we found subject + tense, it's likely valid
      if (morphemes.length >= 3) {
        return {
          found: true,
          node: null,
          morphemes,
          root: remaining,
          confidence: Math.min(confidence, 0.7),
        };
      }
    }

    return {
      found: false,
      node: null,
      morphemes: [],
      root: word,
      confidence: 0,
    };
  }

  private decomposeNoun(word: string): MorphologicalResult {
    for (const np of NOUN_PREFIXES) {
      if (word.startsWith(np.prefix) && word.length > np.prefix.length + 1) {
        const stem = word.slice(np.prefix.length);
        const stemLookup = this.swMap.get(stem) ?? this.swMap.get(`-${stem}`);

        if (stemLookup) {
          return {
            found: true,
            node: stemLookup,
            morphemes: [
              {
                form: np.prefix,
                type: "prefix" as MorphemeType,
                gloss: `class ${np.classNum} ${np.number}`,
                nounClass: np.classNum,
                confidence: 0.8,
              },
              {
                form: stem,
                type: "root" as MorphemeType,
                gloss: stemLookup.translations.en ?? stem,
                confidence: 0.9,
              },
            ],
            root: stem,
            confidence: 0.85,
          };
        }
      }
    }

    return {
      found: false,
      node: null,
      morphemes: [],
      root: word,
      confidence: 0,
    };
  }

  // ── Bulk Insert ─────────────────────────────────────────────────────

  insertMany(nodes: readonly DictionaryNode[]): void {
    for (const node of nodes) {
      this.insert(node);
    }
  }

  // ── Statistics ──────────────────────────────────────────────────────

  getStats(): GraphStats {
    const sources: Record<string, number> = {};

    const countSources = (map: Map<string, DictionaryNode>) => {
      for (const node of map.values()) {
        sources[node.source] = (sources[node.source] ?? 0) + 1;
      }
    };

    countSources(this.swMap);
    countSources(this.enMap);

    const financialCount = [
      ...this.swMap.values(),
      ...this.enMap.values(),
    ].filter(
      (n) =>
        n.domains.includes("finance") || n.source === "financial_dictionary",
    ).length;

    return {
      totalEntries: this.swMap.size + this.enMap.size,
      swahiliEntries: this.swMap.size,
      englishEntries: this.enMap.size,
      financialTerms: financialCount,
      sources,
    };
  }

  // ── Has Word ────────────────────────────────────────────────────────

  has(word: string, language: "en" | "sw"): boolean {
    const map = language === "sw" ? this.swMap : this.enMap;
    return map.has(word.toLowerCase());
  }

  // ── Get All Entries ─────────────────────────────────────────────────

  getAllEntries(language: "en" | "sw"): readonly DictionaryNode[] {
    const map = language === "sw" ? this.swMap : this.enMap;
    return [...map.values()];
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let graphInstance: DictionaryGraph | null = null;

export function getDictionaryGraph(): DictionaryGraph {
  if (!graphInstance) {
    graphInstance = new DictionaryGraph();
  }
  return graphInstance;
}

export function resetDictionaryGraph(): void {
  graphInstance = null;
}
