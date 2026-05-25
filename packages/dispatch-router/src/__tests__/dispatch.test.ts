/**
 * Dispatch + HITL tests — matrix walk, auto-apply gate, approve/decline/edit.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  approveProposal,
  declineProposal,
  dispatchToTabs,
  editProposal,
} from '../dispatch.js';
import { createInMemoryAuditChainSink } from '../audit-link.js';
import { createStubHandlerRegistry } from '../handler-registry.js';
import {
  createInMemoryEventLogStore,
  createInMemoryProposalStore,
} from '../store.js';
import type {
  ConversationCapture,
  PersonaContext,
  ResolvedEntity,
} from '../types.js';

function mkCapture(overrides: Partial<ConversationCapture> = {}): ConversationCapture {
  const entities: ResolvedEntity[] = [
    {
      type: 'customer',
      canonical_id: 'cust_juma_x',
      raw_value: 'Mr Juma',
      confidence: 0.9,
      source: 'exact_name',
    },
    {
      type: 'unit',
      canonical_id: 'u_godown_3',
      raw_value: 'godown 3',
      confidence: 0.85,
      source: 'exact_name',
    },
  ];
  return {
    id: 'cap_test_1',
    tenant_id: 'trc',
    thread_id: 'thread_1',
    message_id: 'msg_1',
    persona_id: 'trc-emu-officer',
    user_id: 'u_officer',
    user_text: 'Mr Juma wants to lease godown 3 for 350k/month from Jan',
    assistant_text: 'I will start the application.',
    decision_kind: 'answer',
    entities,
    intent: 'propose_action',
    intent_confidence: 0.9,
    capture_confidence: 0.7,
    persona_trust: 0.85,
    tenant_trust: 0.9,
    attributes: {},
    exchange_hash: 'hash_1',
    latency_ms: 0,
    created_at: '2026-05-22T10:00:00Z',
    ...overrides,
  };
}

const persona: PersonaContext = {
  persona_id: 'trc-emu-officer',
  tier: 2,
  jurisdiction: 'TZ',
};

function setupDeps() {
  const proposalStore = createInMemoryProposalStore();
  const eventLog = createInMemoryEventLogStore();
  const auditSink = createInMemoryAuditChainSink();
  let counter = 0;
  const randomId = () => `id_${++counter}`;
  const clock = () => new Date('2026-05-22T10:00:00Z');
  return { proposalStore, eventLog, auditSink, randomId, clock };
}

describe('dispatchToTabs', () => {
  it('creates proposals for matching matrix rows', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const proposals = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      deps,
    );
    expect(proposals.length).toBeGreaterThan(0);
    // Mr Juma + propose_action → ESTATE.create_lease_application (L-ROW-01)
    const lease = proposals.find(
      (p) =>
        p.module_template_id === 'ESTATE' &&
        p.action === 'create_lease_application',
    );
    expect(lease).toBeDefined();
  });

  it('marks low-confidence proposal pending_hitl', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const proposals = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.7 }),
        persona,
        handlerRegistry,
      },
      deps,
    );
    expect(
      proposals.every(
        (p) => p.status === 'pending_hitl' || p.status === 'auto_applying',
      ),
    ).toBe(true);
    const lease = proposals.find(
      (p) => p.action === 'create_lease_application',
    );
    expect(lease?.status).toBe('pending_hitl');
  });

  it('skips rules with min_confidence above capture confidence', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const proposals = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.1 }),
        persona,
        handlerRegistry,
      },
      deps,
    );
    // Every row has min_confidence > 0.6
    expect(proposals.length).toBe(0);
  });

  it('auto-applies high-confidence proposals where hitl_required=false', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    // Lease event with confidence above auto-apply threshold (0.85)
    const proposals = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          intent: 'file_event',
          capture_confidence: 0.95,
          entities: [
            {
              type: 'lease',
              canonical_id: 'le_juma_godown3',
              raw_value: 'le_juma_godown3',
              confidence: 0.95,
              source: 'exact_name',
            },
          ],
        }),
        persona,
        handlerRegistry,
      },
      deps,
    );
    // ESTATE.append_lease_event (L-ROW-03) — hitl_required=false, threshold 0.85.
    const lease = proposals.find((p) => p.action === 'append_lease_event');
    expect(lease).toBeDefined();
    // It should have flipped to accepted after auto-apply via handler.
    const refreshed = await deps.proposalStore.findById('trc', lease!.id);
    expect(refreshed?.status).toBe('accepted');
  });

  it('respects jurisdiction filter (TRC-EMU only fires for TZ)', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const proposals = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          intent: 'propose_action',
        }),
        persona: { ...persona, jurisdiction: 'KE' }, // not TZ
        handlerRegistry,
      },
      deps,
    );
    const trcRows = proposals.filter(
      (p) => p.module_template_id === 'TRC-EMU',
    );
    expect(trcRows.length).toBe(0);
  });

  it('hash-chains an audit row per proposal', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const proposals = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      deps,
    );
    const chain = deps.auditSink.snapshot('trc');
    // At least one chain row per proposal (proposal_created)
    expect(chain.filter((c) => c.action === 'proposal_created').length).toBe(
      proposals.length,
    );
  });
});

describe('approveProposal', () => {
  it('flips status to accepted and calls the handler', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      deps,
    );
    expect(first?.status).toBe('pending_hitl');

    const approved = await approveProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u_emu_officer',
      approver_tier: 2,
      handlerRegistry,
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
      clock: deps.clock,
      randomId: deps.randomId,
    });
    expect(approved.status).toBe('accepted');
    expect(approved.approver_user_id).toBe('u_emu_officer');
  });

  it('is idempotent for already-accepted proposals', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      deps,
    );
    await approveProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u_emu_officer',
      approver_tier: 2,
      handlerRegistry,
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });
    // Second call returns the existing row, no error.
    const again = await approveProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u_emu_officer',
      approver_tier: 2,
      handlerRegistry,
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });
    expect(again.status).toBe('accepted');
  });

  it('marks proposal failed when handler returns ok=false', async () => {
    const deps = setupDeps();
    const failingHandler = vi.fn().mockResolvedValue({
      ok: false,
      error: 'unit already leased',
    });
    const handlerRegistry = createStubHandlerRegistry({
      overrides: {
        'ESTATE.create_lease_application': failingHandler,
      },
    });
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      deps,
    );
    const result = await approveProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u_emu_officer',
      approver_tier: 2,
      handlerRegistry,
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });
    expect(result.status).toBe('failed');
    expect(result.failure_reason).toBe('unit already leased');
  });
});

describe('declineProposal', () => {
  it('flips status to declined with a reason', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      deps,
    );
    const declined = await declineProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u_emu_officer',
      reason: 'unit reserved for owner use',
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });
    expect(declined.status).toBe('declined');
    expect(declined.decline_reason).toBe('unit reserved for owner use');
  });
});

describe('editProposal', () => {
  it('closes original and creates new pending row', async () => {
    const deps = setupDeps();
    const handlerRegistry = createStubHandlerRegistry();
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      deps,
    );
    const edited = await editProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      editor_user_id: 'u_emu_officer',
      new_payload: { ...first!.payload, monthly_rent_tzs: 400_000 },
      edit_summary: 'bumped rent from 350k to 400k',
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });
    expect(edited.id).not.toBe(first!.id);
    expect(edited.edited_from_id).toBe(first!.id);
    expect(edited.status).toBe('pending_hitl');
    const closed = await deps.proposalStore.findById('trc', first!.id);
    expect(closed?.status).toBe('edited');
  });
});
