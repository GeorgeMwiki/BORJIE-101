/**
 * E2E TRC lease-application demo — the canonical Piece L happy path.
 *
 * Scenario:
 *   TRC tenant + EMU officer persona + a customer entity ("Mr Juma") +
 *   a unit entity ("godown 3").
 *
 *   The officer says:
 *     "Mr Juma wants to lease godown 3 for 350k/month starting Jan"
 *
 *   Pipeline:
 *     1. capture() resolves entities + classifies intent
 *     2. dispatchToTabs() walks the routing matrix and creates a
 *        ESTATE.create_lease_application proposal in status=pending_hitl
 *        (HITL required since the row is high-risk + confidence < 0.92)
 *     3. EMU officer approves
 *     4. accept_proposal handler called → row flips to accepted
 *     5. Audit chain shows: capture_emitted → proposal_created →
 *        proposal_pending_hitl → proposal_approved
 */

import { describe, it, expect } from 'vitest';
import { capture } from '../capture.js';
import { approveProposal, dispatchToTabs } from '../dispatch.js';
import { createInMemoryAuditChainSink } from '../audit-link.js';
import { createInMemoryCanonicalResolver } from '../canonical-resolver.js';
import { createIntentClassifier } from '../intent-classifier.js';
import {
  createInMemoryCaptureStore,
  createInMemoryEventLogStore,
  createInMemoryProposalStore,
} from '../store.js';
import { createStubHandlerRegistry } from '../handler-registry.js';
import type { PersonaContext } from '../types.js';

describe('E2E: TRC EMU officer requests godown 3 lease for Mr Juma', () => {
  it('completes the full brain↔tab loop: capture → dispatch → HITL → accept', async () => {
    // ─── Setup: seed canonical entities for the TRC tenant ──────────
    const tenantId = 'trc-tz-pilot';
    const { store: resolverStore, resolver } = createInMemoryCanonicalResolver();
    resolverStore.add({
      tenant_id: tenantId,
      type: 'customer',
      canonical_id: 'cust_juma_x',
      canonical_name: 'Juma',
      aliases: ['Mr Juma', 'Juma Mwakipesile'],
    });
    resolverStore.add({
      tenant_id: tenantId,
      type: 'unit',
      canonical_id: 'u_godown_3',
      canonical_name: 'godown 3',
      aliases: ['Godown 3', 'GD-3'],
    });

    // ─── Persona: TRC EMU officer (tier 2 — M-tier operator) ────────
    const persona: PersonaContext = {
      persona_id: 'trc-emu-officer',
      tier: 2,
      jurisdiction: 'TZ',
    };

    // ─── In-memory infra ───────────────────────────────────────────
    const captureStore = createInMemoryCaptureStore();
    const proposalStore = createInMemoryProposalStore();
    const eventLog = createInMemoryEventLogStore();
    const auditSink = createInMemoryAuditChainSink();
    const classifier = createIntentClassifier({ disableCache: true });
    const handlerRegistry = createStubHandlerRegistry();

    let counter = 0;
    const randomId = () => `id_${++counter}`;
    const clock = () => new Date('2026-05-22T10:00:00Z');

    // ─── 1. Capture the exchange ─────────────────────────────────
    const userUtterance =
      'Mr Juma wants to lease godown 3 for 350k/month starting Jan';
    const assistantReply =
      'Understood — I will start a lease application for Mr Juma in godown 3 at TZS 350,000/month from January.';

    const captureResult = await capture(
      {
        tenant_id: tenantId,
        persona,
        user_text: userUtterance,
        assistant_text: assistantReply,
        decision_kind: 'answer',
        thread_id: 'thread_trc_demo_1',
        message_id: 'msg_demo_1',
        user_id: 'u_emu_officer_001',
      },
      {
        resolver,
        classifier,
        captureStore,
        eventLog,
        auditSink,
        randomId,
        clock,
      },
    );

    // Assert: capture row was inserted.
    expect(captureResult.deduplicated).toBe(false);
    expect(captureResult.shouldDispatch).toBe(true);

    // Assert: entities resolved correctly.
    const customerEntity = captureResult.capture.entities.find(
      (e) => e.type === 'customer',
    );
    expect(customerEntity?.canonical_id).toBe('cust_juma_x');
    const unitEntity = captureResult.capture.entities.find(
      (e) => e.type === 'unit',
    );
    expect(unitEntity?.canonical_id).toBe('u_godown_3');

    // Assert: intent is propose_action.
    expect(captureResult.capture.intent).toBe('propose_action');

    // Assert: capture confidence below auto-apply but above router threshold.
    expect(captureResult.capture.capture_confidence).toBeGreaterThan(0.55);
    expect(captureResult.capture.capture_confidence).toBeLessThan(0.92);

    // ─── 2. Dispatch — walk the matrix ──────────────────────────
    const proposals = await dispatchToTabs(
      {
        tenant_id: tenantId,
        capture: captureResult.capture,
        persona,
        handlerRegistry,
      },
      {
        proposalStore,
        eventLog,
        auditSink,
        randomId,
        clock,
      },
    );

    // Assert: at least one ESTATE.create_lease_application proposal exists.
    const leaseProposal = proposals.find(
      (p) =>
        p.module_template_id === 'ESTATE' &&
        p.action === 'create_lease_application',
    );
    expect(leaseProposal).toBeDefined();
    expect(leaseProposal?.status).toBe('pending_hitl');
    expect(leaseProposal?.priority).toBe('high');
    expect(leaseProposal?.hitl_required).toBe(true);

    // Assert: proposal payload carries the resolved entity refs.
    const payloadAny = leaseProposal?.payload as Record<string, unknown>;
    const primary = payloadAny.primary_entity as {
      readonly type: string;
      readonly canonical_id: string;
    };
    expect(primary.canonical_id).toMatch(/cust_juma_x|u_godown_3/);

    // Assert: audit chain has capture_emitted + proposal_created.
    const chainAfterDispatch = auditSink.snapshot(tenantId);
    const actions = chainAfterDispatch.map((c) => c.action);
    expect(actions).toContain('capture_emitted');
    expect(actions).toContain('proposal_created');

    // ─── 3. EMU officer approves the lease proposal ─────────────
    const approved = await approveProposal({
      tenant_id: tenantId,
      proposal_id: leaseProposal!.id,
      approver_user_id: 'u_emu_officer_001',
      approver_tier: 2,
      handlerRegistry,
      proposalStore,
      auditSink,
      eventLog,
      randomId,
      clock,
    });

    expect(approved.status).toBe('accepted');
    expect(approved.approver_user_id).toBe('u_emu_officer_001');
    expect(approved.approver_tier).toBe(2);

    // ─── 4. Assert: handler was invoked ────────────────────────
    const invocations = handlerRegistry.listInvocations?.() ?? [];
    expect(invocations.length).toBeGreaterThanOrEqual(1);
    const leaseInvocation = invocations.find(
      (inv) =>
        inv.proposal.module_template_id === 'ESTATE' &&
        inv.proposal.action === 'create_lease_application',
    );
    expect(leaseInvocation).toBeDefined();
    expect(leaseInvocation?.tenant_id).toBe(tenantId);

    // ─── 5. Assert: audit chain shows full timeline ────────────
    const finalChain = auditSink.snapshot(tenantId);
    const finalActions = finalChain.map((c) => c.action);
    expect(finalActions).toContain('capture_emitted');
    expect(finalActions).toContain('proposal_created');
    expect(finalActions).toContain('proposal_approved');

    // Verify each chain link references the previous.
    for (let i = 1; i < finalChain.length; i++) {
      const prev = finalChain[i - 1];
      const curr = finalChain[i];
      expect(curr?.prev_hash).toBe(prev?.this_hash);
    }

    // ─── 6. Assert: tab event log captures the transitions ─────
    const events = await eventLog.listByProposal(tenantId, leaseProposal!.id);
    const eventKinds = events.map((e) => e.event_kind);
    expect(eventKinds).toContain('proposal_created');
    expect(eventKinds).toContain('proposal_pending_hitl');
    expect(eventKinds).toContain('proposal_approved');

    // Demo log (printed when running with --reporter=verbose).
    // eslint-disable-next-line no-console
    console.info('TRC EMU LEASE-APPLICATION DEMO PASSED', {
      capture_id: captureResult.capture.id,
      proposal_id: leaseProposal!.id,
      capture_confidence: captureResult.capture.capture_confidence,
      proposal_status: approved.status,
      audit_chain_length: finalChain.length,
      event_log_length: events.length,
    });
  });
});
