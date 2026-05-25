/**
 * Persona registry — runtime hot-swap of persona identities.
 *
 * Phase D D7 — closes the gap where the brain's persona surface map
 * (`identity.ts`) was hard-coded at module load. The registry lets a
 * platform-admin add a new persona, tweak an existing one's opening
 * statement, or retire a persona WITHOUT a deploy. The brain reads
 * `registry.get(name)` on every think() so changes take effect on
 * the next turn.
 *
 * Two layers:
 *
 *   1. In-memory map (fast read path; the brain's hot path).
 *   2. DB-persisted layer (durability; admin tools write here).
 *
 * The registry hydrates the in-memory map from the DB once at boot
 * and refreshes on every write. Tests inject an in-memory persistence
 * adapter; production wires the Drizzle-backed `persona-registry.service`.
 *
 * No mutation: registrations are deep-cloned in/out so callers can
 * safely mutate the returned shape without leaking back into the
 * registry's state.
 */

import type { PersonaIdentity } from '../identity.js';

/**
 * Phase D D7 — persistence port. Implementations:
 *   - production: Drizzle-backed `createPersonaRegistryService(db)`
 *   - test:       in-memory via `createInMemoryPersonaRegistryStore`
 */
export interface PersonaRegistryStore {
  list(): Promise<ReadonlyArray<PersonaIdentity>>;
  upsert(persona: PersonaIdentity): Promise<PersonaIdentity>;
  delete(name: string): Promise<boolean>;
}

export interface PersonaRegistry {
  /** Register (or replace) a persona; persists synchronously to the store. */
  register(persona: PersonaIdentity): Promise<PersonaIdentity>;
  /** Read a persona by id. Returns null when not present. */
  get(name: string): PersonaIdentity | null;
  /** Snapshot all registered personas. */
  list(): ReadonlyArray<PersonaIdentity>;
  /**
   * Patch an existing persona. Throws when the persona id is unknown so
   * admin UIs surface 404 instead of silently creating a new persona.
   */
  update(
    name: string,
    overrides: Partial<Omit<PersonaIdentity, 'id'>>,
  ): Promise<PersonaIdentity>;
  /** Remove a persona. Returns true when a row was removed. */
  delete(name: string): Promise<boolean>;
  /** Force-refresh from the store. */
  refresh(): Promise<void>;
}

export interface CreatePersonaRegistryArgs {
  readonly store: PersonaRegistryStore;
  /** Optional initial in-process seed (defaults applied before hydrate). */
  readonly seed?: ReadonlyArray<PersonaIdentity>;
}

export async function createPersonaRegistry(
  args: CreatePersonaRegistryArgs,
): Promise<PersonaRegistry> {
  const cache = new Map<string, PersonaIdentity>();

  function readClone(p: PersonaIdentity): PersonaIdentity {
    return {
      ...p,
      taboos: [...p.taboos],
      violationSignals: [...p.violationSignals],
    };
  }

  function setCache(p: PersonaIdentity): void {
    cache.set(p.id, readClone(p));
  }

  async function refresh(): Promise<void> {
    cache.clear();
    if (args.seed) for (const s of args.seed) setCache(s);
    const rows = await args.store.list();
    for (const row of rows) setCache(row);
  }

  await refresh();

  return {
    async register(persona) {
      if (!persona.id || typeof persona.id !== 'string') {
        throw new Error('persona-registry.register: id is required');
      }
      const persisted = await args.store.upsert(readClone(persona));
      setCache(persisted);
      return readClone(persisted);
    },
    get(name) {
      const found = cache.get(name);
      return found ? readClone(found) : null;
    },
    list() {
      return [...cache.values()].map(readClone);
    },
    async update(name, overrides) {
      const existing = cache.get(name);
      if (!existing) {
        throw new Error(`persona-registry.update: unknown persona '${name}'`);
      }
      const merged: PersonaIdentity = {
        ...existing,
        ...overrides,
        id: existing.id,
        taboos: overrides.taboos
          ? [...overrides.taboos]
          : [...existing.taboos],
        violationSignals: overrides.violationSignals
          ? [...overrides.violationSignals]
          : [...existing.violationSignals],
      };
      const persisted = await args.store.upsert(merged);
      setCache(persisted);
      return readClone(persisted);
    },
    async delete(name) {
      const removed = await args.store.delete(name);
      if (removed) cache.delete(name);
      return removed;
    },
    refresh,
  };
}

/**
 * In-memory store — used by tests + the degraded composition root
 * (no DB → registry still works locally).
 */
export function createInMemoryPersonaRegistryStore(
  seed: ReadonlyArray<PersonaIdentity> = [],
): PersonaRegistryStore {
  const rows = new Map<string, PersonaIdentity>();
  for (const s of seed) rows.set(s.id, deepClone(s));
  return {
    async list() {
      return [...rows.values()].map(deepClone);
    },
    async upsert(persona) {
      rows.set(persona.id, deepClone(persona));
      return deepClone(persona);
    },
    async delete(name) {
      return rows.delete(name);
    },
  };
}

function deepClone(p: PersonaIdentity): PersonaIdentity {
  return {
    ...p,
    taboos: [...p.taboos],
    violationSignals: [...p.violationSignals],
  };
}
