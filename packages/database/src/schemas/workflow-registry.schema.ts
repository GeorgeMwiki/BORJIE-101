/**
 * Workflow registry — the persisted, embeddable flow catalog the modality
 * arbiter (COG-07/AUT-14) retrieves over.
 *
 * Until this table existed, flows lived ONLY as a static in-code array
 * (`packages/ai-copilot/src/workflows/workflow-registry.ts` +
 * `workflow-engine` `BUILT_IN_WORKFLOW_DEFINITIONS`), selectable solely by
 * explicit `getWorkflow(id)`. The arbiter's Tier-1 nearest-neighbour needs
 * a `trigger_embedding` to cosine-match a turn intent against a flow's
 * trigger description — so this table introduces the durable catalog with:
 *
 *   - `trigger_description`  NL document an embedder can vectorise
 *   - `trigger_embedding`    1536-dim pgvector for `<=>` cosine retrieval
 *   - `loop_kind`            NULL ⇒ a bounded workflow (workflow-engine);
 *                            set ⇒ a STANDING loop routed to the loop-runner
 *                            (reactive | tab_tick | deep_research |
 *                            autonomous_24_7 | recipe_lifecycle).
 *   - `status`               'active' | 'retired' | 'shadow' (mirrors
 *                            skill_registry); only `active` flows are
 *                            SELECTABLE by the arbiter.
 *   - `source`               'built_in' | 'authored' | 'discovered' — how
 *                            the flow def was produced (hand-written,
 *                            recipe-authored, or AFlow-discovered).
 *
 * `tenant_id IS NULL` ⇒ a GLOBAL flow (cross-tenant default, the same
 * pattern as global skills / corpus chunks). Per-tenant flows are scoped
 * via the foreign-key reference. RLS is FORCE-enabled (migration 0316).
 *
 * Drizzle has no native pgvector type; the column is modeled with the same
 * `customType` wrapper as `skill-registry.schema.ts`. The underlying
 * Postgres column is `VECTOR(1536)`.
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
  customType,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

const vector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    const dims = config?.dimensions ?? 1536;
    return `vector(${dims})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    if (!value || typeof value !== 'string') return [];
    const trimmed = value.replace(/^\[/, '').replace(/\]$/, '');
    if (!trimmed) return [];
    return trimmed
      .split(',')
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
  },
});

export const workflowRegistry = pgTable(
  'workflow_registry',
  {
    id: text('id').primaryKey(),
    /** NULL => global flow (shared across tenants). */
    tenantId: text('tenant_id').references(() => tenants.id, {
      onDelete: 'cascade',
    }),
    /** Stable flow identifier the workflow-engine / loop-runner dispatches. */
    flowId: text('flow_id').notNull(),
    name: text('name').notNull(),
    /** NL trigger document — the embedding-keyed retrieval text. */
    triggerDescription: text('trigger_description').notNull(),
    /**
     * Optional embedding (text-embedding-3-small, 1536 dims) of the
     * `trigger_description`. Populated by the embedder. The arbiter filters
     * NULLs so an un-embedded flow is selectable only by explicit id
     * (current behaviour preserved).
     */
    triggerEmbedding: vector('trigger_embedding', { dimensions: 1536 }),
    /**
     * NULL ⇒ bounded multi-step workflow (workflow-engine). Otherwise the
     * standing loop kind routed to `@borjie/loop-runner`.
     */
    loopKind: text('loop_kind'),
    /** 'built_in' | 'authored' | 'discovered'. */
    source: text('source').notNull().default('built_in'),
    /** 'active' | 'retired' | 'shadow'. Only 'active' is selectable. */
    status: text('status').notNull().default('active'),
    /** Opaque flow definition (steps / params) the engine replays. */
    definition: jsonb('definition'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('idx_workflow_registry_tenant_status').on(
      t.tenantId,
      t.status,
    ),
    tenantFlowIdx: index('idx_workflow_registry_tenant_flow').on(
      t.tenantId,
      t.flowId,
    ),
  }),
);

export type WorkflowRegistryRow = typeof workflowRegistry.$inferSelect;
export type NewWorkflowRegistryRow = typeof workflowRegistry.$inferInsert;
