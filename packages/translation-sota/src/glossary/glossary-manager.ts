/**
 * Glossary manager.
 *
 * Loads + merges three glossary sources in priority order:
 *
 *   1. Tenant overrides   (highest priority — from
 *                          `translation_glossary_overrides` via
 *                          `GlossaryOverrideRepository`).
 *   2. Domain glossary    (Wave-19H Swahili linguistics package,
 *                          consumed through `DomainGlossaryPort`).
 *   3. Seed mining glossary (bundled — `seed-mining-glossary.ts`).
 *
 * Output: a `Glossary` (entries + lookup index keyed by lowercased
 * source term in the given source language). The first match wins —
 * tenant overrides shadow domain entries which shadow seed entries.
 *
 * Pure data assembly; no I/O happens inside `assembleGlossary` itself
 * (the caller awaits the repository + port before passing arrays in).
 */

import type {
  DomainGlossaryPort,
  Glossary,
  GlossaryEntry,
  GlossaryOverrideRepository,
  LanguageCode,
} from '../types.js';
import { SEED_MINING_GLOSSARY } from './seed-mining-glossary.js';

/**
 * Build a `Glossary` snapshot in pure form. Useful for unit tests that
 * want to inject specific entries without going through a repository.
 */
export function assembleGlossary(
  ...sources: ReadonlyArray<ReadonlyArray<GlossaryEntry>>
): Glossary {
  const seen = new Set<string>();
  const entries: GlossaryEntry[] = [];

  for (const source of sources) {
    for (const entry of source) {
      const key = indexKey(entry.srcTerm, entry.srcLang);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push(Object.freeze({ ...entry }));
    }
  }

  const index = new Map<string, GlossaryEntry>();
  for (const entry of entries) {
    index.set(indexKey(entry.srcTerm, entry.srcLang), entry);
  }

  return Object.freeze({
    entries: Object.freeze([...entries]),
    index: index as ReadonlyMap<string, GlossaryEntry>,
  });
}

/**
 * Load the per-tenant glossary by composing the three sources, in
 * priority order. Pure-async — calls the override repo and the domain
 * port concurrently and merges.
 */
export async function loadTenantGlossary(deps: {
  readonly tenantId: string;
  readonly overrideRepo: GlossaryOverrideRepository;
  readonly domainPort?: DomainGlossaryPort | undefined;
}): Promise<Glossary> {
  const [tenantEntries, domainEntries] = await Promise.all([
    deps.overrideRepo.listForTenant(deps.tenantId),
    deps.domainPort !== undefined
      ? deps.domainPort.listEntries()
      : Promise.resolve<ReadonlyArray<GlossaryEntry>>([]),
  ]);

  return assembleGlossary(tenantEntries, domainEntries, SEED_MINING_GLOSSARY);
}

/**
 * Lowercased composite key for the glossary index. The pair
 * `(srcTerm, srcLang)` uniquely identifies an entry for lookup
 * purposes within a single direction.
 */
export function indexKey(srcTerm: string, srcLang: LanguageCode): string {
  return `${srcLang}::${srcTerm.toLowerCase()}`;
}

/**
 * Filter a `Glossary` to only entries translating in the requested
 * direction (e.g. for an SW→EN run we want every entry whose srcLang
 * is `sw` and targetLang is `en`).
 */
export function filterForDirection(
  glossary: Glossary,
  sourceLang: LanguageCode,
  targetLang: LanguageCode,
): Glossary {
  const filtered: GlossaryEntry[] = [];
  const index = new Map<string, GlossaryEntry>();
  for (const entry of glossary.entries) {
    if (entry.srcLang === sourceLang && entry.targetLang === targetLang) {
      filtered.push(entry);
      const key = indexKey(entry.srcTerm, entry.srcLang);
      if (!index.has(key)) {
        index.set(key, entry);
      }
    }
  }
  return Object.freeze({
    entries: Object.freeze([...filtered]),
    index: index as ReadonlyMap<string, GlossaryEntry>,
  });
}
