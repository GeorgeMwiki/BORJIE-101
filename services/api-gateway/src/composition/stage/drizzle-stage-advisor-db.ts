/**
 * Drizzle-backed `StageAdvisorDb` for `@borjie/stage-advisor`.
 *
 * Implements the package's `StageAdvisorDb` port against the durable
 * `stage_advisor_*` tables (migration 0295), so the stage-aware capability
 * advisor (seven-stage lifecycle classifier with hysteresis, onboarding
 * playbooks, capability gating, proactive nudges + transition history) runs on
 * REAL persisted rows instead of the in-memory dev store. Once this adapter is
 * bound in the composition root, `/api/v1/stage` resolves a live
 * `services.stageAdvisor` instead of returning 503 SERVICE_UNAVAILABLE.
 *
 * Tenant isolation is enforced in TWO layers:
 *   1. RLS — every `stage_advisor_*` table FORCE-enables row-level security on
 *      the canonical `app.current_tenant_id` GUC, bound per request by
 *      databaseMiddleware.
 *   2. Defence-in-depth — every read ALSO filters by the caller-supplied
 *      `tenantId`, and every write carries `tenantId` on the row.
 *
 * Snapshot tables (metrics / org-state / persisted state) are one-row-per-tenant
 * and upserted last-write-wins. The two history tables (nudge deliveries +
 * transitions) are APPEND-ONLY: their writers only ever INSERT; dismissals are a
 * sticky upsert keyed by (tenant, nudge).
 *
 * The Drizzle client is typed `DrizzleLike` (`any`) at the seam: the fluent
 * builder generics cannot be reproduced through the `@borjie/database` barrel
 * without tripping TS2709 (see `procurement/drizzle-data-port.ts` and
 * `ai-native/drizzle-repos.ts` for the rationale). Every row is mapped through
 * an explicit converter, so callers stay typed.
 *
 * No `console.log` — failures propagate to the route's error envelope.
 */

import { and, desc, eq } from 'drizzle-orm';
import {
  stageAdvisorMetrics,
  stageAdvisorOrgState,
  stageAdvisorState,
  stageAdvisorNudges,
  stageAdvisorNudgeDismissals,
  stageAdvisorTransitions,
} from '@borjie/database';
import type {
  StageAdvisorDb,
  NudgeDeliveryRecord,
  OrgMetrics,
  OrgStage,
  OrgState,
  PersistedStageState,
  StageTransition,
  TransitionKind,
} from '@borjie/stage-advisor';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as unknown[]).map(String) : [];
}

/** Map a `stage_advisor_metrics` row → the package `OrgMetrics` shape. */
function rowToMetrics(row: Record<string, unknown>): OrgMetrics {
  return {
    tenantId: String(row.tenantId),
    unitsManaged: Number(row.unitsManaged ?? 0),
    activeUsers: Number(row.activeUsers ?? 0),
    // Stored as INTEGER minor-units; the package treats `monthlyRevenue` as an
    // opaque non-negative magnitude (used only as `> 0` + in evidence strings).
    monthlyRevenue: Number(row.monthlyRevenueCents ?? 0),
    currency: String(row.currency ?? 'TZS'),
    ageMonths: Number(row.ageMonths ?? 0),
    regionCount: Number(row.regionCount ?? 0),
    tenantChurnRate: Number(row.tenantChurnRate ?? 0),
    observedAt: toIso(row.observedAt),
  };
}

/** Map a `stage_advisor_org_state` row → the package `OrgState` shape. */
function rowToOrgState(row: Record<string, unknown>): OrgState {
  const extra = row.extra;
  const base: OrgState = {
    tenantId: String(row.tenantId),
    orgSetupComplete: Boolean(row.orgSetupComplete),
    propertyCount: Number(row.propertyCount ?? 0),
    unitsManaged: Number(row.unitsManaged ?? 0),
    leaseCount: Number(row.leaseCount ?? 0),
    paymentMethodsConfigured: Number(row.paymentMethodsConfigured ?? 0),
    maintenanceCategoriesDefined: Number(row.maintenanceCategoriesDefined ?? 0),
    scheduledInspectionsConfigured: Number(
      row.scheduledInspectionsConfigured ?? 0,
    ),
    vendorCount: Number(row.vendorCount ?? 0),
    inventoryLocationsCount: Number(row.inventoryLocationsCount ?? 0),
    rfqCount: Number(row.rfqCount ?? 0),
    fleetVehicleCount: Number(row.fleetVehicleCount ?? 0),
    reportCadenceCount: Number(row.reportCadenceCount ?? 0),
    regionsConfigured: Number(row.regionsConfigured ?? 0),
    treasuryAccountCount: Number(row.treasuryAccountCount ?? 0),
    jurisdictionsConfigured: Number(row.jurisdictionsConfigured ?? 0),
  };
  return extra && typeof extra === 'object' && Object.keys(extra).length > 0
    ? {
        ...base,
        extra: extra as Readonly<Record<string, number | string | boolean>>,
      }
    : base;
}

/** Map a `stage_advisor_state` row → the package `PersistedStageState`. */
function rowToPersistedState(
  row: Record<string, unknown>,
): PersistedStageState {
  return {
    tenantId: String(row.tenantId),
    currentStage: String(row.currentStage) as OrgStage,
    currentStageSince: toIso(row.currentStageSince),
    candidateStage:
      row.candidateStage != null
        ? (String(row.candidateStage) as OrgStage)
        : null,
    candidateStageSince: toIsoOrNull(row.candidateStageSince),
  };
}

/** Map a `stage_advisor_transitions` row → the package `StageTransition`. */
function rowToTransition(row: Record<string, unknown>): StageTransition {
  return {
    from: String(row.fromStage) as OrgStage,
    to: String(row.toStage) as OrgStage,
    kind: String(row.kind) as TransitionKind,
    introductionMessage: String(row.introductionMessage ?? ''),
    recommendedNextSteps: toStringArray(row.recommendedNextSteps),
    capabilitiesToUnlock: toStringArray(
      row.capabilitiesToUnlock,
    ) as StageTransition['capabilitiesToUnlock'],
    capabilitiesToReview: toStringArray(
      row.capabilitiesToReview,
    ) as StageTransition['capabilitiesToReview'],
  };
}

/**
 * Build a Drizzle-backed `StageAdvisorDb` bound to the request's RLS-pinned
 * client. Construct one per request inside the route handler, OR bind a single
 * instance against the shared client at composition time (the registry path) —
 * RLS + the per-call tenantId filter keep both modes tenant-safe.
 */
export function createDrizzleStageAdvisorDb(db: DrizzleLike): StageAdvisorDb {
  return {
    getMetrics: async (tenantId: string): Promise<OrgMetrics | null> => {
      const rows = await db
        .select()
        .from(stageAdvisorMetrics)
        .where(eq(stageAdvisorMetrics.tenantId, tenantId))
        .limit(1);
      const row = (rows as Array<Record<string, unknown>>)[0];
      return row ? rowToMetrics(row) : null;
    },

    getOrgState: async (tenantId: string): Promise<OrgState | null> => {
      const rows = await db
        .select()
        .from(stageAdvisorOrgState)
        .where(eq(stageAdvisorOrgState.tenantId, tenantId))
        .limit(1);
      const row = (rows as Array<Record<string, unknown>>)[0];
      return row ? rowToOrgState(row) : null;
    },

    getPersistedState: async (
      tenantId: string,
    ): Promise<PersistedStageState | null> => {
      const rows = await db
        .select()
        .from(stageAdvisorState)
        .where(eq(stageAdvisorState.tenantId, tenantId))
        .limit(1);
      const row = (rows as Array<Record<string, unknown>>)[0];
      return row ? rowToPersistedState(row) : null;
    },

    savePersistedState: async (
      state: PersistedStageState,
    ): Promise<void> => {
      const now = new Date();
      const values = {
        tenantId: state.tenantId,
        currentStage: state.currentStage,
        currentStageSince: new Date(state.currentStageSince),
        candidateStage: state.candidateStage ?? null,
        candidateStageSince: state.candidateStageSince
          ? new Date(state.candidateStageSince)
          : null,
        updatedAt: now,
      };
      await db
        .insert(stageAdvisorState)
        .values(values)
        .onConflictDoUpdate({
          target: stageAdvisorState.tenantId,
          set: {
            currentStage: values.currentStage,
            currentStageSince: values.currentStageSince,
            candidateStage: values.candidateStage,
            candidateStageSince: values.candidateStageSince,
            updatedAt: values.updatedAt,
          },
        });
    },

    getNudgeHistory: async (
      tenantId: string,
    ): Promise<ReadonlyArray<NudgeDeliveryRecord>> => {
      const rows = await db
        .select()
        .from(stageAdvisorNudges)
        .where(eq(stageAdvisorNudges.tenantId, tenantId))
        .orderBy(desc(stageAdvisorNudges.deliveredAt));
      return (rows as Array<Record<string, unknown>>).map((row) => ({
        nudgeId: String(row.nudgeId),
        deliveredAt: toIso(row.deliveredAt),
      }));
    },

    // Append-only — INSERT only, never update/delete a prior delivery record.
    recordNudgeDelivery: async (args: {
      tenantId: string;
      record: NudgeDeliveryRecord;
    }): Promise<void> => {
      await db.insert(stageAdvisorNudges).values({
        tenantId: args.tenantId,
        nudgeId: args.record.nudgeId,
        deliveredAt: new Date(args.record.deliveredAt),
      });
    },

    isNudgeDismissed: async (
      tenantId: string,
      nudgeId: string,
    ): Promise<boolean> => {
      const rows = await db
        .select({ nudgeId: stageAdvisorNudgeDismissals.nudgeId })
        .from(stageAdvisorNudgeDismissals)
        .where(
          and(
            eq(stageAdvisorNudgeDismissals.tenantId, tenantId),
            eq(stageAdvisorNudgeDismissals.nudgeId, nudgeId),
          ),
        )
        .limit(1);
      return (rows as Array<unknown>).length > 0;
    },

    dismissNudge: async (args: {
      tenantId: string;
      nudgeId: string;
    }): Promise<void> => {
      await db
        .insert(stageAdvisorNudgeDismissals)
        .values({
          tenantId: args.tenantId,
          nudgeId: args.nudgeId,
          dismissedAt: new Date(),
        })
        .onConflictDoNothing({
          target: [
            stageAdvisorNudgeDismissals.tenantId,
            stageAdvisorNudgeDismissals.nudgeId,
          ],
        });
    },

    getTransitionHistory: async (
      tenantId: string,
    ): Promise<ReadonlyArray<StageTransition>> => {
      const rows = await db
        .select()
        .from(stageAdvisorTransitions)
        .where(eq(stageAdvisorTransitions.tenantId, tenantId))
        .orderBy(desc(stageAdvisorTransitions.occurredAt));
      return (rows as Array<Record<string, unknown>>).map(rowToTransition);
    },

    // Append-only — INSERT only; transition history is never mutated.
    appendTransition: async (args: {
      tenantId: string;
      transition: StageTransition;
    }): Promise<void> => {
      const t = args.transition;
      await db.insert(stageAdvisorTransitions).values({
        tenantId: args.tenantId,
        fromStage: t.from,
        toStage: t.to,
        kind: t.kind,
        introductionMessage: t.introductionMessage,
        recommendedNextSteps: [...t.recommendedNextSteps],
        capabilitiesToUnlock: [...t.capabilitiesToUnlock],
        capabilitiesToReview: [...t.capabilitiesToReview],
        occurredAt: new Date(),
      });
    },
  };
}
