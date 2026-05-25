/**
 * Estate-glossary lookup service (Wave 28, Agent LINGDNA).
 *
 * Pure, deterministic, frozen-registry lookup over the curated glossary
 * corpus. Two concerns are kept deliberately separate:
 *
 *   1. Registry construction — builds O(1) indexes keyed by termId,
 *      lowercased English, lowercased translation, jurisdiction, and
 *      category at module load (or on `buildGlossaryRegistry()` call
 *      for custom corpora / tests).
 *
 *   2. Search API — `lookupTerm`, `searchByText`, `byJurisdiction`,
 *      `byCategory`, `translate`. Every return value is the frozen
 *      entry from the registry; callers MUST treat entries as
 *      read-only. No defensive clone is performed — that is a silent
 *      performance tax we don't want across hot chat paths.
 *
 * Rationale: downstream copilots (legal-drafter, compliance, tenant-
 * chat) ask "does the word the tenant just used map to a real estate
 * term, and if so what's the canonical definition and statute cite?"
 * That is a hot loop — we cannot afford a database round-trip or an
 * LLM call for every token. A frozen in-memory registry gives us
 * sub-millisecond grounding with predictable behaviour.
 */

import type {
  GlossaryCategory,
  GlossaryEntry,
  GlossarySearchFilters,
  Jurisdiction,
  Locale,
} from './types.js';
import { ALL_GLOSSARY_ENTRIES } from './glossary-data/index.js';

export interface GlossaryRegistry {
  readonly size: number;
  readonly entries: readonly GlossaryEntry[];
  readonly byId: ReadonlyMap<string, GlossaryEntry>;
  readonly byEnglish: ReadonlyMap<string, readonly GlossaryEntry[]>;
  readonly byTranslation: ReadonlyMap<string, readonly GlossaryEntry[]>;
  readonly byJurisdiction: ReadonlyMap<Jurisdiction, readonly GlossaryEntry[]>;
  readonly byCategory: ReadonlyMap<GlossaryCategory, readonly GlossaryEntry[]>;
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function freezeListMap<K, V>(map: Map<K, V[]>): ReadonlyMap<K, readonly V[]> {
  const frozen = new Map<K, readonly V[]>();
  for (const [k, v] of map.entries()) {
    frozen.set(k, Object.freeze([...v]));
  }
  return frozen;
}

export function buildGlossaryRegistry(
  entries: readonly GlossaryEntry[] = ALL_GLOSSARY_ENTRIES,
): GlossaryRegistry {
  const byId = new Map<string, GlossaryEntry>();
  const byEnglish = new Map<string, GlossaryEntry[]>();
  const byTranslation = new Map<string, GlossaryEntry[]>();
  const byJurisdiction = new Map<Jurisdiction, GlossaryEntry[]>();
  const byCategory = new Map<GlossaryCategory, GlossaryEntry[]>();

  for (const entry of entries) {
    if (byId.has(entry.termId)) {
      throw new Error(
        `estate-glossary: duplicate termId '${entry.termId}' — check glossary-data imports.`,
      );
    }
    byId.set(entry.termId, entry);
    pushInto(byEnglish, entry.english.toLowerCase(), entry);
    for (const syn of entry.synonyms ?? []) {
      pushInto(byEnglish, syn.toLowerCase(), entry);
    }
    for (const [locale, translation] of Object.entries(entry.translations)) {
      if (!translation) continue;
      const key = `${locale}::${translation.toLowerCase()}`;
      pushInto(byTranslation, key, entry);
    }
    for (const j of entry.jurisdictions) {
      pushInto(byJurisdiction, j, entry);
    }
    pushInto(byCategory, entry.category, entry);
  }

  return Object.freeze({
    size: entries.length,
    entries,
    byId: new Map(byId),
    byEnglish: freezeListMap(byEnglish),
    byTranslation: freezeListMap(byTranslation),
    byJurisdiction: freezeListMap(byJurisdiction),
    byCategory: freezeListMap(byCategory),
  });
}

let defaultRegistry: GlossaryRegistry | null = null;

export function getDefaultGlossaryRegistry(): GlossaryRegistry {
  if (!defaultRegistry) {
    defaultRegistry = buildGlossaryRegistry();
  }
  return defaultRegistry;
}

export function lookupTerm(
  termId: string,
  registry: GlossaryRegistry = getDefaultGlossaryRegistry(),
): GlossaryEntry | undefined {
  return registry.byId.get(termId);
}

export function searchByText(
  query: string,
  filters: GlossarySearchFilters = {},
  registry: GlossaryRegistry = getDefaultGlossaryRegistry(),
): readonly GlossaryEntry[] {
  if (!query || !query.trim()) return Object.freeze([]);
  const normalised = query.trim().toLowerCase();
  const direct = registry.byEnglish.get(normalised) ?? [];
  const translationHits = filters.locale
    ? registry.byTranslation.get(`${filters.locale}::${normalised}`) ?? []
    : collectAllTranslationHits(normalised, registry);

  const merged = dedupe([...direct, ...translationHits]);
  const filtered = applyFilters(merged, filters);
  return applyLimit(filtered, filters.limit);
}

function collectAllTranslationHits(
  normalised: string,
  registry: GlossaryRegistry,
): readonly GlossaryEntry[] {
  const hits: GlossaryEntry[] = [];
  for (const [key, list] of registry.byTranslation.entries()) {
    const [, term] = key.split('::');
    if (term === normalised) hits.push(...list);
  }
  return hits;
}

export function byJurisdiction(
  jurisdiction: Jurisdiction,
  filters: Omit<GlossarySearchFilters, 'jurisdiction'> = {},
  registry: GlossaryRegistry = getDefaultGlossaryRegistry(),
): readonly GlossaryEntry[] {
  const pool = registry.byJurisdiction.get(jurisdiction) ?? [];
  const filtered = applyFilters(pool, filters);
  return applyLimit(filtered, filters.limit);
}

export function byCategory(
  category: GlossaryCategory,
  filters: Omit<GlossarySearchFilters, 'category'> = {},
  registry: GlossaryRegistry = getDefaultGlossaryRegistry(),
): readonly GlossaryEntry[] {
  const pool = registry.byCategory.get(category) ?? [];
  const filtered = applyFilters(pool, filters);
  return applyLimit(filtered, filters.limit);
}

export function translate(
  termId: string,
  locale: Locale,
  registry: GlossaryRegistry = getDefaultGlossaryRegistry(),
): string | undefined {
  const entry = registry.byId.get(termId);
  if (!entry) return undefined;
  const direct = entry.translations[locale];
  if (direct) return direct;
  return entry.translations.en;
}

function applyFilters(
  pool: readonly GlossaryEntry[],
  filters: GlossarySearchFilters,
): readonly GlossaryEntry[] {
  return pool.filter((e) => {
    if (filters.jurisdiction && !e.jurisdictions.includes(filters.jurisdiction)) {
      return false;
    }
    if (filters.category && e.category !== filters.category) {
      return false;
    }
    if (filters.locale && !e.translations[filters.locale]) {
      return false;
    }
    return true;
  });
}

function applyLimit(
  pool: readonly GlossaryEntry[],
  limit: number | undefined,
): readonly GlossaryEntry[] {
  if (!limit || limit <= 0 || limit >= pool.length) return Object.freeze([...pool]);
  return Object.freeze(pool.slice(0, limit));
}

function dedupe(entries: readonly GlossaryEntry[]): readonly GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.termId)) continue;
    seen.add(e.termId);
    out.push(e);
  }
  return out;
}

export interface CoverageReport {
  readonly totalEntries: number;
  readonly byCategory: Readonly<Record<string, number>>;
  readonly byJurisdiction: Readonly<Record<string, number>>;
  readonly translationCoverage: Readonly<Record<Locale, number>>;
  readonly entriesWithCitations: number;
}

export function computeCoverage(
  registry: GlossaryRegistry = getDefaultGlossaryRegistry(),
): CoverageReport {
  const byCategoryCounts: Record<string, number> = {};
  const byJurisdictionCounts: Record<string, number> = {};
  const translationCoverage: Record<Locale, number> = {
    en: 0,
    sw: 0,
    ar: 0,
    fr: 0,
    de: 0,
    ko: 0,
    ja: 0,
    pt: 0,
    es: 0,
    zh: 0,
    hi: 0,
  };
  let entriesWithCitations = 0;

  for (const entry of registry.entries) {
    byCategoryCounts[entry.category] = (byCategoryCounts[entry.category] ?? 0) + 1;
    for (const j of entry.jurisdictions) {
      byJurisdictionCounts[j] = (byJurisdictionCounts[j] ?? 0) + 1;
    }
    for (const [locale, text] of Object.entries(entry.translations) as Array<[Locale, string]>) {
      if (text && text.trim().length > 0) {
        translationCoverage[locale] = (translationCoverage[locale] ?? 0) + 1;
      }
    }
    if (entry.legalCitation) entriesWithCitations += 1;
  }

  return Object.freeze({
    totalEntries: registry.size,
    byCategory: Object.freeze({ ...byCategoryCounts }),
    byJurisdiction: Object.freeze({ ...byJurisdictionCounts }),
    translationCoverage: Object.freeze({ ...translationCoverage }),
    entriesWithCitations,
  });
}
