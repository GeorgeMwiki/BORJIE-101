/**
 * In-memory translation cache — for tests and for the build-time
 * prewarmer (the prewarmer can flush its accumulated cache to the
 * Postgres adapter at end-of-build).
 */

import type {
  TranslationCacheKey,
  TranslationCachePort,
  TranslationCacheValue,
} from './types.js';

function serializeKey(k: TranslationCacheKey): string {
  // Pipe-separated; tenantId + sourceLang + targetLang + register + surface
  // come first because they're short. The sourceText is last so the
  // whole string sorts deterministically per-text.
  return [
    k.tenantId,
    k.sourceLang,
    k.targetLang,
    k.register,
    k.surface,
    k.sourceText,
  ].join('||');
}

export interface InMemoryCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
}

export interface InMemoryCache extends TranslationCachePort {
  readonly stats: () => InMemoryCacheStats;
  readonly entries: () => ReadonlyArray<{ key: TranslationCacheKey; value: TranslationCacheValue }>;
  readonly clear: () => void;
}

export function createInMemoryTranslationCache(): InMemoryCache {
  const store = new Map<string, { key: TranslationCacheKey; value: TranslationCacheValue }>();
  let hits = 0;
  let misses = 0;

  return Object.freeze({
    async get(key) {
      const entry = store.get(serializeKey(key));
      if (entry === undefined) {
        misses += 1;
        return null;
      }
      hits += 1;
      return entry.value.targetText;
    },

    async set(key, value) {
      store.set(serializeKey(key), { key, value });
    },

    stats() {
      return Object.freeze({ hits, misses, size: store.size });
    },

    entries() {
      return Array.from(store.values());
    },

    clear() {
      store.clear();
      hits = 0;
      misses = 0;
    },
  });
}
