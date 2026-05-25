/**
 * Dispatch edge cases — handler missing, auto-apply failure path, etc.
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
} from '../types.js';

function mkCapture(overrides: Partial<ConversationCapture> = {}): ConversationCapture {
  return {
    id: 'cap_1',
    tenant_id: 'trc',
    thread_id: null,
    message_id: null,
    persona_id: 'p1',
    user_id: null,
    user_text: 'u',
    assistant_text: 'a',
    decision_kind: 'answer',
    entities: [
      {
        type: 'lease',
        canonical_id: 'le_1',
        raw_value: 'le_1',
        confidence: 0.95,
        source: 'exact_name',
      },
    ],
    intent: 'file_event',
    intent_confidence: 0.9,
    capture_confidence: 0.95,
    persona_trust: 0.85,
    tenant_trust: 0.9,
    attributes: {},
    exchange_hash: 'h1',
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

describe('approveProposal — error paths', () => {
  it('throws when proposal not found', async () => {
    const proposalStore = createInMemoryProposalStore();
    const auditSink = createInMemoryAuditChainSink();
    const eventLog = createInMemoryEventLogStore();
    const handlerRegistry = createStubHandlerRegistry();
    await expect(
      approveProposal({
        tenant_id: 't',
        proposal_id: 'missing',
        approver_user_id: 'u',
        approver_tier: 2,
        handlerRegistry,
        proposalStore,
        auditSink,
        eventLog,
      }),
    ).rejects.toThrow(/not found/);
  });

  it('throws when proposal already declined', async () => {
    const proposalStore = createInMemoryProposalStore();
    const auditSink = createInMemoryAuditChainSink();
    const eventLog = createInMemoryEventLogStore();
    const handlerRegistry = createStubHandlerRegistry();
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          capture_confidence: 0.7,
          intent: 'propose_action',
          entities: [
            {
              type: 'customer',
              canonical_id: 'cust_1',
              raw_value: 'X',
              confidence: 0.9,
              source: 'exact_name',
            },
          ],
        }),
        persona,
        handlerRegistry,
      },
      { proposalStore, eventLog, auditSink },
    );
    await declineProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u',
      reason: 'no',
      proposalStore,
      auditSink,
      eventLog,
    });
    await expect(
      approveProposal({
        tenant_id: 'trc',
        proposal_id: first!.id,
        approver_user_id: 'u',
        approver_tier: 2,
        handlerRegistry,
        proposalStore,
        auditSink,
        eventLog,
      }),
    ).rejects.toThrow(/cannot be approved/);
  });

  it('marks proposal failed when handler missing', async () => {
    const proposalStore = createInMemoryProposalStore();
    const auditSink = createInMemoryAuditChainSink();
    const eventLog = createInMemoryEventLogStore();
    const handlerRegistry = createStubHandlerRegistry();
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          capture_confidence: 0.7,
          intent: 'propose_action',
          entities: [
            {
              type: 'customer',
              canonical_id: 'cust_1',
              raw_value: 'X',
              confidence: 0.9,
              source: 'exact_name',
            },
          ],
        }),
        persona,
        handlerRegistry,
      },
      { proposalStore, eventLog, auditSink },
    );
    // Build an empty registry without overrides; default stub still exists,
    // so simulate missing by passing an empty registry that returns undefined.
    const emptyRegistry = {
      get() {
        return undefined;
      },
    };
    const failed = await approveProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u',
      approver_tier: 2,
      handlerRegistry: emptyRegistry,
      proposalStore,
      auditSink,
      eventLog,
    });
    expect(failed.status).toBe('failed');
    expect(failed.failure_reason).toMatch(/no handler/);
  });
});

describe('declineProposal — error paths', () => {
  it('throws when proposal not found', async () => {
    const proposalStore = createInMemoryProposalStore();
    const auditSink = createInMemoryAuditChainSink();
    const eventLog = createInMemoryEventLogStore();
    await expect(
      declineProposal({
        tenant_id: 't',
        proposal_id: 'missing',
        approver_user_id: 'u',
        reason: 'x',
        proposalStore,
        auditSink,
        eventLog,
      }),
    ).rejects.toThrow(/not found/);
  });
});

describe('editProposal — error paths', () => {
  it('throws when proposal not pending_hitl', async () => {
    const proposalStore = createInMemoryProposalStore();
    const auditSink = createInMemoryAuditChainSink();
    const eventLog = createInMemoryEventLogStore();
    const handlerRegistry = createStubHandlerRegistry();
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          capture_confidence: 0.7,
          intent: 'propose_action',
          entities: [
            {
              type: 'customer',
              canonical_id: 'cust_1',
              raw_value: 'X',
              confidence: 0.9,
              source: 'exact_name',
            },
          ],
        }),
        persona,
        handlerRegistry,
      },
      { proposalStore, eventLog, auditSink },
    );
    await declineProposal({
      tenant_id: 'trc',
      proposal_id: first!.id,
      approver_user_id: 'u',
      reason: 'no',
      proposalStore,
      auditSink,
      eventLog,
    });
    await expect(
      editProposal({
        tenant_id: 'trc',
        proposal_id: first!.id,
        editor_user_id: 'u',
        new_payload: {},
        edit_summary: 'x',
        proposalStore,
        auditSink,
        eventLog,
      }),
    ).rejects.toThrow(/cannot be edited/);
  });
});

describe('dispatchToTabs — auto-apply failure path', () => {
  it('flips status to failed when auto-apply handler returns ok=false', async () => {
    const proposalStore = createInMemoryProposalStore();
    const auditSink = createInMemoryAuditChainSink();
    const eventLog = createInMemoryEventLogStore();
    const failingHandler = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'invalid lease state' });
    const handlerRegistry = createStubHandlerRegistry({
      overrides: { 'ESTATE.append_lease_event': failingHandler },
    });
    const [first] = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
        handlerRegistry,
      },
      { proposalStore, eventLog, auditSink },
    );
    expect(failingHandler).toHaveBeenCalled();
    const refreshed = await proposalStore.findById('trc', first!.id);
    expect(refreshed?.status).toBe('failed');
    expect(refreshed?.failure_reason).toBe('invalid lease state');
  });

  it('uses default ttl when not overridden', async () => {
    const proposalStore = createInMemoryProposalStore();
    const auditSink = createInMemoryAuditChainSink();
    const eventLog = createInMemoryEventLogStore();
    const handlerRegistry = createStubHandlerRegistry();
    const clock = () => new Date('2026-05-22T10:00:00Z');
    const proposals = await dispatchToTabs(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          intent: 'propose_action',
          entities: [
            {
              type: 'customer',
              canonical_id: 'cust_1',
              raw_value: 'X',
              confidence: 0.9,
              source: 'exact_name',
            },
          ],
        }),
        persona,
        handlerRegistry,
      },
      { proposalStore, eventLog, auditSink, clock },
    );
    expect(proposals.length).toBeGreaterThan(0);
    const expiresAt = new Date(proposals[0]!.expires_at!);
    const expected = new Date('2026-05-29T10:00:00Z'); // +7 days
    expect(expiresAt.getTime()).toBe(expected.getTime());
  });
});
