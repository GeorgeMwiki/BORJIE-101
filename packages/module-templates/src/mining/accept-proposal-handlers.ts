/**
 * @borjie/module-templates/mining/accept-proposal-handlers
 *
 * The 3 MINING actions adapted as `AcceptHandler` functions that conform
 * to the dispatch-router registry shape. Each adapter:
 *
 *   1. Zod-validates the dispatcher's loose `payload: Record<string,unknown>`
 *      against the handler's `*PayloadSchema`.
 *   2. Invokes the pure handler function with its port-injected deps.
 *   3. Returns `{ ok, artifacts }` so the dispatcher can flip the proposal
 *      to `accepted` and audit-chain the artifacts.
 *
 * On Zod failure, returns `{ ok: false, error }` so the dispatcher flips
 * the proposal to `failed` (the human can edit-then-approve).
 *
 * Replaces the equivalent BossNyumba-era estate adapters
 * (`createOpenMaintenanceCaseAdapter`, `createScheduleRenewalNegotiationAdapter`,
 * `createBulkMarkForRenewalPrepAdapter`) — closes TODO(#34).
 */

import type {
  AcceptHandler,
  AcceptHandlerArgs,
  AcceptHandlerResult,
} from '@borjie/dispatch-router';
import { z } from 'zod';

import {
  ScheduleLicenceRenewalPayloadSchema,
  scheduleLicenceRenewalHandler,
  type ScheduleLicenceRenewalDeps,
  type ScheduleLicenceRenewalContext,
} from '../templates/mining/handlers/schedule-licence-renewal.js';
import {
  OpenEquipmentMaintenancePayloadSchema,
  openEquipmentMaintenanceHandler,
  type OpenEquipmentMaintenanceDeps,
  type OpenEquipmentMaintenanceContext,
} from '../templates/mining/handlers/open-equipment-maintenance.js';
import {
  BulkMarkLicencesForRenewalPayloadSchema,
  bulkMarkLicencesForRenewalHandler,
  type BulkMarkLicencesForRenewalDeps,
  type BulkMarkLicencesForRenewalContext,
} from '../templates/mining/handlers/bulk-mark-licences-for-renewal.js';

// ─── Aggregated deps ──────────────────────────────────────────────────────

export interface MiningHandlerDeps {
  readonly scheduleLicenceRenewal: ScheduleLicenceRenewalDeps;
  readonly openEquipmentMaintenance: OpenEquipmentMaintenanceDeps;
  readonly bulkMarkLicencesForRenewal: BulkMarkLicencesForRenewalDeps;
  /** moduleId is constant per template — MINING rows are written here. */
  readonly moduleId: string;
  /** Clock injection for handlers that need `now`/`today` deterministically. */
  readonly clock: {
    readonly nowIso: () => string;
    readonly todayIso: () => string;
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function ok(
  artifacts: ReadonlyArray<{ type: string; id: string }>,
): AcceptHandlerResult {
  return { ok: true, artifacts };
}

function fail(error: string): AcceptHandlerResult {
  return { ok: false, error };
}

function asValidationError(e: unknown): string {
  if (e instanceof z.ZodError) {
    return `payload_zod_invalid: ${e.errors
      .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
      .join('; ')}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// ─── Adapters ─────────────────────────────────────────────────────────────

export function createScheduleLicenceRenewalAdapter(
  deps: ScheduleLicenceRenewalDeps,
  clock: MiningHandlerDeps['clock'],
): AcceptHandler {
  return async (args: AcceptHandlerArgs) => {
    try {
      const payload = ScheduleLicenceRenewalPayloadSchema.parse(
        args.proposal.payload,
      );
      const ctx: ScheduleLicenceRenewalContext = {
        tenantId: args.tenant_id,
        proposalId: args.proposal.id,
        sourceAuditChainId: args.proposal.capture_id,
        nowIso: clock.nowIso(),
      };
      const result = await scheduleLicenceRenewalHandler(payload, ctx, deps);
      return ok([
        { type: 'task', id: result.entity_id },
        { type: 'temporal_entity', id: result.temporal_entity_id },
        { type: 'audit_chain_row', id: result.audit_chain_id },
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

export function createOpenEquipmentMaintenanceAdapter(
  deps: OpenEquipmentMaintenanceDeps,
): AcceptHandler {
  return async (args: AcceptHandlerArgs) => {
    try {
      const payload = OpenEquipmentMaintenancePayloadSchema.parse(
        args.proposal.payload,
      );
      const ctx: OpenEquipmentMaintenanceContext = {
        tenantId: args.tenant_id,
        proposalId: args.proposal.id,
        sourceAuditChainId: args.proposal.capture_id,
      };
      const result = await openEquipmentMaintenanceHandler(payload, ctx, deps);
      return ok([
        { type: 'maintenance_event', id: result.entity_id },
        { type: 'task', id: result.task_id },
        { type: 'audit_chain_row', id: result.audit_chain_id },
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

export function createBulkMarkLicencesForRenewalAdapter(
  deps: BulkMarkLicencesForRenewalDeps,
  clock: MiningHandlerDeps['clock'],
): AcceptHandler {
  return async (args: AcceptHandlerArgs) => {
    try {
      const payload = BulkMarkLicencesForRenewalPayloadSchema.parse(
        args.proposal.payload,
      );
      const ctx: BulkMarkLicencesForRenewalContext = {
        tenantId: args.tenant_id,
        proposalId: args.proposal.id,
        sourceAuditChainId: args.proposal.capture_id,
        todayIso: clock.todayIso(),
      };
      const result = await bulkMarkLicencesForRenewalHandler(
        payload,
        ctx,
        deps,
      );
      return ok([
        { type: 'audit_chain_row', id: result.audit_chain_id },
        ...result.per_licence
          .filter((p) => p.status === 'flagged' && p.task_id !== undefined)
          .map((p) => ({ type: 'task', id: p.task_id as string })),
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

// ─── Action → factory map ─────────────────────────────────────────────────

export interface BuildMiningHandlerSet {
  readonly schedule_licence_renewal: AcceptHandler;
  readonly open_equipment_maintenance: AcceptHandler;
  readonly bulk_mark_licences_for_renewal: AcceptHandler;
}

export function buildMiningHandlerSet(
  deps: MiningHandlerDeps,
): BuildMiningHandlerSet {
  return Object.freeze({
    schedule_licence_renewal: createScheduleLicenceRenewalAdapter(
      deps.scheduleLicenceRenewal,
      deps.clock,
    ),
    open_equipment_maintenance: createOpenEquipmentMaintenanceAdapter(
      deps.openEquipmentMaintenance,
    ),
    bulk_mark_licences_for_renewal: createBulkMarkLicencesForRenewalAdapter(
      deps.bulkMarkLicencesForRenewal,
      deps.clock,
    ),
  });
}

/** Canonical list of the 3 mining actions — kept for tests + diagnostics. */
export const MINING_ACTIONS: ReadonlyArray<keyof BuildMiningHandlerSet> =
  Object.freeze([
    'schedule_licence_renewal',
    'open_equipment_maintenance',
    'bulk_mark_licences_for_renewal',
  ]);

// Re-export handlers + payload schemas for direct testing.
export {
  scheduleLicenceRenewalHandler,
  ScheduleLicenceRenewalPayloadSchema,
  openEquipmentMaintenanceHandler,
  OpenEquipmentMaintenancePayloadSchema,
  bulkMarkLicencesForRenewalHandler,
  BulkMarkLicencesForRenewalPayloadSchema,
};
