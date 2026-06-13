/**
 * THE SURFACE-COMPLETION BINDER (business-process compiler, slice 1).
 *
 * The keystone the wider vision needs: given ONE compiled FlowSpec, materialize
 * the complementary tab on EVERY actor's surface at once. It writes a single
 * `owner_tabs_structural` row whose `config` carries BOTH `workforceProjection`
 * and `buyerProjection` bags — which the already-LIVE read legs
 * (routes/workforce/tab-projection.ts + routes/buyer/tab-projection.hono.ts)
 * project onto the worker + buyer surfaces. So one spec → owner control tab +
 * worker queue tab + buyer inquiry tab, in one write. The flow's durable state
 * lives in `flow_runs`.
 *
 * Slice 1 hard-codes the golden "buyer inquiry" FlowSpec (the doc→process-graph
 * extractor is the next increment); the binder itself is generic over a FlowSpec.
 *
 * @module composition/surface-completion/flow-binder
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { businessFlows, ownerTabsStructural } from '@borjie/database';

/** The DB client type the binder writes through (collision-safe). */
type BinderDb = {
  insert: (table: unknown) => any;
  select: () => any;
};

/** An actor in a compiled flow + the surface its tab lands on. */
export interface FlowActor {
  readonly id: string;
  readonly kind: 'owner' | 'worker' | 'buyer';
  readonly surface: 'owner-web' | 'workforce-mobile' | 'buyer-mobile';
}

/** A step in the process graph (state + which actor acts). */
export interface FlowStep {
  readonly id: string;
  readonly state: string;
  readonly actor: string;
  readonly description: string;
  /** Whether this step offers a human-gated automation toggle. */
  readonly automatable?: boolean;
}

/** The compiled process graph extracted from the owner's doc. */
export interface FlowSpec {
  readonly flowKey: string;
  readonly name: string;
  readonly actors: ReadonlyArray<FlowActor>;
  readonly steps: ReadonlyArray<FlowStep>;
  /** The projection kind each surface renders the flow tab as. */
  readonly projection: {
    readonly workforceKind: string;
    readonly buyerKind: string;
    readonly ownerLabel: string;
  };
}

/**
 * The golden flow (slice 1): buyer views a listing → raises an inquiry → a
 * worker task → owner visibility → human-gated response → back to the buyer.
 */
export const GOLDEN_INQUIRY_FLOW: FlowSpec = {
  flowKey: 'buyer_inquiry',
  name: 'Buyer inquiry on a listing',
  actors: [
    { id: 'owner', kind: 'owner', surface: 'owner-web' },
    { id: 'worker', kind: 'worker', surface: 'workforce-mobile' },
    { id: 'buyer', kind: 'buyer', surface: 'buyer-mobile' },
  ],
  steps: [
    { id: 's1', state: 'raised', actor: 'buyer', description: 'Buyer asks about a listing' },
    { id: 's2', state: 'task_assigned', actor: 'worker', description: 'A response task appears in the worker queue' },
    { id: 's3', state: 'awaiting_owner_approval', actor: 'owner', description: 'Owner reviews the drafted response', automatable: true },
    { id: 's4', state: 'delivered', actor: 'buyer', description: 'Response delivered back to the buyer' },
  ],
  projection: {
    workforceKind: 'inquiry_respond',
    buyerKind: 'inquiry_respond',
    ownerLabel: 'Buyer inquiries',
  },
};

export interface InstallFlowDeps {
  /** Tenant-bound drizzle client (the OWNER's context — RLS scopes the write). */
  readonly db: BinderDb;
  readonly tenantId: string;
  readonly ownerUserId: string;
  readonly clock?: () => Date;
}

export interface InstallFlowResult {
  readonly flowKey: string;
  readonly structuralTabId: string;
  readonly surfaces: ReadonlyArray<string>;
}

/**
 * Compile + bind a FlowSpec into the estate: upsert the `business_flows` row and
 * materialize the multi-surface projection tab. Idempotent — safe to call on
 * every install / first activity. Runs under the OWNER's tenant context.
 */
export async function installFlow(
  deps: InstallFlowDeps,
  spec: FlowSpec = GOLDEN_INQUIRY_FLOW,
): Promise<InstallFlowResult> {
  const now = (deps.clock ?? (() => new Date()))();
  const tabId = `flow:${spec.flowKey}`;

  // 1. Persist the compiled spec (the template). Idempotent on (tenant, key).
  await deps.db
    .insert(businessFlows)
    .values({
      id: `bflow_${randomUUID()}`,
      tenantId: deps.tenantId,
      flowKey: spec.flowKey,
      name: spec.name,
      spec: spec as unknown as Record<string, unknown>,
      status: 'active',
      createdBy: deps.ownerUserId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [businessFlows.tenantId, businessFlows.flowKey],
      set: { name: spec.name, spec: spec as unknown as Record<string, unknown>, updatedAt: now },
    });

  // 2. Materialize the SINGLE multi-surface projection tab. The two config bags
  //    light up the live worker + buyer read legs; the owner sees the row
  //    directly. ONE write → three surfaces.
  const config = {
    flowKey: spec.flowKey,
    workforceProjection: { kind: spec.projection.workforceKind },
    buyerProjection: { kind: spec.projection.buyerKind },
  };
  await deps.db
    .insert(ownerTabsStructural)
    .values({
      id: randomUUID(),
      tenantId: deps.tenantId,
      userId: deps.ownerUserId,
      tabId,
      label: spec.projection.ownerLabel,
      position: 0,
      pinned: false,
      kind: 'custom',
      config,
      status: 'active',
      provenance: { via: 'flow-compiler', flowKey: spec.flowKey },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [ownerTabsStructural.tenantId, ownerTabsStructural.userId, ownerTabsStructural.tabId],
      set: { label: spec.projection.ownerLabel, config, status: 'active', updatedAt: now },
    });

  return {
    flowKey: spec.flowKey,
    structuralTabId: tabId,
    surfaces: spec.actors.map((a) => a.surface),
  };
}

/** Has this tenant installed a given flow? (read under tenant context) */
export async function isFlowInstalled(
  db: BinderDb,
  tenantId: string,
  flowKey: string,
): Promise<boolean> {
  const rows = await db
    .select()
    .from(businessFlows)
    .where(and(eq(businessFlows.tenantId, tenantId), eq(businessFlows.flowKey, flowKey)))
    .limit(1);
  return Array.isArray(rows) && rows.length > 0;
}
