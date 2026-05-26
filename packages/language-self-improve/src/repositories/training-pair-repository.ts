/**
 * Training-pair repository — in-memory implementation backing the
 * `@borjie/language-self-improve` runner. Mirrors the persistence
 * surface of `language_training_pairs` (migration 0052).
 *
 * Every method returns fresh frozen objects. Repository state is held
 * in an immutable Map; updates produce a new Map rather than mutating
 * the existing one (immutability rule).
 */

import type { LanguageTag, TrainingPair } from '../types.js';

export interface TrainingPairRepository {
  upsert(pair: TrainingPair): Promise<TrainingPair>;
  findById(id: string): Promise<TrainingPair | null>;
  listForTenant(
    tenantId: string,
    lang: LanguageTag,
    options?: { readonly onlyIncluded?: boolean; readonly limit?: number },
  ): Promise<ReadonlyArray<TrainingPair>>;
  countForTenant(tenantId: string, lang: LanguageTag): Promise<number>;
}

export function createInMemoryTrainingPairRepository(): TrainingPairRepository {
  let store: ReadonlyMap<string, TrainingPair> = new Map();

  const repo: TrainingPairRepository = {
    async upsert(pair: TrainingPair): Promise<TrainingPair> {
      const next = new Map(store);
      const frozen = Object.freeze({ ...pair });
      next.set(pair.id, frozen);
      store = next;
      return frozen;
    },

    async findById(id: string): Promise<TrainingPair | null> {
      return store.get(id) ?? null;
    },

    async listForTenant(
      tenantId: string,
      lang: LanguageTag,
      options?: { readonly onlyIncluded?: boolean; readonly limit?: number },
    ): Promise<ReadonlyArray<TrainingPair>> {
      const filtered = Array.from(store.values()).filter((p) => {
        if (p.tenantId !== tenantId) return false;
        if (p.lang !== lang) return false;
        if (options?.onlyIncluded === true && !p.included) return false;
        return true;
      });
      filtered.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
      const sliced =
        options?.limit !== undefined ? filtered.slice(0, options.limit) : filtered;
      return Object.freeze(sliced);
    },

    async countForTenant(
      tenantId: string,
      lang: LanguageTag,
    ): Promise<number> {
      let count = 0;
      for (const p of store.values()) {
        if (p.tenantId === tenantId && p.lang === lang && p.included) {
          count++;
        }
      }
      return count;
    },
  };

  return Object.freeze(repo);
}
