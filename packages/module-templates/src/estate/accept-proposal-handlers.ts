/**
 * @borjie/module-templates/estate/accept-proposal-handlers
 *
 * The 5 ESTATE actions adapted as `AcceptHandler` functions that conform
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
 * Why an adapter layer instead of the dispatch registry calling pure
 * handlers directly?
 *
 *   - Pure handlers take typed `payload` + `ctx` + `deps`. The dispatcher
 *     ships them only `{ tenant_id, proposal }`. The adapters bridge.
 *   - Pure handlers are testable without the dispatcher; the dispatcher
 *     is testable without real handlers. Separation of concerns.
 *   - Future modules (HR, FINANCE, ...) follow the same adapter pattern.
 */

import type {
  AcceptHandler,
  AcceptHandlerArgs,
  AcceptHandlerResult,
} from '@borjie/dispatch-router';
import { z } from 'zod';

import {
  CreateLeaseApplicationPayloadSchema,
  createLeaseApplicationHandler,
  type CreateLeaseApplicationDeps,
  type CreateLeaseApplicationContext,
} from '../templates/estate/handlers/create-lease-application.js';
import {
  PostReceiptDraftPayloadSchema,
  postReceiptDraftHandler,
  type PostReceiptDraftDeps,
  type PostReceiptDraftContext,
} from '../templates/estate/handlers/post-receipt-draft.js';
import {
  OpenMaintenanceCasePayloadSchema,
  openMaintenanceCaseHandler,
  type OpenMaintenanceCaseDeps,
  type OpenMaintenanceCaseContext,
} from '../templates/estate/handlers/open-maintenance-case.js';
import {
  ScheduleRenewalNegotiationPayloadSchema,
  scheduleRenewalNegotiationHandler,
  type ScheduleRenewalNegotiationDeps,
  type ScheduleRenewalNegotiationContext,
} from '../templates/estate/handlers/schedule-renewal-negotiation.js';
import {
  BulkMarkForRenewalPrepPayloadSchema,
  bulkMarkForRenewalPrepHandler,
  type BulkMarkForRenewalPrepDeps,
  type BulkMarkForRenewalPrepContext,
} from '../templates/estate/handlers/bulk-mark-for-renewal-prep.js';

// ─── Aggregated deps ──────────────────────────────────────────────────────

export interface EstateHandlerDeps {
  readonly createLeaseApplication: CreateLeaseApplicationDeps;
  readonly postReceiptDraft: PostReceiptDraftDeps;
  readonly openMaintenanceCase: OpenMaintenanceCaseDeps;
  readonly scheduleRenewalNegotiation: ScheduleRenewalNegotiationDeps;
  readonly bulkMarkForRenewalPrep: BulkMarkForRenewalPrepDeps;
  /** moduleId is constant per template — ESTATE rows are written here. */
  readonly moduleId: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function buildContext(args: AcceptHandlerArgs, moduleId: string): {
  tenantId: string;
  moduleId: string;
  proposalId: string;
  sourceAuditChainId: string | null;
} {
  return {
    tenantId: args.tenant_id,
    moduleId,
    proposalId: args.proposal.id,
    /** Capture row is the chain parent — its audit row hash anchors us. */
    sourceAuditChainId: args.proposal.capture_id,
  };
}

function ok(artifacts: ReadonlyArray<{ type: string; id: string }>): AcceptHandlerResult {
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

export function createCreateLeaseApplicationAdapter(
  deps: CreateLeaseApplicationDeps,
  moduleId: string,
): AcceptHandler {
  return async (args) => {
    try {
      const payload = CreateLeaseApplicationPayloadSchema.parse(args.proposal.payload);
      const ctx: CreateLeaseApplicationContext = buildContext(args, moduleId);
      const result = await createLeaseApplicationHandler(payload, ctx, deps);
      return ok([
        { type: 'lease_application', id: result.application_id },
        { type: 'audit_chain_row', id: result.audit_chain_id },
        { type: 'ledger_entry', id: result.deposit_ledger_entry_id },
        { type: 'tenant_entity', id: result.tenant_entity_id },
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

export function createPostReceiptDraftAdapter(
  deps: PostReceiptDraftDeps,
): AcceptHandler {
  return async (args) => {
    try {
      const payload = PostReceiptDraftPayloadSchema.parse(args.proposal.payload);
      const ctx: PostReceiptDraftContext = {
        tenantId: args.tenant_id,
        proposalId: args.proposal.id,
        sourceAuditChainId: args.proposal.capture_id,
      };
      const result = await postReceiptDraftHandler(payload, ctx, deps);
      return ok([
        { type: 'receipt_draft', id: result.receipt_id },
        { type: 'ledger_draft', id: result.ledger_draft_id },
        { type: 'audit_chain_row', id: result.audit_chain_id },
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

export function createOpenMaintenanceCaseAdapter(
  deps: OpenMaintenanceCaseDeps,
): AcceptHandler {
  return async (args) => {
    try {
      const payload = OpenMaintenanceCasePayloadSchema.parse(args.proposal.payload);
      const ctx: OpenMaintenanceCaseContext = {
        tenantId: args.tenant_id,
        proposalId: args.proposal.id,
        sourceAuditChainId: args.proposal.capture_id,
      };
      const result = await openMaintenanceCaseHandler(payload, ctx, deps);
      return ok([
        { type: 'maintenance_ticket', id: result.ticket_id },
        { type: 'audit_chain_row', id: result.audit_chain_id },
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

export function createScheduleRenewalNegotiationAdapter(
  deps: ScheduleRenewalNegotiationDeps,
): AcceptHandler {
  return async (args) => {
    try {
      const payload = ScheduleRenewalNegotiationPayloadSchema.parse(
        args.proposal.payload,
      );
      const ctx: ScheduleRenewalNegotiationContext = {
        tenantId: args.tenant_id,
        proposalId: args.proposal.id,
        sourceAuditChainId: args.proposal.capture_id,
      };
      const result = await scheduleRenewalNegotiationHandler(payload, ctx, deps);
      return ok([
        { type: 'work_assignment', id: result.assignment_id },
        { type: 'audit_chain_row', id: result.audit_chain_id },
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

export function createBulkMarkForRenewalPrepAdapter(
  deps: BulkMarkForRenewalPrepDeps,
): AcceptHandler {
  return async (args) => {
    try {
      const payload = BulkMarkForRenewalPrepPayloadSchema.parse(
        args.proposal.payload,
      );
      const ctx: BulkMarkForRenewalPrepContext = {
        tenantId: args.tenant_id,
        proposalId: args.proposal.id,
        sourceAuditChainId: args.proposal.capture_id,
      };
      const result = await bulkMarkForRenewalPrepHandler(payload, ctx, deps);
      return ok([
        { type: 'audit_chain_row', id: result.audit_chain_id },
        ...result.per_lease
          .filter((p) => p.status === 'flagged')
          .map((p) => ({ type: 'lease_flagged', id: p.lease_id })),
      ]);
    } catch (e) {
      return fail(asValidationError(e));
    }
  };
}

// ─── Action → factory map ─────────────────────────────────────────────────

export interface BuildEstateHandlerSet {
  readonly create_lease_application: AcceptHandler;
  readonly post_receipt_draft: AcceptHandler;
  readonly open_maintenance_case: AcceptHandler;
  readonly schedule_renewal_negotiation: AcceptHandler;
  readonly bulk_mark_for_renewal_prep: AcceptHandler;
}

export function buildEstateHandlerSet(deps: EstateHandlerDeps): BuildEstateHandlerSet {
  return Object.freeze({
    create_lease_application: createCreateLeaseApplicationAdapter(
      deps.createLeaseApplication,
      deps.moduleId,
    ),
    post_receipt_draft: createPostReceiptDraftAdapter(deps.postReceiptDraft),
    open_maintenance_case: createOpenMaintenanceCaseAdapter(deps.openMaintenanceCase),
    schedule_renewal_negotiation: createScheduleRenewalNegotiationAdapter(
      deps.scheduleRenewalNegotiation,
    ),
    bulk_mark_for_renewal_prep: createBulkMarkForRenewalPrepAdapter(
      deps.bulkMarkForRenewalPrep,
    ),
  });
}

/** Canonical list of the 5 estate actions — kept for tests + diagnostics. */
export const ESTATE_ACTIONS: ReadonlyArray<keyof BuildEstateHandlerSet> = Object.freeze([
  'create_lease_application',
  'post_receipt_draft',
  'open_maintenance_case',
  'schedule_renewal_negotiation',
  'bulk_mark_for_renewal_prep',
]);

// Re-export handlers + payload schemas for direct testing.
export {
  createLeaseApplicationHandler,
  CreateLeaseApplicationPayloadSchema,
  postReceiptDraftHandler,
  PostReceiptDraftPayloadSchema,
  openMaintenanceCaseHandler,
  OpenMaintenanceCasePayloadSchema,
  scheduleRenewalNegotiationHandler,
  ScheduleRenewalNegotiationPayloadSchema,
  bulkMarkForRenewalPrepHandler,
  BulkMarkForRenewalPrepPayloadSchema,
};
