/**
 * Wave-3-int2 — ESTATE 5-handler adapter smoke tests.
 *
 * Verifies each adapter:
 *   - validates its payload via Zod
 *   - invokes the underlying pure handler with the right ctx
 *   - returns the dispatcher-compatible `AcceptHandlerResult` shape
 */

import { describe, it, expect } from 'vitest';
import {
  buildEstateHandlerSet,
  ESTATE_ACTIONS,
} from '../estate/accept-proposal-handlers.js';
import { createModuleHandlerRegistry } from '../registry.js';
import type {
  AcceptHandlerArgs,
  ModuleUpdateProposal,
} from '@borjie/dispatch-router';
import type { EstateHandlerDeps } from '../estate/accept-proposal-handlers.js';

function mkStubDeps(): EstateHandlerDeps {
  const auditChain = {
    async append() {
      return { id: 'audit_stub_1' };
    },
  };
  const notifications = {
    async publish() {
      /* noop */
    },
  };
  return {
    moduleId: 'ESTATE',
    createLeaseApplication: {
      coreEntity: {
        async findById() {
          return null;
        },
        async createPerson() {
          return { id: 'person_stub_1' };
        },
      },
      ledger: {
        async post() {
          return { id: 'ledger_stub_1' };
        },
      },
      applications: {
        async draftApplication() {
          return { id: 'app_stub_1' };
        },
      },
      auditChain,
      notifications,
    },
    postReceiptDraft: {
      ledger: {
        async draft() {
          return { id: 'ledger_draft_stub_1' };
        },
      },
      receipts: {
        async draft() {
          return { id: 'receipt_stub_1' };
        },
      },
      auditChain,
    },
    openMaintenanceCase: {
      tickets: {
        async open() {
          return { id: 'ticket_stub_1' };
        },
      },
      auditChain,
      notifications,
    },
    scheduleRenewalNegotiation: {
      workAssignments: {
        async assign() {
          return { id: 'assignment_stub_1' };
        },
      },
      auditChain,
      notifications,
    },
    bulkMarkForRenewalPrep: {
      leases: {
        async bulkMarkForRenewalPrep() {
          return {
            updated: ['lease_1', 'lease_2'],
            skipped: [],
          };
        },
      },
      auditChain,
    },
  };
}

function mkProposal(
  action: string,
  payload: Record<string, unknown>,
): ModuleUpdateProposal {
  return {
    id: `prop_${action}`,
    tenant_id: 'trc',
    capture_id: 'cap_1',
    module_template_id: 'ESTATE',
    action,
    persona_id: 'p_1',
    status: 'pending_hitl',
    confidence: 0.9,
    hitl_required: true,
    priority: 'high',
    payload,
    entity_refs: [],
    matrix_row_id: 'L-ROW-01',
    approver_tier: null,
    approver_user_id: null,
    decline_reason: null,
    edited_from_id: null,
    failure_reason: null,
    resolved_at: null,
    expires_at: '2026-05-30T00:00:00Z',
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T00:00:00Z',
  };
}

describe('ESTATE 5-handler adapters', () => {
  const deps = mkStubDeps();
  const set = buildEstateHandlerSet(deps);

  it('create_lease_application adapter validates + writes', async () => {
    const payload = {
      prospective_tenant: {
        canonical_entity_id: null,
        full_name: 'Mr Juma',
        contact_phone: '+255700001',
      },
      unit_id: 'u_godown_3',
      desired_start_date: '2026-06-01',
      monthly_rent: { amount: 350_000, currency_code: 'TZS' as const },
      proposed_term_months: 12,
      source: { capture_id: 'cap_1', message_id: null, document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('create_lease_application', payload),
    };
    const result = await set.create_lease_application(args);
    expect(result.ok).toBe(true);
    expect(result.artifacts?.length).toBeGreaterThan(0);
    expect(result.artifacts?.some((a) => a.type === 'lease_application')).toBe(true);
  });

  it('post_receipt_draft adapter validates + posts ledger draft', async () => {
    const payload = {
      amount: { amount: 200_000, currency_code: 'TZS' as const },
      payer: { canonical_entity_id: null, full_name: 'Mr Juma' },
      customer_entity_id: 'cust_juma_x',
      lease_id: null,
      external_ref: 'MPESA-XYZ-123',
      payment_date: '2026-05-23',
      source: { capture_id: 'cap_1', document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('post_receipt_draft', payload),
    };
    const result = await set.post_receipt_draft(args);
    expect(result.ok).toBe(true);
    expect(result.artifacts?.some((a) => a.type === 'ledger_draft')).toBe(true);
  });

  it('open_maintenance_case adapter validates + opens ticket', async () => {
    const payload = {
      unit_id: 'u_godown_3',
      summary: 'Bathroom tap is leaking',
      category: 'plumbing' as const,
      severity: 'medium' as const,
      description: 'Water dripping continuously since this morning',
      reporter_entity_id: 'cust_juma_x',
      source: { capture_id: 'cap_1', document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('open_maintenance_case', payload),
    };
    const result = await set.open_maintenance_case(args);
    expect(result.ok).toBe(true);
    expect(result.artifacts?.some((a) => a.type === 'maintenance_ticket')).toBe(
      true,
    );
  });

  it('schedule_renewal_negotiation adapter validates + creates assignment', async () => {
    const payload = {
      lease_id: 'le_juma_godown3',
      tenant_entity_id: 'cust_juma_x',
      unit_id: 'u_godown_3',
      target_start_date: '2026-07-01',
      rationale: 'Lease expires in 60 days — start renewal conversation',
      assigned_officer_id: null,
      priority: 'medium' as const,
      source: { capture_id: 'cap_1', document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('schedule_renewal_negotiation', payload),
    };
    const result = await set.schedule_renewal_negotiation(args);
    expect(result.ok).toBe(true);
    expect(result.artifacts?.some((a) => a.type === 'work_assignment')).toBe(
      true,
    );
  });

  it('bulk_mark_for_renewal_prep adapter validates + flags many', async () => {
    const payload = {
      lease_ids: ['le_1', 'le_2'],
      reason: 'Q3 renewal cohort',
      prep_window_days: 60,
      source: { capture_id: 'cap_1', document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('bulk_mark_for_renewal_prep', payload),
    };
    const result = await set.bulk_mark_for_renewal_prep(args);
    expect(result.ok).toBe(true);
    expect(
      result.artifacts?.filter((a) => a.type === 'lease_flagged').length,
    ).toBe(2);
  });

  it('rejects payload with Zod validation error → ok=false', async () => {
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('create_lease_application', { invalid: true }),
    };
    const result = await set.create_lease_application(args);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('payload_zod_invalid');
  });

  it('registry exposes all 5 actions', () => {
    const registry = createModuleHandlerRegistry({ estate: deps });
    for (const action of ESTATE_ACTIONS) {
      const h = registry.get('ESTATE', action);
      expect(h).toBeDefined();
    }
    expect(registry.listRegistered().length).toBe(5);
  });
});
