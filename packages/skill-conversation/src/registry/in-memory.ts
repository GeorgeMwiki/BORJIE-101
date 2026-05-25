/**
 * In-memory implementation of `SkillRegistry`.
 *
 * Production wires a SQL adapter against `skill_registry` + `skill_history`.
 * Tests + the chat-handoff demo path use this in-memory store — it is fast,
 * deterministic, and respects the immutable-update contract (each patch
 * yields a new entry; the map holds the latest only).
 */

import type {
  SkillRegistry,
  SkillRegistryEntry,
  SkillScope,
} from '../types.js';

export class InMemorySkillRegistry implements SkillRegistry {
  // Backing store. Reading callers get the frozen value; writers replace
  // the slot atomically.
  readonly #byId = new Map<string, SkillRegistryEntry>();

  async save(entry: SkillRegistryEntry): Promise<void> {
    if (this.#byId.has(entry.id)) {
      throw new Error(`SkillRegistry: duplicate id "${entry.id}"`);
    }
    this.#byId.set(entry.id, deepFreeze(entry));
  }

  async load(id: string): Promise<SkillRegistryEntry | null> {
    return this.#byId.get(id) ?? null;
  }

  async listByOwner(args: {
    readonly scope: SkillScope;
    readonly tenantId: string | null;
  }): Promise<ReadonlyArray<SkillRegistryEntry>> {
    const results: SkillRegistryEntry[] = [];
    for (const entry of this.#byId.values()) {
      if (entry.lifecycle === 'deleted') continue;
      if (entry.scope !== args.scope) continue;
      // Internal-admin can see both tenant-scoped admin skills and
      // platform-wide ones (tenantId === null). Owner-customer is strict.
      if (args.scope === 'owner-customer') {
        if (entry.tenantId !== args.tenantId) continue;
      } else {
        if (args.tenantId !== null && entry.tenantId !== null && entry.tenantId !== args.tenantId) {
          continue;
        }
      }
      results.push(entry);
    }
    return Object.freeze(results);
  }

  async update(
    id: string,
    patch: (entry: SkillRegistryEntry) => SkillRegistryEntry,
  ): Promise<SkillRegistryEntry | null> {
    const existing = this.#byId.get(id);
    if (existing === undefined) return null;
    const next = deepFreeze(patch(existing));
    if (next.id !== existing.id) {
      throw new Error(`SkillRegistry.update: patch must not change id (was ${existing.id}, became ${next.id})`);
    }
    this.#byId.set(id, next);
    return next;
  }

  /** Test helper — total row count (including deleted). */
  size(): number {
    return this.#byId.size;
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const key of Object.keys(value as object)) {
    const inner = (value as Record<string, unknown>)[key];
    if (typeof inner === 'object' && inner !== null && !Object.isFrozen(inner)) {
      deepFreeze(inner);
    }
  }
  return Object.freeze(value);
}
