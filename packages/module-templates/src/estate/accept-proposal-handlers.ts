/**
 * @borjie/module-templates/estate/accept-proposal-handlers
 *
 * The 2 surviving ESTATE actions adapted as `AcceptHandler` functions
 * that conform to the dispatch-router registry shape. Each adapter:
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
 * The 3 BossNyumba-era handlers (open_maintenance_case,
 * schedule_renewal_negotiation, bulk_mark_for_renewal_prep) were ported
 * to mining-domain equivalents under `templates/mining/handlers/` —
 * see `../mining/accept-proposal-handlers.ts`. Closed TODO(#34).
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

// ─── Aggregated deps ──────────────────────────────────────────────────────

export interface EstateHandlerDeps {
  readonly createLeaseApplication: CreateLeaseApplicationDeps;
  readonly postReceiptDraft: PostReceiptDraftDeps;
  /** moduleId is constant per template — ESTATE rows are written here. */
  readonly moduleId: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function buildContext(
  args: AcceptHandlerArgs,
  moduleId: string,
): {
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

export function createCreateLeaseApplicationAdapter(
  deps: CreateLeaseApplicationDeps,
  moduleId: string,
): AcceptHandler {
  return async (args) => {
    try {
      const payload = CreateLeaseApplicationPayloadSchema.parse(
        args.proposal.payload,
      );
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

// ─── Action → factory map ─────────────────────────────────────────────────

export interface BuildEstateHandlerSet {
  readonly create_lease_application: AcceptHandler;
  readonly post_receipt_draft: AcceptHandler;
}

export function buildEstateHandlerSet(
  deps: EstateHandlerDeps,
): BuildEstateHandlerSet {
  return Object.freeze({
    create_lease_application: createCreateLeaseApplicationAdapter(
      deps.createLeaseApplication,
      deps.moduleId,
    ),
    post_receipt_draft: createPostReceiptDraftAdapter(deps.postReceiptDraft),
  });
}

/** Canonical list of the 2 surviving estate actions. */
export const ESTATE_ACTIONS: ReadonlyArray<keyof BuildEstateHandlerSet> =
  Object.freeze(['create_lease_application', 'post_receipt_draft']);

// Re-export handlers + payload schemas for direct testing.
export {
  createLeaseApplicationHandler,
  CreateLeaseApplicationPayloadSchema,
  postReceiptDraftHandler,
  PostReceiptDraftPayloadSchema,
};
