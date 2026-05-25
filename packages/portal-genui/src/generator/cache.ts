/**
 * Generator cache — bounded LRU keyed on the intent hash so identical
 * tab-generation requests don't pay the LLM cost twice.
 *
 * Keep tiny on purpose. The cache lives in-process per kernel
 * instance; production composition roots can swap a Redis-backed
 * implementation by satisfying the `GeneratorCache` interface.
 */

import type { GeneratorOrgContext, PortalTab, TabGenerationIntent } from '../types.js';

export interface GeneratorCacheEntry {
  readonly tab: PortalTab;
  readonly storedAt: number;
}

export interface GeneratorCache {
  get(key: string): GeneratorCacheEntry | undefined;
  set(key: string, entry: GeneratorCacheEntry): void;
  size(): number;
}

export function buildCacheKey(
  intent: TabGenerationIntent,
  orgContext: GeneratorOrgContext | undefined,
): string {
  const orgFingerprint =
    orgContext === undefined
      ? '0'
      : JSON.stringify({
          tenantId: orgContext.tenantId ?? null,
          tenantRegion: orgContext.tenantRegion ?? null,
          tenantCurrency: orgContext.tenantCurrency ?? null,
          userPersona: orgContext.userPersona ?? null,
          existingTabCount: orgContext.existingTabKeys?.length ?? 0,
        });
  return [
    intent.domain,
    intent.proposedTabKey,
    intent.proposedTabTitle,
    Math.round(intent.confidence * 100),
    orgFingerprint,
  ].join('|');
}

export function createInMemoryGeneratorCache(
  capacity = 64,
): GeneratorCache {
  const store = new Map<string, GeneratorCacheEntry>();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      // Refresh LRU position.
      store.delete(key);
      store.set(key, entry);
      return entry;
    },
    set(key, entry) {
      if (store.has(key)) store.delete(key);
      store.set(key, entry);
      while (store.size > capacity) {
        const oldest = store.keys().next().value;
        if (oldest === undefined) break;
        store.delete(oldest);
      }
    },
    size() {
      return store.size;
    },
  };
}
