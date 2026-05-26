/**
 * Adapter repository — in-memory implementation backing the
 * `@borjie/language-self-improve` runner. Mirrors the persistence
 * surface of `language_adapters` (migration 0052).
 *
 * Lifecycle invariants enforced:
 *   - at most one row per (tenant, lang) is in `live` status,
 *   - rolling forward only — `rolled-back` cannot transition back to
 *     `live` without going through `staged` first.
 */

import type { Adapter, AdapterStatus, LanguageTag } from '../types.js';

export interface AdapterRepository {
  upsert(adapter: Adapter): Promise<Adapter>;
  findById(id: string): Promise<Adapter | null>;
  findLive(tenantId: string, lang: LanguageTag): Promise<Adapter | null>;
  listForTenant(
    tenantId: string,
    lang: LanguageTag,
  ): Promise<ReadonlyArray<Adapter>>;
  transition(
    id: string,
    next: AdapterStatus,
  ): Promise<Adapter | null>;
}

export class AdapterTransitionError extends Error {
  public readonly code = 'INVALID_TRANSITION';
  constructor(message: string) {
    super(message);
    this.name = 'AdapterTransitionError';
  }
}

const ALLOWED_TRANSITIONS: Readonly<Record<AdapterStatus, ReadonlyArray<AdapterStatus>>> =
  Object.freeze({
    training: Object.freeze<AdapterStatus[]>(['staged', 'deprecated']),
    staged: Object.freeze<AdapterStatus[]>(['live', 'rolled-back', 'deprecated']),
    live: Object.freeze<AdapterStatus[]>(['rolled-back', 'deprecated']),
    'rolled-back': Object.freeze<AdapterStatus[]>(['staged', 'deprecated']),
    deprecated: Object.freeze<AdapterStatus[]>([]),
  });

export function createInMemoryAdapterRepository(): AdapterRepository {
  let store: ReadonlyMap<string, Adapter> = new Map();

  const repo: AdapterRepository = {
    async upsert(adapter: Adapter): Promise<Adapter> {
      const next = new Map(store);
      const frozen = Object.freeze({ ...adapter });
      next.set(adapter.id, frozen);
      store = next;
      return frozen;
    },

    async findById(id: string): Promise<Adapter | null> {
      return store.get(id) ?? null;
    },

    async findLive(
      tenantId: string,
      lang: LanguageTag,
    ): Promise<Adapter | null> {
      for (const a of store.values()) {
        if (
          a.tenantId === tenantId &&
          a.lang === lang &&
          a.status === 'live'
        ) {
          return a;
        }
      }
      return null;
    },

    async listForTenant(
      tenantId: string,
      lang: LanguageTag,
    ): Promise<ReadonlyArray<Adapter>> {
      const filtered = Array.from(store.values()).filter(
        (a) => a.tenantId === tenantId && a.lang === lang,
      );
      filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return Object.freeze(filtered);
    },

    async transition(
      id: string,
      next: AdapterStatus,
    ): Promise<Adapter | null> {
      const existing = store.get(id);
      if (!existing) {
        return null;
      }
      const allowed = ALLOWED_TRANSITIONS[existing.status];
      if (!allowed.includes(next)) {
        throw new AdapterTransitionError(
          `Invalid transition: ${existing.status} → ${next}`,
        );
      }
      const updated = Object.freeze({ ...existing, status: next });
      const newStore = new Map(store);
      newStore.set(id, updated);
      // If we just promoted to live, demote any sibling live.
      if (next === 'live') {
        for (const [otherId, other] of newStore) {
          if (
            otherId !== id &&
            other.tenantId === existing.tenantId &&
            other.lang === existing.lang &&
            other.status === 'live'
          ) {
            newStore.set(
              otherId,
              Object.freeze({ ...other, status: 'rolled-back' as const }),
            );
          }
        }
      }
      store = newStore;
      return updated;
    },
  };

  return Object.freeze(repo);
}
