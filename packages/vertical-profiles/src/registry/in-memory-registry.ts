/**
 * In-memory vertical-profile registry (Wave VP-1).
 *
 * The registry is the canonical interface every consumer reaches
 * for: list / find / upsert profiles + workflows. The in-memory
 * adapter implements the port for tests and for the boot-time seed
 * loader; a SQL adapter lives in `sql-registry.ts`.
 *
 * Mutation semantics — `upsert` is intentionally idempotent. Re-running
 * the seed loader does NOT throw on existing rows; it overwrites them
 * with the latest declared shape. This is required so a single
 * "seed-on-boot" hook converges to the declared catalogue regardless
 * of prior state.
 *
 * Immutability — every internal mutation produces a fresh frozen
 * snapshot. Consumers never mutate registry state directly. Cf.
 * ~/.claude/rules/coding-style.md.
 *
 * @module @borjie/vertical-profiles/registry/in-memory-registry
 */

import {
  type VerticalProfileDefinition,
  VerticalProfileDefinitionSchema,
  type VerticalWorkflowDefinition,
  VerticalWorkflowDefinitionSchema,
  type RegistryListFilter,
  VerticalProfileError,
} from '../types.js';

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface VerticalProfileRegistry {
  /**
   * List all registered profiles, optionally filtered by status, vertical,
   * or region. Returns a stable copy sorted by id.
   */
  list(
    filter?: RegistryListFilter,
  ): Promise<ReadonlyArray<VerticalProfileDefinition>>;

  /** Find by canonical id; returns null if not found. */
  findById(id: string): Promise<VerticalProfileDefinition | null>;

  /** Find by (vertical, region). Returns null if not found. */
  findByVerticalRegion(
    vertical: string,
    region: string,
  ): Promise<VerticalProfileDefinition | null>;

  /** List workflows for a given profile id. Returns [] if profile has none. */
  workflowsFor(
    profileId: string,
  ): Promise<ReadonlyArray<VerticalWorkflowDefinition>>;

  /**
   * Idempotent upsert of a profile. Validates with zod. If a row
   * with the same id exists it's replaced; otherwise it's inserted.
   */
  upsert(profile: VerticalProfileDefinition): Promise<VerticalProfileDefinition>;

  /**
   * Idempotent upsert of a workflow. Throws WORKFLOW_PROFILE_MISMATCH
   * if `workflow.profileId` doesn't match a registered profile.
   */
  upsertWorkflow(
    workflow: VerticalWorkflowDefinition,
  ): Promise<VerticalWorkflowDefinition>;

  /** Count registered profiles. Used in seed-loader smoke tests. */
  count(): Promise<{ readonly profiles: number; readonly workflows: number }>;
}

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

interface InMemoryState {
  readonly profiles: Map<string, VerticalProfileDefinition>;
  readonly workflows: Map<string, VerticalWorkflowDefinition>;
}

function emptyState(): InMemoryState {
  return Object.freeze({
    profiles: new Map<string, VerticalProfileDefinition>(),
    workflows: new Map<string, VerticalWorkflowDefinition>(),
  });
}

function sortById<T extends { readonly id: string }>(
  rows: ReadonlyArray<T>,
): ReadonlyArray<T> {
  return [...rows].sort((a, b) => a.id.localeCompare(b.id));
}

function matchesFilter(
  profile: VerticalProfileDefinition,
  filter: RegistryListFilter | undefined,
): boolean {
  if (filter === undefined) {
    return true;
  }
  if (filter.status !== undefined && profile.status !== filter.status) {
    return false;
  }
  if (filter.vertical !== undefined && profile.vertical !== filter.vertical) {
    return false;
  }
  if (filter.region !== undefined && profile.region !== filter.region) {
    return false;
  }
  return true;
}

/**
 * Build an in-memory registry adapter. Backed by Maps keyed by id.
 * Returned object is the public port — internal state is encapsulated
 * via closure.
 */
export function createInMemoryRegistry(): VerticalProfileRegistry {
  // eslint-disable-next-line functional/no-let -- closure-encapsulated state
  let state = emptyState();

  async function list(
    filter?: RegistryListFilter,
  ): Promise<ReadonlyArray<VerticalProfileDefinition>> {
    const all = Array.from(state.profiles.values());
    const matched = all.filter((p) => matchesFilter(p, filter));
    return sortById(matched);
  }

  async function findById(
    id: string,
  ): Promise<VerticalProfileDefinition | null> {
    return state.profiles.get(id) ?? null;
  }

  async function findByVerticalRegion(
    vertical: string,
    region: string,
  ): Promise<VerticalProfileDefinition | null> {
    const expected = `${vertical}-${region}`;
    return state.profiles.get(expected) ?? null;
  }

  async function workflowsFor(
    profileId: string,
  ): Promise<ReadonlyArray<VerticalWorkflowDefinition>> {
    const matching: VerticalWorkflowDefinition[] = [];
    for (const w of state.workflows.values()) {
      if (w.profileId === profileId) {
        matching.push(w);
      }
    }
    return sortById(matching);
  }

  async function upsert(
    profile: VerticalProfileDefinition,
  ): Promise<VerticalProfileDefinition> {
    const parseResult = VerticalProfileDefinitionSchema.safeParse(profile);
    if (!parseResult.success) {
      throw new VerticalProfileError(
        `invalid_profile:${parseResult.error.message}`,
        'INVALID_INPUT',
      );
    }
    const parsed = parseResult.data as VerticalProfileDefinition;
    const nextProfiles = new Map(state.profiles);
    nextProfiles.set(parsed.id, parsed);
    state = Object.freeze({
      profiles: nextProfiles,
      workflows: state.workflows,
    });
    return parsed;
  }

  async function upsertWorkflow(
    workflow: VerticalWorkflowDefinition,
  ): Promise<VerticalWorkflowDefinition> {
    const parseResult =
      VerticalWorkflowDefinitionSchema.safeParse(workflow);
    if (!parseResult.success) {
      throw new VerticalProfileError(
        `invalid_workflow:${parseResult.error.message}`,
        'INVALID_INPUT',
      );
    }
    const parsed = parseResult.data as VerticalWorkflowDefinition;
    if (!state.profiles.has(parsed.profileId)) {
      throw new VerticalProfileError(
        `workflow_profile_not_registered:${parsed.profileId}`,
        'WORKFLOW_PROFILE_MISMATCH',
      );
    }
    const expectedPrefix = `${parsed.profileId}.`;
    if (!parsed.id.startsWith(expectedPrefix)) {
      throw new VerticalProfileError(
        `workflow_id_must_be_prefixed_by_profile:${parsed.id}`,
        'INVALID_INPUT',
      );
    }
    const nextWorkflows = new Map(state.workflows);
    nextWorkflows.set(parsed.id, parsed);
    state = Object.freeze({
      profiles: state.profiles,
      workflows: nextWorkflows,
    });
    return parsed;
  }

  async function count(): Promise<{
    readonly profiles: number;
    readonly workflows: number;
  }> {
    return {
      profiles: state.profiles.size,
      workflows: state.workflows.size,
    };
  }

  return Object.freeze({
    list,
    findById,
    findByVerticalRegion,
    workflowsFor,
    upsert,
    upsertWorkflow,
    count,
  });
}
