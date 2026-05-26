/**
 * Atomic capability seeds (Wave CAPABILITY).
 *
 * The platform ships five atomic capabilities. Each maps to one
 * underlying engine in the existing repo. Their contracts are defined
 * here so the registry has a single source of truth at boot time.
 *
 * Atomics are leaves — their `dependencies` array is empty. They are
 * always `kind = 'atomic'` and `provenanceClass = 'seed'` and live
 * under the sentinel tenant id `'__seed__'`.
 *
 * Spec: `Docs/DESIGN/CAPABILITY_CATALOGUE_SPEC.md §3`.
 *
 * @module @borjie/capability-catalogue/seeds/atomic-capabilities
 */

import { z } from 'zod';

import type { CapabilityRegistry } from '../registry/registry.js';
import {
  type Capability,
  type CapabilityAuthorInput,
  SEED_TENANT_ID,
} from '../types.js';

// ---------------------------------------------------------------------------
// Contract zod schemas — exposed for runtime validation at dispatch time
// ---------------------------------------------------------------------------

export const ResearchInputSchema = z.object({
  query: z.string().min(1),
  mode: z
    .enum(['reactive', 'anticipatory', 'briefing', 'deep', 'watch'])
    .optional(),
  maxCostCents: z.number().int().nonnegative().optional(),
});

export const ResearchOutputSchema = z.object({
  answer: z.string(),
  citations: z.array(z.unknown()),
  confidence: z.enum(['high', 'medium', 'low', 'refused']),
});

export const ComposeTabInputSchema = z.object({
  intent: z.string().min(1),
  dataJoinRefs: z.array(z.unknown()),
  replayKey: z.string().optional(),
});

export const ComposeTabOutputSchema = z.object({
  tabRecipe: z.unknown(),
  replayKey: z.string(),
});

export const ComposeDocInputSchema = z.object({
  templateKind: z.enum([
    'tumemadini',
    'board_pack',
    'royalty',
    'eia',
    'safety_brief',
    'general',
  ]),
  scope: z.object({
    tenantId: z.string(),
    siteId: z.string().optional(),
    accountingMonth: z.string().optional(),
  }),
  format: z.enum(['pdf', 'docx']),
});

export const ComposeDocOutputSchema = z.object({
  storageKey: z.string(),
  sha256: z.string(),
  citations: z.array(z.unknown()),
});

export const ComposeMediaInputSchema = z.object({
  brief: z.string().min(1),
  channel: z.enum(['whatsapp', 'sms', 'social', 'print']),
  constraints: z.unknown().optional(),
});

export const ComposeMediaOutputSchema = z.object({
  assetRefs: z.array(z.unknown()),
  approvedForChannel: z.boolean(),
});

export const ComposeCampaignInputSchema = z.object({
  objective: z.string().min(1),
  audience: z.unknown(),
  channelMix: z.unknown(),
  scheduleWindow: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }),
});

export const ComposeCampaignOutputSchema = z.object({
  campaignId: z.string(),
  steps: z.array(z.unknown()),
  expectedReach: z.number().nonnegative(),
});

// ---------------------------------------------------------------------------
// Seed author-inputs — fed straight into `registry.author()`
// ---------------------------------------------------------------------------

export const ATOMIC_CAPABILITY_SEEDS: ReadonlyArray<CapabilityAuthorInput> =
  Object.freeze([
    {
      tenantId: SEED_TENANT_ID,
      name: 'research_v1',
      version: '1.0.0',
      kind: 'atomic',
      owner: 'platform',
      dependencies: [],
      contract: {
        inputSchema: ResearchInputSchema,
        outputSchema: ResearchOutputSchema,
        costClass: 'tier_1',
        latencyBudgetMs: 8_000,
      },
      provenanceClass: 'seed',
    },
    {
      tenantId: SEED_TENANT_ID,
      name: 'compose_tab_v1',
      version: '1.0.0',
      kind: 'atomic',
      owner: 'platform',
      dependencies: [],
      contract: {
        inputSchema: ComposeTabInputSchema,
        outputSchema: ComposeTabOutputSchema,
        costClass: 'tier_1',
        latencyBudgetMs: 6_000,
      },
      provenanceClass: 'seed',
    },
    {
      tenantId: SEED_TENANT_ID,
      name: 'compose_doc_v1',
      version: '1.0.0',
      kind: 'atomic',
      owner: 'platform',
      dependencies: [],
      contract: {
        inputSchema: ComposeDocInputSchema,
        outputSchema: ComposeDocOutputSchema,
        costClass: 'tier_2',
        latencyBudgetMs: 30_000,
      },
      provenanceClass: 'seed',
    },
    {
      tenantId: SEED_TENANT_ID,
      name: 'compose_media_v1',
      version: '1.0.0',
      kind: 'atomic',
      owner: 'platform',
      dependencies: [],
      contract: {
        inputSchema: ComposeMediaInputSchema,
        outputSchema: ComposeMediaOutputSchema,
        costClass: 'tier_2',
        latencyBudgetMs: 45_000,
      },
      provenanceClass: 'seed',
    },
    {
      tenantId: SEED_TENANT_ID,
      name: 'compose_campaign_v1',
      version: '1.0.0',
      kind: 'atomic',
      owner: 'platform',
      dependencies: [],
      contract: {
        inputSchema: ComposeCampaignInputSchema,
        outputSchema: ComposeCampaignOutputSchema,
        costClass: 'tier_3',
        latencyBudgetMs: 60_000,
      },
      provenanceClass: 'seed',
    },
  ]);

/**
 * Register all five atomic capabilities into a registry. Idempotent —
 * if a seed already exists with the same (tenantId, name, version) the
 * existing row is returned instead of failing.
 */
export async function registerAtomicCapabilities(
  registry: CapabilityRegistry,
): Promise<ReadonlyArray<Capability>> {
  const out: Array<Capability> = [];
  for (const seed of ATOMIC_CAPABILITY_SEEDS) {
    const existing = await registry.findByName({
      tenantId: seed.tenantId,
      name: seed.name,
      version: seed.version,
    });
    if (existing !== null) {
      out.push(existing);
      continue;
    }
    const row = await registry.author(seed);
    out.push(row);
  }
  return Object.freeze(out);
}
