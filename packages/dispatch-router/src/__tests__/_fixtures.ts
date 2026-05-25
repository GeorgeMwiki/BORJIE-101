/**
 * Shared fixtures for the Wave-3-int2 cross-piece-wiring test suite.
 *
 * Kept separate from the existing `dispatch.test.ts` helpers so the
 * new tests can evolve their inputs without coupling to the older
 * piece-l test set.
 */

import { vi } from 'vitest';
import { createInMemoryAuditChainSink } from '../audit-link.js';
import {
  createInMemoryEventLogStore,
  createInMemoryProposalStore,
} from '../store.js';
import { createInMemoryRoutingRulesLoader } from '../dispatcher.js';
import type {
  ConversationCapture,
  PersonaContext,
  ResolvedEntity,
} from '../types.js';
import type { RoutingMatrixRow } from '../types.js';

export function mkCapture(
  overrides: Partial<ConversationCapture> = {},
): ConversationCapture {
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
    id: 'cap_wave3_1',
    tenant_id: 'trc',
    thread_id: 'thread_1',
    message_id: 'msg_1',
    persona_id: 'trc-emu-officer',
    user_id: 'u_officer',
    user_text: 'Mr Juma wants to lease godown 3 for 350k/month',
    assistant_text: 'I will start the application.',
    decision_kind: 'answer',
    entities,
    intent: 'propose_action',
    intent_confidence: 0.9,
    capture_confidence: 0.78,
    persona_trust: 0.85,
    tenant_trust: 0.9,
    attributes: {},
    exchange_hash: 'hash_w3_1',
    latency_ms: 0,
    created_at: '2026-05-23T10:00:00Z',
    ...overrides,
  };
}

export const persona: PersonaContext = {
  persona_id: 'trc-emu-officer',
  tier: 2,
  jurisdiction: 'TZ',
};

export const personaKE: PersonaContext = {
  persona_id: 'ke-officer',
  tier: 2,
  jurisdiction: 'KE',
};

export interface Wave3Deps {
  proposalStore: ReturnType<typeof createInMemoryProposalStore>;
  eventLog: ReturnType<typeof createInMemoryEventLogStore>;
  auditSink: ReturnType<typeof createInMemoryAuditChainSink>;
  routingRules: ReturnType<typeof createInMemoryRoutingRulesLoader>;
  randomId: () => string;
  clock: () => Date;
}

export function setupWave3Deps(): Wave3Deps {
  const proposalStore = createInMemoryProposalStore();
  const eventLog = createInMemoryEventLogStore();
  const auditSink = createInMemoryAuditChainSink();
  const routingRules = createInMemoryRoutingRulesLoader();
  let counter = 0;
  const randomId = () => `id_${++counter}`;
  const clock = () => new Date('2026-05-23T10:00:00Z');
  return { proposalStore, eventLog, auditSink, routingRules, randomId, clock };
}

export const bulkOpMatrixRow: RoutingMatrixRow = {
  id: 'L-ROW-BULK-1',
  entity_type: 'lease',
  intent: 'propose_action',
  module_template_id: 'ESTATE',
  action: 'bulk_mark_for_renewal_prep',
  min_confidence: 0.5,
  auto_apply_threshold: 0.6, // would normally auto-apply
  hitl_required: false, // platform-row says no HITL... but bulk_ ops force it
  priority: 'high',
  min_approver_tier: 2,
  jurisdiction: '*',
  tenant_scope: '*',
};

export const paymentObservationMatrixRow: RoutingMatrixRow = {
  id: 'L-ROW-PAY-1',
  entity_type: 'amount',
  intent: 'file_event',
  module_template_id: 'FINANCE',
  action: 'post_receipt_draft',
  min_confidence: 0.6,
  auto_apply_threshold: 0.95,
  hitl_required: true,
  priority: 'high',
  min_approver_tier: 3,
  jurisdiction: '*',
  tenant_scope: '*',
};

/**
 * Make a counter for ids that always emits the same sequence — useful when
 * a test wants deterministic ids without state shared across describe blocks.
 */
export function makeCounter(prefix = 'id'): () => string {
  let n = 0;
  return () => `${prefix}_${++n}`;
}

/** Spy helper for use by tests that need to assert call shape. */
export const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
