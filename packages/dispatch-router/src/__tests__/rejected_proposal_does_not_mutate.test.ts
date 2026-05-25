/**
 * Wave-3-int2 — declined proposals do not mutate downstream state.
 *
 * When a human approver hits "decline" on a pending_hitl proposal, the
 * accept handler MUST NOT be called. No downstream artefacts (ledger
 * entries, application drafts) may appear. The proposal status flips to
 * 'declined' and the audit chain records the decline.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  approveProposal,
  declineProposal,
  dispatchToTabs,
} from '../dispatch.js';
import { runDispatchPipeline } from '../dispatcher.js';
import { mkCapture, persona, setupWave3Deps } from './_fixtures.js';
import type {
  AcceptHandler,
  AcceptHandlerRegistry,
} from '../types.js';

describe('Wave-3-int2 rejected_proposal_does_not_mutate', () => {
  it('declineProposal does NOT call the handler', async () => {
    const deps = setupWave3Deps();

    // Set up a handler that records every call.
    const calls: Array<{ moduleTemplateId: string; action: string }> = [];
    const handler: AcceptHandler = async (args) => {
      calls.push({
        moduleTemplateId: args.proposal.module_template_id,
        action: args.proposal.action,
      });
      return { ok: true, artifacts: [{ type: 'test_artifact', id: 'x' }] };
    };
    const handlerRegistry: AcceptHandlerRegistry = {
      get() {
        return handler;
      },
    };

    // Create proposals.
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.7 }),
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );

    // Decline the first proposal.
    expect(result.proposals.length).toBeGreaterThan(0);
    const target = result.proposals[0]!;
    const callsBeforeDecline = calls.length;

    const declined = await declineProposal({
      tenant_id: 'trc',
      proposal_id: target.id,
      approver_user_id: 'u_approver_1',
      reason: 'wrong tenant — was meant for another property',
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });

    expect(declined.status).toBe('declined');
    expect(declined.decline_reason).toContain('wrong tenant');
    // The handler must NOT have been called by decline.
    expect(calls.length).toBe(callsBeforeDecline);
  });

  it('declined proposal cannot then be approved', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry: AcceptHandlerRegistry = {
      get() {
        return async () => ({ ok: true });
      },
    };
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.7 }),
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );
    const target = result.proposals[0]!;
    await declineProposal({
      tenant_id: 'trc',
      proposal_id: target.id,
      approver_user_id: 'u_approver_1',
      reason: 'mistaken intent',
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });
    await expect(
      approveProposal({
        tenant_id: 'trc',
        proposal_id: target.id,
        approver_user_id: 'u_approver_1',
        approver_tier: 2,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        auditSink: deps.auditSink,
        eventLog: deps.eventLog,
      }),
    ).rejects.toThrow(/cannot be approved/);
  });

  it('declined proposal records audit row with action=proposal_declined', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry: AcceptHandlerRegistry = {
      get() {
        return async () => ({ ok: true });
      },
    };
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.7 }),
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );
    const target = result.proposals[0]!;
    await declineProposal({
      tenant_id: 'trc',
      proposal_id: target.id,
      approver_user_id: 'u_approver_1',
      reason: 'audit-check',
      proposalStore: deps.proposalStore,
      auditSink: deps.auditSink,
      eventLog: deps.eventLog,
    });
    const chain = deps.auditSink.snapshot('trc');
    const declined = chain.find((r) => r.action === 'proposal_declined');
    expect(declined).toBeDefined();
    expect(declined!.payload['reason']).toBe('audit-check');
  });
});
