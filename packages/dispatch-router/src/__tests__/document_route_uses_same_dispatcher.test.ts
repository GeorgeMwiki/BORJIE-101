/**
 * Wave-3-int2 — Piece K document route uses the unified dispatcher.
 *
 * A document analysed by Piece K's pipeline must be dispatched through
 * the SAME `runDispatchPipeline` that chat captures use. This test:
 *   1. Builds a synthetic `ConversationCapture` shaped like a document
 *      bridge would emit (mimicking `buildCaptureFromDocument`).
 *   2. Runs `runDispatchPipeline`.
 *   3. Verifies a proposal lands on the DOCUMENTS module template id.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline } from '../dispatcher.js';
import { setupWave3Deps } from './_fixtures.js';
import type {
  ConversationCapture,
  PersonaContext,
  ResolvedEntity,
} from '../types.js';

const docPersona: PersonaContext = {
  persona_id: 'doc-analyser',
  tier: 2,
  jurisdiction: 'TZ',
};

function mkDocCapture(): ConversationCapture {
  const entities: ResolvedEntity[] = [
    {
      type: 'document',
      canonical_id: 'doc_lease_app_123',
      raw_value: 'lease_application',
      confidence: 0.92,
      source: 'doc_self',
    },
    {
      type: 'customer',
      canonical_id: 'cust_juma_x',
      raw_value: 'Mr Juma',
      confidence: 0.85,
      source: 'document_resolved',
    },
  ];
  return {
    id: 'doc_cap_lease_123',
    tenant_id: 'trc',
    thread_id: null,
    message_id: null,
    persona_id: docPersona.persona_id,
    user_id: null,
    user_text: '[document doc_lease_app_123]',
    assistant_text: '[classified lease_application]',
    decision_kind: 'answer',
    entities,
    intent: 'propose_action',
    intent_confidence: 0.92,
    capture_confidence: 0.92,
    persona_trust: 0.9,
    tenant_trust: 0.85,
    attributes: {
      origin: 'document',
      doc_type: 'lease_application',
      document_id: 'doc_lease_app_123',
    },
    exchange_hash: 'doc-doc_lease_app_123-lease_application',
    latency_ms: 0,
    created_at: '2026-05-23T10:00:00Z',
  };
}

describe('Wave-3-int2 document_route_uses_same_dispatcher', () => {
  it('runs a document capture through runDispatchPipeline + emits proposals on DOCUMENTS', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkDocCapture(),
        persona: docPersona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );

    // L-ROW-13: document + propose_action → DOCUMENTS.classify_document
    const classify = result.proposals.find(
      (p) => p.module_template_id === 'DOCUMENTS' && p.action === 'classify_document',
    );
    expect(classify).toBeDefined();
    // And the document attributes should be carried on the capture.
    expect(classify!.payload.intent).toBe('propose_action');
  });

  it('document capture is routed through the same matrix-merge step (tenant override applies)', async () => {
    const deps = setupWave3Deps();
    deps.routingRules.store.add({
      id: 'OVERRIDE_DOC_1',
      entity_type: 'document',
      intent: 'propose_action',
      module_template_id: 'DOCUMENTS',
      action: 'classify_document',
      min_confidence: 0.5,
      auto_apply_threshold: 0.95,
      hitl_required: true,
      priority: 'critical',
      min_approver_tier: 1,
      jurisdiction: '*',
      tenant_scope: 'trc',
    });

    const handlerRegistry = createStubHandlerRegistry();
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkDocCapture(),
        persona: docPersona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );

    const classify = result.proposals.find(
      (p) => p.action === 'classify_document',
    );
    expect(classify).toBeDefined();
    // Tenant override row wins — priority must be 'critical' not 'low'.
    expect(classify!.priority).toBe('critical');
  });
});
