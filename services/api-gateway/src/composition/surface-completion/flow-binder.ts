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
    /**
     * The worker-surface projection kind. OPTIONAL — only set it to a kind
     * the workforce app can actually render (i.e. a member of the gateway's
     * PROJECTABLE_TAB_KINDS, which is the INTERSECTION with the mobile
     * screen-map). When the worker surface has no renderer for the flow's
     * step (as is the case for the golden inquiry flow today — `inquiry_respond`
     * is NOT projectable to workforce-mobile, asserted by
     * routes/workforce/__tests__/tab-projection.test.ts), leave it UNSET so
     * the binder does not write a `workforceProjection` the worker can never
     * render. Writing one would tell the owner a worker tab materialized that
     * no surface shows — a broken completion promise, not honest-degrade.
     */
    readonly workforceKind?: string;
    readonly buyerKind: string;
    readonly ownerLabel: string;
  };
}

/**
 * The golden flow (slice 1): buyer views a listing → raises an inquiry → a
 * worker task → owner visibility → human-gated response → back to the buyer.
 *
 * The worker draft-response step (GET /inquiries/queue + POST
 * /inquiries/:id/respond) is served on owner-web `/flows` (no workforce-mobile
 * renderer ships for `inquiry_respond` yet), so `workforceKind` is UNSET — the
 * binder must NOT promise a worker tab that no surface renders. The buyer leg
 * (`inquiry_respond` → buyer-mobile `inquiries` screen) IS wired, so
 * `buyerKind` is set.
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
    // workforceKind intentionally unset — see the doc above + FlowSpec.
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

  // 2. Materialize the SINGLE multi-surface projection tab. The config bags
  //    light up the live read legs; the owner sees the row directly. ONE write
  //    → owner + (any surface whose projection kind it actually renders).
  //
  //    HONEST PROJECTION: only write a `workforceProjection` when the flow
  //    declares a worker kind the workforce app can render. The golden inquiry
  //    flow leaves `workforceKind` unset (no workforce-mobile renderer for
  //    `inquiry_respond` ships yet — the draft-response step is served on
  //    owner-web `/flows`), so we do NOT promise a worker tab nothing renders.
  const config: Record<string, unknown> = {
    flowKey: spec.flowKey,
    buyerProjection: { kind: spec.projection.buyerKind },
  };
  if (spec.projection.workforceKind) {
    config.workforceProjection = { kind: spec.projection.workforceKind };
  }
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

  // Report the surfaces that ACTUALLY receive a projected tab from this
  // write: the owner always (the row itself), the buyer when a buyerKind is
  // declared, and the worker ONLY when a workforce-renderable kind is set.
  // The owner-web draft step is part of the owner surface. This keeps the
  // result honest — never claiming a surface lit up a tab nothing renders.
  const projectedSurfaces = new Set<string>(['owner-web']);
  if (spec.projection.buyerKind) projectedSurfaces.add('buyer-mobile');
  if (spec.projection.workforceKind) projectedSurfaces.add('workforce-mobile');

  return {
    flowKey: spec.flowKey,
    structuralTabId: tabId,
    surfaces: [...projectedSurfaces],
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
