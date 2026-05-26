/**
 * GauntletEntry repository — in-memory implementation backing the
 * `@borjie/language-self-improve` runner. Mirrors the persistence
 * surface of `language_gauntlet_entries` (migration 0052).
 *
 * UNIQUE(tenant_id, lang, prompt) is enforced — a second insert with
 * the same triple throws `GauntletEntryDuplicateError`.
 */

import type { GauntletEntry, LanguageTag } from '../types.js';

export class GauntletEntryDuplicateError extends Error {
  public readonly code = 'DUPLICATE_PROMPT';
  constructor(message: string) {
    super(message);
    this.name = 'GauntletEntryDuplicateError';
  }
}

export interface GauntletEntryRepository {
  insert(entry: GauntletEntry): Promise<GauntletEntry>;
  findById(id: string): Promise<GauntletEntry | null>;
  listForTenant(
    tenantId: string,
    lang: LanguageTag,
  ): Promise<ReadonlyArray<GauntletEntry>>;
}

function uniqueKey(tenantId: string, lang: LanguageTag, prompt: string): string {
  return `${tenantId}|${lang}|${prompt}`;
}

export function createInMemoryGauntletEntryRepository(): GauntletEntryRepository {
  let store: ReadonlyMap<string, GauntletEntry> = new Map();
  let uniqueIndex: ReadonlyMap<string, string> = new Map();

  const repo: GauntletEntryRepository = {
    async insert(entry: GauntletEntry): Promise<GauntletEntry> {
      const key = uniqueKey(entry.tenantId, entry.lang, entry.prompt);
      if (uniqueIndex.has(key)) {
        throw new GauntletEntryDuplicateError(
          `Duplicate gauntlet entry for tenant=${entry.tenantId}, lang=${entry.lang}`,
        );
      }
      const newStore = new Map(store);
      const frozen = Object.freeze({ ...entry });
      newStore.set(entry.id, frozen);
      const newIndex = new Map(uniqueIndex);
      newIndex.set(key, entry.id);
      store = newStore;
      uniqueIndex = newIndex;
      return frozen;
    },

    async findById(id: string): Promise<GauntletEntry | null> {
      return store.get(id) ?? null;
    },

    async listForTenant(
      tenantId: string,
      lang: LanguageTag,
    ): Promise<ReadonlyArray<GauntletEntry>> {
      const filtered = Array.from(store.values()).filter(
        (e) => e.tenantId === tenantId && e.lang === lang,
      );
      filtered.sort((a, b) => a.id.localeCompare(b.id));
      return Object.freeze(filtered);
    },
  };

  return Object.freeze(repo);
}
