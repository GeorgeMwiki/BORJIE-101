/**
 * ESTATE 2-handler adapter + MINING 3-handler adapter smoke tests.
 *
 * Verifies each adapter:
 *   - validates its payload via Zod
 *   - invokes the underlying pure handler with the right ctx
 *   - returns the dispatcher-compatible `AcceptHandlerResult` shape
 *
 * Closes issue #34 — the 3 pre-Borjie estate handlers
 * (open_maintenance_case, schedule_renewal_negotiation,
 * bulk_mark_for_renewal_prep) were ported to mining-domain equivalents
 * (open_equipment_maintenance, schedule_licence_renewal,
 * bulk_mark_licences_for_renewal). The previous test suite that
 * exercised those 3 stub adapters is replaced by the MINING block below.
 */

import { describe, it, expect } from 'vitest';
import {
  buildEstateHandlerSet,
  ESTATE_ACTIONS,
} from '../estate/accept-proposal-handlers.js';
import {
  buildMiningHandlerSet,
  MINING_ACTIONS,
} from '../mining/accept-proposal-handlers.js';
import { createModuleHandlerRegistry } from '../registry.js';
import type {
  AcceptHandlerArgs,
  ModuleUpdateProposal,
} from '@borjie/dispatch-router';
import type { EstateHandlerDeps } from '../estate/accept-proposal-handlers.js';
import type { MiningHandlerDeps } from '../mining/accept-proposal-handlers.js';

function mkEstateDeps(): EstateHandlerDeps {
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
  };
}

function mkMiningDeps(): MiningHandlerDeps {
  const auditChain = {
    async append() {
      return { id: 'audit_mining_stub_1' };
    },
  };
  const notifications = {
    async publish() {
      /* noop */
    },
  };
  let idCounter = 0;
  const ids = {
    newId(prefix: string): string {
      idCounter += 1;
      return `${prefix}_stub_${idCounter}`;
    },
  };
  return {
    moduleId: 'MINING',
    clock: {
      nowIso: () => '2026-05-26T00:00:00.000Z',
      todayIso: () => '2026-05-26T00:00:00.000Z',
    },
    scheduleLicenceRenewal: {
      tasks: {
        async insert() {
          return { id: 'task_lr_1' };
        },
      },
      temporalEntities: {
        async insert() {
          return { id: 'te_lr_1' };
        },
      },
      auditChain,
      notifications,
      ids,
    },
    openEquipmentMaintenance: {
      maintenanceEvents: {
        async insert() {
          return { id: 'me_em_1' };
        },
      },
      tasks: {
        async insert() {
          return { id: 'task_em_1' };
        },
      },
      auditChain,
      notifications,
      ids,
    },
    bulkMarkLicencesForRenewal: {
      licenceTasks: {
        async bulkCreateRenewalTasks(args) {
          return {
            created: args.licenceIds.map((licenceId) => ({
              licenceId,
              taskId: `task_for_${licenceId}`,
            })),
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
    module_template_id: action.startsWith('open_equipment_')
      || action.startsWith('schedule_licence_')
      || action.startsWith('bulk_mark_licences_')
      ? 'MINING'
      : 'ESTATE',
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

// ───────────────────────────────────────────────────────────────────────────
// ESTATE — 2 surviving adapters
// ───────────────────────────────────────────────────────────────────────────

describe('ESTATE 2-handler adapters', () => {
  const deps = mkEstateDeps();
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
    expect(
      result.artifacts?.some((a) => a.type === 'lease_application'),
    ).toBe(true);
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

  it('rejects payload with Zod validation error → ok=false', async () => {
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('create_lease_application', { invalid: true }),
    };
    const result = await set.create_lease_application(args);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('payload_zod_invalid');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// MINING — 3 adapters (replaces the 3 pre-Borjie estate stubs)
// ───────────────────────────────────────────────────────────────────────────

describe('MINING 3-handler adapters', () => {
  const deps = mkMiningDeps();
  const set = buildMiningHandlerSet(deps);

  it('schedule_licence_renewal adapter validates + writes', async () => {
    const payload = {
      licence_id: 'lic_pml_001',
      company_id: 'co_borjie_demo',
      site_id: 'site_dar_1',
      target_start_date: '2026-07-01',
      rationale: 'Licence expires in 60 days — schedule renewal action',
      assigned_user_id: null,
      priority: 3,
      followup_cadence: 'weekly' as const,
      evidence_ids: ['doc_assay_001'],
      source: { capture_id: 'cap_1', document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('schedule_licence_renewal', payload),
    };
    const result = await set.schedule_licence_renewal(args);
    expect(result.ok).toBe(true);
    expect(result.artifacts?.some((a) => a.type === 'task')).toBe(true);
    expect(result.artifacts?.some((a) => a.type === 'temporal_entity')).toBe(
      true,
    );
  });

  it('open_equipment_maintenance adapter validates + opens event', async () => {
    const payload = {
      asset_id: 'asset_excavator_1',
      site_id: 'site_dar_1',
      summary: 'Hydraulic line leaking on bucket',
      kind: 'breakdown' as const,
      severity: 'high' as const,
      description: 'Operator noticed leak at 0900',
      scheduled_for: '2026-05-27T08:00:00.000Z',
      estimated_downtime_hours: 6,
      reporter_user_id: 'usr_operator_1',
      evidence_ids: ['photo_leak_001'],
      source: { capture_id: 'cap_1', document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('open_equipment_maintenance', payload),
    };
    const result = await set.open_equipment_maintenance(args);
    expect(result.ok).toBe(true);
    expect(result.artifacts?.some((a) => a.type === 'maintenance_event')).toBe(
      true,
    );
    expect(result.artifacts?.some((a) => a.type === 'task')).toBe(true);
  });

  it('bulk_mark_licences_for_renewal adapter flags many', async () => {
    const payload = {
      licence_ids: ['lic_1', 'lic_2', 'lic_3'],
      reason: 'Q3 PML renewal cohort',
      prep_window_days: 60,
      followup_cadence: 'weekly' as const,
      source: { capture_id: 'cap_1', document_id: null },
    };
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('bulk_mark_licences_for_renewal', payload),
    };
    const result = await set.bulk_mark_licences_for_renewal(args);
    expect(result.ok).toBe(true);
    expect(result.artifacts?.filter((a) => a.type === 'task').length).toBe(3);
  });

  it('rejects mining payload with Zod validation error → ok=false', async () => {
    const args: AcceptHandlerArgs = {
      tenant_id: 'trc',
      proposal: mkProposal('schedule_licence_renewal', { invalid: true }),
    };
    const result = await set.schedule_licence_renewal(args);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('payload_zod_invalid');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Cross-module registry — both ESTATE and MINING
// ───────────────────────────────────────────────────────────────────────────

describe('createModuleHandlerRegistry', () => {
  it('registers all 2 ESTATE actions when only estate deps provided', () => {
    const registry = createModuleHandlerRegistry({ estate: mkEstateDeps() });
    for (const action of ESTATE_ACTIONS) {
      expect(registry.get('ESTATE', action)).toBeDefined();
    }
    expect(registry.listRegistered().length).toBe(2);
  });

  it('registers all 2 ESTATE + 3 MINING actions when both deps provided', () => {
    const registry = createModuleHandlerRegistry({
      estate: mkEstateDeps(),
      mining: mkMiningDeps(),
    });
    for (const action of ESTATE_ACTIONS) {
      expect(registry.get('ESTATE', action)).toBeDefined();
    }
    for (const action of MINING_ACTIONS) {
      expect(registry.get('MINING', action)).toBeDefined();
    }
    expect(registry.listRegistered().length).toBe(5);
  });
});
