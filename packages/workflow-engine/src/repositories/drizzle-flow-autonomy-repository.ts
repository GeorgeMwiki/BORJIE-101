/**
 * Drizzle-backed FlowAutonomyRepository — persists the per-flow autonomy
 * posture to `flow_autonomy_prefs` (migration 0308). This replaces the
 * in-memory adapter so a flow's `auto | gated` posture + its creation-time
 * confirmation survive an api-gateway restart.
 *
 * TENANT ISOLATION (two layers, mirroring drizzle-repos.ts):
 *   1. RLS — `flow_autonomy_prefs` FORCE row-level security on the canonical
 *      `app.current_tenant_id` GUC. Every WRITE + tenant-scoped read runs inside
 *      `withTenantContext(db, tenantId, …)` so the GUC is bound.
 *   2. Service-role bypass — the single-flow `get(tenantId, flowId)` read binds
 *      the concrete tenant GUC; no globally-unique read is exposed here.
 *
 * IMMUTABILITY: every row is mapped through an explicit converter to a frozen
 * record; we never hand a raw Drizzle row back to a caller.
 *
 * HARD RULE (additive only): an AUTO posture widens the autonomy POLICY only.
 * The inviolable rails still gate per action — this adapter only reads/writes a
 * preference; it never bypasses a rail.
 *
 * No `console.log` — errors propagate to the caller.
 */

import { and, asc, eq } from 'drizzle-orm';
import {
  flowAutonomyPrefs,
  withTenantContext,
} from '@borjie/database';
import type {
  FlowAutonomyPosture,
  FlowAutonomyPref,
  FlowAutonomyRepository,
  FlowConfirmationState,
  RecordFlowCreationInput,
  SetFlowPostureInput,
} from '../autonomy/flow-autonomy-port.js';

/**
 * Drizzle client seam — `any` at the builder boundary to dodge the TS2709
 * namespace/type drift through the `@borjie/database` barrel (same idiom as
 * `drizzle-repos.ts`). Every row is mapped through an explicit converter so the
 * caller stays fully typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return toDate(value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

interface FlowAutonomyRowLike {
  readonly tenantId: string;
  readonly flowId: string;
  readonly posture: string;
  readonly confirmationState: string;
  readonly riskCeiling: string | null;
  readonly amountThreshold: unknown;
  readonly createdBy: string;
  readonly promotedAt: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}

function rowToPref(row: FlowAutonomyRowLike): FlowAutonomyPref {
  return Object.freeze({
    tenantId: row.tenantId,
    flowId: row.flowId,
    posture: row.posture as FlowAutonomyPosture,
    confirmationState: row.confirmationState as FlowConfirmationState,
    riskCeiling: row.riskCeiling ?? null,
    amountThreshold: toNumberOrNull(row.amountThreshold),
    createdBy: row.createdBy,
    promotedAt: toDateOrNull(row.promotedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  });
}

async function readOne(
  tx: DrizzleLike,
  tenantId: string,
  flowId: string,
): Promise<FlowAutonomyPref | null> {
  const rows = (await tx
    .select()
    .from(flowAutonomyPrefs)
    .where(
      and(
        eq(flowAutonomyPrefs.tenantId, tenantId),
        eq(flowAutonomyPrefs.flowId, flowId),
      ),
    )
    .limit(1)) as ReadonlyArray<FlowAutonomyRowLike>;
  return rows[0] ? rowToPref(rows[0]) : null;
}

export function createDrizzleFlowAutonomyRepository(
  db: DrizzleLike,
  now: () => Date = () => new Date(),
): FlowAutonomyRepository {
  if (!db) {
    throw new Error(
      'createDrizzleFlowAutonomyRepository requires a non-null Drizzle client',
    );
  }

  return {
    async recordFlowCreation(input: RecordFlowCreationInput) {
      return withTenantContext(
        db,
        input.tenantId,
        async (tx: DrizzleLike) => {
          const t = now();
          // Idempotent: a second call for the same (tenant, flow) must NOT
          // reset an already-answered confirmation. onConflictDoNothing keeps
          // the existing row; we then read it back.
          await tx
            .insert(flowAutonomyPrefs)
            .values({
              tenantId: input.tenantId,
              flowId: input.flowId,
              posture: 'gated',
              confirmationState: 'pending',
              riskCeiling: input.riskCeiling ?? null,
              amountThreshold: input.amountThreshold ?? null,
              createdBy: input.createdBy,
              promotedAt: null,
              createdAt: t,
              updatedAt: t,
            })
            .onConflictDoNothing({
              target: [
                flowAutonomyPrefs.tenantId,
                flowAutonomyPrefs.flowId,
              ],
            });
          const pref = await readOne(tx, input.tenantId, input.flowId);
          if (!pref) {
            throw new Error(
              `flow_autonomy_record_failed:${input.tenantId}:${input.flowId}`,
            );
          }
          return pref;
        },
      );
    },

    async setPosture(input: SetFlowPostureInput) {
      return withTenantContext(
        db,
        input.tenantId,
        async (tx: DrizzleLike) => {
          const t = now();
          const existing = await readOne(tx, input.tenantId, input.flowId);
          const promotedAt =
            input.posture === 'auto'
              ? existing?.promotedAt ?? t
              : null;
          const riskCeiling =
            input.riskCeiling !== undefined
              ? input.riskCeiling
              : existing?.riskCeiling ?? null;
          const amountThreshold =
            input.amountThreshold !== undefined
              ? input.amountThreshold
              : existing?.amountThreshold ?? null;
          if (existing) {
            await tx
              .update(flowAutonomyPrefs)
              .set({
                posture: input.posture,
                confirmationState: 'confirmed',
                riskCeiling,
                amountThreshold,
                promotedAt,
                updatedAt: t,
              })
              .where(
                and(
                  eq(flowAutonomyPrefs.tenantId, input.tenantId),
                  eq(flowAutonomyPrefs.flowId, input.flowId),
                ),
              );
          } else {
            await tx.insert(flowAutonomyPrefs).values({
              tenantId: input.tenantId,
              flowId: input.flowId,
              posture: input.posture,
              confirmationState: 'confirmed',
              riskCeiling,
              amountThreshold,
              createdBy: input.actorUserId,
              promotedAt,
              createdAt: t,
              updatedAt: t,
            });
          }
          const pref = await readOne(tx, input.tenantId, input.flowId);
          if (!pref) {
            throw new Error(
              `flow_autonomy_set_failed:${input.tenantId}:${input.flowId}`,
            );
          }
          return pref;
        },
      );
    },

    async get(tenantId: string, flowId: string) {
      return withTenantContext(db, tenantId, async (tx: DrizzleLike) =>
        readOne(tx, tenantId, flowId),
      );
    },

    async list(tenantId: string) {
      return withTenantContext(db, tenantId, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select()
          .from(flowAutonomyPrefs)
          .where(eq(flowAutonomyPrefs.tenantId, tenantId))
          .orderBy(asc(flowAutonomyPrefs.flowId))) as ReadonlyArray<FlowAutonomyRowLike>;
        return Object.freeze(rows.map(rowToPref));
      });
    },

    async listPending(tenantId: string) {
      return withTenantContext(db, tenantId, async (tx: DrizzleLike) => {
        const rows = (await tx
          .select()
          .from(flowAutonomyPrefs)
          .where(
            and(
              eq(flowAutonomyPrefs.tenantId, tenantId),
              eq(flowAutonomyPrefs.confirmationState, 'pending'),
            ),
          )
          .orderBy(asc(flowAutonomyPrefs.createdAt))) as ReadonlyArray<FlowAutonomyRowLike>;
        return Object.freeze(rows.map(rowToPref));
      });
    },
  };
}
