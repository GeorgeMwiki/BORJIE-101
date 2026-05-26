/**
 * Meta-capability seeds (Wave CAPABILITY).
 *
 * The platform ships one meta-dispatcher capability:
 *
 *   compose_anything_v1 — accepts a free-form intent, plans a DAG of
 *                          atomic-capability invocations, executes the
 *                          plan, and emits an aggregated result.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §4`.
 *
 * @module @borjie/capability-catalogue/seeds/meta-capabilities
 */

import { z } from 'zod';

import type { CapabilityRegistry } from '../registry/registry.js';
import {
  type Capability,
  CapabilityCatalogueError,
  SEED_TENANT_ID,
} from '../types.js';
import { ATOMIC_CAPABILITY_SEEDS } from './atomic-capabilities.js';

// ---------------------------------------------------------------------------
// Contract schemas
// ---------------------------------------------------------------------------

export const ComposeAnythingInputSchema = z.object({
  intent: z.string().min(1),
  scope: z
    .object({
      tenantId: z.string(),
      siteId: z.string().optional(),
      accountingMonth: z.string().optional(),
    })
    .optional(),
  maxCostCents: z.number().int().nonnegative().optional(),
});

export const ComposeAnythingPlanStepSchema = z.object({
  capabilityId: z.string().uuid(),
  capabilityName: z.string(),
  input: z.unknown(),
  /** Step ids this step depends on (DAG edges). */
  dependsOn: z.array(z.string()),
});

export const ComposeAnythingOutputSchema = z.object({
  resultKind: z.enum(['research', 'tab', 'doc', 'media', 'campaign', 'composite']),
  plan: z.array(ComposeAnythingPlanStepSchema),
  result: z.unknown(),
  citations: z.array(z.unknown()),
  costUsdCents: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Author + register
// ---------------------------------------------------------------------------

export const META_CAPABILITY_NAME = 'compose_anything_v1';
export const META_CAPABILITY_VERSION = '1.0.0';

/**
 * Register the `compose_anything_v1` meta-dispatcher. Must be invoked
 * **after** the five atomic capabilities so that the dependencies array
 * can resolve to their ids.
 *
 * @throws CapabilityCatalogueError when fewer than five atomic
 *         capabilities are present in the registry under the seed tenant.
 */
export async function registerMetaCapabilities(
  registry: CapabilityRegistry,
): Promise<Capability> {
  // Resolve the five atomic capability ids.
  const dependencyIds: Array<string> = [];
  for (const seed of ATOMIC_CAPABILITY_SEEDS) {
    const row = await registry.findByName({
      tenantId: SEED_TENANT_ID,
      name: seed.name,
      version: seed.version,
    });
    if (!row) {
      throw new CapabilityCatalogueError(
        `meta-capability ${META_CAPABILITY_NAME} requires ${seed.name} but it is not registered`,
        'INVALID_DEPENDENCY',
      );
    }
    dependencyIds.push(row.id);
  }

  const existing = await registry.findByName({
    tenantId: SEED_TENANT_ID,
    name: META_CAPABILITY_NAME,
    version: META_CAPABILITY_VERSION,
  });
  if (existing !== null) return existing;

  return registry.author({
    tenantId: SEED_TENANT_ID,
    name: META_CAPABILITY_NAME,
    version: META_CAPABILITY_VERSION,
    kind: 'meta',
    owner: 'platform',
    dependencies: dependencyIds,
    contract: {
      inputSchema: ComposeAnythingInputSchema,
      outputSchema: ComposeAnythingOutputSchema,
      costClass: 'tier_3',
      latencyBudgetMs: 90_000,
    },
    provenanceClass: 'seed',
  });
}

/**
 * Convenience: register all seeds (atomics + meta) in the correct order.
 */
export async function registerAllSeeds(
  registry: CapabilityRegistry,
  registerAtomics: (
    r: CapabilityRegistry,
  ) => Promise<ReadonlyArray<Capability>>,
): Promise<{
  readonly atomics: ReadonlyArray<Capability>;
  readonly meta: Capability;
}> {
  const atomics = await registerAtomics(registry);
  const meta = await registerMetaCapabilities(registry);
  return { atomics, meta };
}
