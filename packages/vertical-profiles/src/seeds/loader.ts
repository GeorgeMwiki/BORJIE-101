/**
 * Seed loader (Wave VP-1).
 *
 * Idempotently registers every reserved profile + every supplied
 * live profile into a `VerticalProfileRegistry`. The live profile
 * collection comes from `@borjie/vertical-profile-mining-tz` (and any
 * future live packages) — the loader takes them as a parameter so
 * the package stays at the bottom of the dependency graph.
 *
 * @module @borjie/vertical-profiles/seeds/loader
 */

import type { VerticalProfileRegistry } from '../registry/in-memory-registry.js';
import type {
  VerticalProfileDefinition,
  VerticalWorkflowDefinition,
} from '../types.js';
import { RESERVED_PROFILES } from './reserved-profiles.js';

export interface SeedBundle {
  readonly profiles: ReadonlyArray<VerticalProfileDefinition>;
  readonly workflows: ReadonlyArray<VerticalWorkflowDefinition>;
}

export interface SeedResult {
  readonly reservedRegistered: number;
  readonly liveRegistered: number;
  readonly workflowsRegistered: number;
}

/**
 * Load the reserved-profile catalogue + any caller-supplied live
 * profiles (and their workflows) into the registry. Idempotent — safe
 * to re-run at every boot.
 */
export async function loadSeedProfiles(
  registry: VerticalProfileRegistry,
  liveBundles: ReadonlyArray<SeedBundle> = [],
): Promise<SeedResult> {
  let reservedRegistered = 0;
  for (const profile of RESERVED_PROFILES) {
    await registry.upsert(profile);
    reservedRegistered += 1;
  }

  let liveRegistered = 0;
  let workflowsRegistered = 0;
  for (const bundle of liveBundles) {
    for (const profile of bundle.profiles) {
      await registry.upsert(profile);
      liveRegistered += 1;
    }
    for (const workflow of bundle.workflows) {
      await registry.upsertWorkflow(workflow);
      workflowsRegistered += 1;
    }
  }

  return Object.freeze({
    reservedRegistered,
    liveRegistered,
    workflowsRegistered,
  });
}
