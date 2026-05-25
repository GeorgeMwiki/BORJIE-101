/**
 * estate / create_lease_application — end-to-end accept_proposal handler.
 *
 * Owner-vision quote: "User can go to tabs and use as normal OS, just
 * still super-powered by intelligence... a tenant can be onboarded
 * from a chat, a doc upload, or a tab click — the same handler runs."
 *
 * This handler is the FIRST proof-of-concept for the Piece B + Piece L
 * loop. It receives a `module_update_proposals` row's payload and:
 *
 *   1. Validates the payload against the ZodCreateLeaseApplicationPayload
 *      schema (defence in depth; the executor already does this via
 *      the module_accept_handlers.payload_zod_jsonb).
 *   2. Resolves the prospective tenant via a `core_entity` PERSON
 *      lookup or creates one if the resolver missed.
 *   3. Drafts a lease application row in the module's lease table.
 *   4. Posts the deposit via the ports.ledger.post() port — money
 *      MUST go through LedgerService.post().
 *   5. Appends an `ai_audit_chain` row anchored to the source
 *      capture/document.
 *   6. Emits a notification through the event-bus port.
 *
 * The handler is port-driven so unit tests can fake the entire
 * downstream surface.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Payload Zod schema (also persisted to module_accept_handlers.
// payload_zod_jsonb in serialised form).
// ─────────────────────────────────────────────────────────────────────

export const ProspectiveTenantSchema = z.object({
  canonical_entity_id: z.string().nullable(),
  full_name: z.string().min(2),
  contact_phone: z.string().min(6),
  national_id: z.string().min(4).nullable().optional(),
});

export const MoneySchema = z.object({
  amount: z.number().positive(),
  currency_code: z.enum(['TZS', 'KES', 'UGX', 'NGN', 'USD']),
});

export const CreateLeaseApplicationPayloadSchema = z.object({
  prospective_tenant: ProspectiveTenantSchema,
  unit_id: z.string().min(1),
  desired_start_date: z.string(),
  monthly_rent: MoneySchema,
  proposed_term_months: z.number().int().min(1).max(120),
  source: z.object({
    capture_id: z.string().nullable(),
    message_id: z.string().nullable(),
    document_id: z.string().nullable(),
  }),
});

export type CreateLeaseApplicationPayload = z.infer<
  typeof CreateLeaseApplicationPayloadSchema
>;

export interface AcceptResult {
  readonly application_id: string;
  readonly status: 'draft' | 'awaiting_screening' | 'rejected';
  readonly audit_chain_id: string;
  readonly tenant_entity_id: string;
  readonly deposit_ledger_entry_id: string;
}

// ─────────────────────────────────────────────────────────────────────
// Ports — every dependency this handler needs is a port the caller
// (orchestrator) injects. Tests fake these.
// ─────────────────────────────────────────────────────────────────────

export interface CoreEntityPort {
  /** Look up a canonical PERSON entity by id (returns null if not found). */
  findById(id: string): Promise<{ readonly id: string; readonly displayName: string } | null>;
  /** Create a PERSON entity in core_entity. Returns the new entity id. */
  createPerson(args: {
    readonly tenantId: string;
    readonly moduleId: string;
    readonly displayName: string;
    readonly customFields: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface LedgerPort {
  /**
   * Post a double-entry ledger transaction via LedgerService.post().
   * Returns the journal entry id. MUST NOT mutate ledger rows directly.
   */
  post(args: {
    readonly tenantId: string;
    readonly amount: number;
    readonly currencyCode: string;
    readonly memo: string;
    readonly debitAccount: string;
    readonly creditAccount: string;
    readonly correlation: { readonly module_id: string; readonly application_id: string };
  }): Promise<{ readonly id: string }>;
}

export interface ApplicationStorePort {
  /** Persist a draft lease application row in the module's lease table. */
  draftApplication(args: {
    readonly tenantId: string;
    readonly moduleId: string;
    readonly tenantEntityId: string;
    readonly unitId: string;
    readonly startDate: string;
    readonly proposedTermMonths: number;
    readonly monthlyRent: { readonly amount: number; readonly currencyCode: string };
  }): Promise<{ readonly id: string }>;
}

export interface AuditChainPort {
  /** Append a hash-chained audit row. Returns the row id. */
  append(args: {
    readonly tenantId: string;
    readonly moduleId: string;
    readonly action: string;
    readonly parentHash: string | null;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly id: string }>;
}

export interface NotificationPort {
  /** Publish a notification event onto the event bus. */
  publish(args: {
    readonly tenantId: string;
    readonly channel: string;
    readonly subject: string;
    readonly correlation: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}

export interface CreateLeaseApplicationDeps {
  readonly coreEntity: CoreEntityPort;
  readonly ledger: LedgerPort;
  readonly applications: ApplicationStorePort;
  readonly auditChain: AuditChainPort;
  readonly notifications: NotificationPort;
}

export interface CreateLeaseApplicationContext {
  readonly tenantId: string;
  readonly moduleId: string;
  readonly proposalId: string;
  /** parent_hash of the source capture/document audit row. */
  readonly sourceAuditChainId: string | null;
}

// ─────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────

/**
 * Execute the create_lease_application accept_proposal handler.
 *
 * Tenant-tier preconditions (T1/T2/T3) are enforced by the executor
 * BEFORE this function is called — the handler trusts the payload has
 * been Zod-parsed and the tier is authorised.
 */
export async function createLeaseApplicationHandler(
  payload: CreateLeaseApplicationPayload,
  ctx: CreateLeaseApplicationContext,
  deps: CreateLeaseApplicationDeps,
): Promise<AcceptResult> {
  // 1. Re-validate (defence in depth).
  const parsed = CreateLeaseApplicationPayloadSchema.parse(payload);

  // 2. Resolve / create the PERSON canonical entity.
  let tenantEntityId: string | null = null;
  if (parsed.prospective_tenant.canonical_entity_id) {
    // nosemgrep: missing-tenant-id-arg reason: core entity lookup is by globally-unique canonical_entity_id; tenant scoping enforced downstream when linking to lease.
    const existing = await deps.coreEntity.findById(
      parsed.prospective_tenant.canonical_entity_id,
    );
    if (existing) tenantEntityId = existing.id;
  }
  if (tenantEntityId === null) {
    const created = await deps.coreEntity.createPerson({
      tenantId: ctx.tenantId,
      moduleId: ctx.moduleId,
      displayName: parsed.prospective_tenant.full_name,
      customFields: {
        contact_phone: parsed.prospective_tenant.contact_phone,
        national_id: parsed.prospective_tenant.national_id ?? null,
        source: 'create_lease_application',
      },
    });
    tenantEntityId = created.id;
  }

  // 3. Draft the application row.
  const application = await deps.applications.draftApplication({
    tenantId: ctx.tenantId,
    moduleId: ctx.moduleId,
    tenantEntityId,
    unitId: parsed.unit_id,
    startDate: parsed.desired_start_date,
    proposedTermMonths: parsed.proposed_term_months,
    monthlyRent: {
      amount: parsed.monthly_rent.amount,
      currencyCode: parsed.monthly_rent.currency_code,
    },
  });

  // 4. Post the deposit via the ledger port (one-month rent default).
  const depositEntry = await deps.ledger.post({
    tenantId: ctx.tenantId,
    amount: parsed.monthly_rent.amount,
    currencyCode: parsed.monthly_rent.currency_code,
    memo: `Lease application deposit — application ${application.id}`,
    debitAccount: 'cash_clearing',
    creditAccount: 'tenant_deposits',
    correlation: { module_id: ctx.moduleId, application_id: application.id },
  });

  // 5. Append the audit-chain row, anchored to the source capture row's hash.
  const audit = await deps.auditChain.append({
    tenantId: ctx.tenantId,
    moduleId: ctx.moduleId,
    action: 'estate.create_lease_application',
    parentHash: ctx.sourceAuditChainId,
    payload: {
      proposal_id: ctx.proposalId,
      application_id: application.id,
      tenant_entity_id: tenantEntityId,
      monthly_rent: parsed.monthly_rent,
      deposit_ledger_entry_id: depositEntry.id,
    },
  });

  // 6. Notify the manager — "Lease application drafted for unit X — review?"
  await deps.notifications.publish({
    tenantId: ctx.tenantId,
    channel: `tenant:${ctx.tenantId}:module:ESTATE:proposals`,
    subject: `Lease application drafted for unit ${parsed.unit_id}`,
    correlation: {
      application_id: application.id,
      tenant_entity_id: tenantEntityId,
      proposal_id: ctx.proposalId,
    },
  });

  return Object.freeze({
    application_id: application.id,
    status: 'awaiting_screening',
    audit_chain_id: audit.id,
    tenant_entity_id: tenantEntityId,
    deposit_ledger_entry_id: depositEntry.id,
  });
}
