/**
 * AOP registry — versioned, append-only catalogue of Agent Operating
 * Procedures.
 *
 * Invariants:
 *   - (id, version) is unique. Re-registering the same pair throws.
 *   - Versions of the same id are kept in insertion order; that is the
 *     `listVersions(id)` traversal order. Most recent = last.
 *   - "Active" is *whichever version is currently flagged active*, not
 *     "the most recent". Activation is a separate call so a regression
 *     failure on the newest version doesn't auto-promote it.
 *   - No mutation: returned specs are the immutable, Zod-frozen values
 *     produced by `parseAOPSpec`.
 *
 * Persistence:
 *   - In-memory by default (`createInMemoryAOPRegistryStore`) — the
 *     follow-up wave wires a Drizzle-backed store via the same
 *     `AOPRegistryStore` port. The runner / canary bridge consume the
 *     registry through this port and don't care where rows live.
 */

import { parseAOPSpec, parseRegressionSet, type AOPSpec, type RegressionSet } from './aop-spec.js';

// ─────────────────────────────────────────────────────────────────────
// Persistence port
// ─────────────────────────────────────────────────────────────────────

export interface AOPRegistryStore {
  /** Persist a new spec. Throws when (id, version) already exists. */
  putSpec(spec: AOPSpec): Promise<void>;
  /** All specs, insertion order — registry hydrates from this once. */
  listSpecs(): Promise<ReadonlyArray<AOPSpec>>;
  /** Persist a regression set; overwrite-on-id is allowed. */
  putRegressionSet(set: RegressionSet): Promise<void>;
  /** All regression sets — registry hydrates from this once. */
  listRegressionSets(): Promise<ReadonlyArray<RegressionSet>>;
  /** Persist the (id → active-version) mapping. */
  putActiveVersion(id: string, version: string | null): Promise<void>;
  /** All active-version rows. */
  listActiveVersions(): Promise<ReadonlyArray<{ readonly id: string; readonly version: string }>>;
}

export function createInMemoryAOPRegistryStore(): AOPRegistryStore {
  const specs: AOPSpec[] = [];
  const sets: RegressionSet[] = [];
  const active = new Map<string, string>();

  return {
    async putSpec(spec) {
      const dup = specs.some((s) => s.id === spec.id && s.version === spec.version);
      if (dup) throw new Error(`aop-registry: duplicate (${spec.id}, ${spec.version})`);
      specs.push(spec);
    },
    async listSpecs() {
      return Object.freeze([...specs]);
    },
    async putRegressionSet(set) {
      const idx = sets.findIndex((s) => s.id === set.id);
      if (idx >= 0) sets[idx] = set;
      else sets.push(set);
    },
    async listRegressionSets() {
      return Object.freeze([...sets]);
    },
    async putActiveVersion(id, version) {
      if (version === null) active.delete(id);
      else active.set(id, version);
    },
    async listActiveVersions() {
      return Object.freeze(
        Array.from(active.entries(), ([id, version]) =>
          Object.freeze({ id, version }),
        ),
      );
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export interface AOPRegistry {
  /**
   * Add a new AOP spec. Throws on duplicate (id, version) or
   * unknown `regressionSetId`. Returns the canonical (frozen) spec.
   */
  registerAOP(spec: unknown): Promise<AOPSpec>;
  /**
   * Add or replace a regression set. Returns the canonical (frozen) set.
   */
  registerRegressionSet(set: unknown): Promise<RegressionSet>;
  /**
   * Look up an AOP. Without `version` returns the currently-active
   * version, or `null` if none is active. With `version` returns that
   * specific row, or `null` if not present.
   */
  getAOP(id: string, version?: string): AOPSpec | null;
  /** Snapshot every spec, insertion order. */
  listAOPs(): ReadonlyArray<AOPSpec>;
  /** Every version of one AOP, oldest → newest. */
  listVersions(id: string): ReadonlyArray<AOPSpec>;
  /** Currently-active version string for an AOP, or null. */
  activeVersion(id: string): string | null;
  /**
   * Flip the active version for an AOP. Throws when (id, version)
   * is not registered. Pass `null` to deactivate the AOP entirely.
   */
  setActiveVersion(id: string, version: string | null): Promise<void>;
  /** Look up a registration set by id. */
  getRegressionSet(id: string): RegressionSet | null;
  /** Force-refresh from the persistence port. */
  refresh(): Promise<void>;
}

export interface CreateAOPRegistryArgs {
  readonly store: AOPRegistryStore;
}

export async function createAOPRegistry(args: CreateAOPRegistryArgs): Promise<AOPRegistry> {
  /** id → versions, in insertion order. */
  const byId = new Map<string, AOPSpec[]>();
  /** "id@version" → spec. Lets `getAOP(id, version)` be O(1). */
  const byPair = new Map<string, AOPSpec>();
  const regressionSets = new Map<string, RegressionSet>();
  const active = new Map<string, string>();

  function pairKey(id: string, version: string): string {
    return `${id}@${version}`;
  }

  function indexSpec(spec: AOPSpec): void {
    const versions = byId.get(spec.id);
    if (versions) versions.push(spec);
    else byId.set(spec.id, [spec]);
    byPair.set(pairKey(spec.id, spec.version), spec);
  }

  async function refresh(): Promise<void> {
    byId.clear();
    byPair.clear();
    regressionSets.clear();
    active.clear();
    const sets = await args.store.listRegressionSets();
    for (const set of sets) regressionSets.set(set.id, set);
    const specs = await args.store.listSpecs();
    for (const spec of specs) indexSpec(spec);
    const actives = await args.store.listActiveVersions();
    for (const row of actives) {
      if (byPair.has(pairKey(row.id, row.version))) active.set(row.id, row.version);
    }
  }

  await refresh();

  return {
    async registerAOP(input) {
      const spec = parseAOPSpec(input);
      if (byPair.has(pairKey(spec.id, spec.version))) {
        throw new Error(`aop-registry: duplicate (${spec.id}, ${spec.version})`);
      }
      if (!regressionSets.has(spec.regressionSetId)) {
        throw new Error(
          `aop-registry: unknown regressionSetId '${spec.regressionSetId}' for ${spec.id}`,
        );
      }
      await args.store.putSpec(spec);
      indexSpec(spec);
      return spec;
    },
    async registerRegressionSet(input) {
      const set = parseRegressionSet(input);
      await args.store.putRegressionSet(set);
      regressionSets.set(set.id, set);
      return set;
    },
    getAOP(id, version) {
      if (version === undefined) {
        const v = active.get(id);
        if (v === undefined) return null;
        return byPair.get(pairKey(id, v)) ?? null;
      }
      return byPair.get(pairKey(id, version)) ?? null;
    },
    listAOPs() {
      const out: AOPSpec[] = [];
      for (const versions of byId.values()) for (const v of versions) out.push(v);
      return Object.freeze(out);
    },
    listVersions(id) {
      const versions = byId.get(id);
      return versions ? Object.freeze([...versions]) : Object.freeze([]);
    },
    activeVersion(id) {
      return active.get(id) ?? null;
    },
    async setActiveVersion(id, version) {
      if (version !== null && !byPair.has(pairKey(id, version))) {
        throw new Error(`aop-registry: cannot activate unknown (${id}, ${version})`);
      }
      await args.store.putActiveVersion(id, version);
      if (version === null) active.delete(id);
      else active.set(id, version);
    },
    getRegressionSet(id) {
      return regressionSets.get(id) ?? null;
    },
    refresh,
  };
}
