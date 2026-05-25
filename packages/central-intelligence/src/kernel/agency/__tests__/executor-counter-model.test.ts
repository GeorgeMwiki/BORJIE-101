/**
 * Tests for the counter-model integration in createExecutor.
 *
 * Central Command Phase B (B5) — the executor consults a second LLM
 * BEFORE the four-eye approval gate fires when the tool is sovereign-
 * tier. The test cases pin the contract:
 *
 *   1. Counter-model `safe` verdict → executor proceeds with the
 *      normal approval flow; the gate sees the original payload.
 *   2. Counter-model `risky` verdict → executor proceeds with the
 *      approval flow; the gate sees the `_counterModel` attachment in
 *      the payload so the human approver gets the second opinion.
 *   3. Counter-model `refuse` verdict → executor aborts the step with
 *      `counter-model-refused` outcome; the approval gate is NEVER
 *      called for the refused step.
 *   4. Counter-model NOT invoked for non-sovereign tools — the cheap
 *      model only fires on the narrow destructive surface.
 *   5. Counter-model adapter throw → executor defaults to `risky`
 *      and proceeds (safer than failing-open OR failing-closed).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createExecutor,
  createInMemoryActionAuditSink,
} from '../executor/index.js';
import { createInMemoryGoalsPort } from '../goals/goal-tracker.js';
import {
  createActionToolRegistry,
  type ActionToolDef,
} from '../action-tools/index.js';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
} from '../../four-eye-approval.js';
import type { AutonomyPolicyPort } from '../executor/autonomy-policy.js';
import type {
  CounterModel,
  CounterModelReviewOutcome,
  CounterModelVerdict,
} from '../../counter-model/index.js';

function approvalPolicy(): AutonomyPolicyPort {
  return {
    async decide() {
      return {
        authorized: true,
        requiresApproval: true,
        reason: 'requires-approval',
      };
    },
  };
}

function autonomousPolicy(): AutonomyPolicyPort {
  return {
    async decide() {
      return {
        authorized: true,
        requiresApproval: false,
        reason: 'autonomous',
      };
    },
  };
}

/** A tool whose `name` is on the SOVEREIGN_TIER_ACTION_NAMES deny-list
 *  (see `isSovereignTier`) so the counter-model path is exercised even
 *  though stakes are 'high'. */
function evictionTool(): ActionToolDef {
  return {
    name: 'tenant-eviction-proposed',
    description: 'Sovereign-tier eviction proposal.',
    stakes: 'high',
    inputSchema: {},
    async invoke() {
      return { ok: true as const, output: { eviction: 'proposed' } };
    },
  };
}

/** A non-sovereign low-stakes tool — counter-model must NOT fire. */
function reminderTool(): ActionToolDef {
  return {
    name: 'rent.send-reminder',
    description: 'Non-sovereign reminder.',
    stakes: 'low',
    inputSchema: {},
    async invoke() {
      return { ok: true as const, output: { sent: true } };
    },
  };
}

function counterModelStub(
  outcome: Partial<CounterModelReviewOutcome>,
): { model: CounterModel; calls: number } {
  const state = { calls: 0 };
  const verdict: CounterModelVerdict = outcome.verdict ?? 'safe';
  const model: CounterModel = {
    async review() {
      state.calls += 1;
      return {
        verdict,
        reason: outcome.reason ?? 'stub-reason',
        confidence: outcome.confidence ?? 0.8,
        modelId: outcome.modelId ?? 'haiku-test',
        fallback: outcome.fallback ?? false,
      };
    },
  };
  return {
    model,
    get calls() {
      return state.calls;
    },
  };
}

function throwingCounterModel(): CounterModel {
  return {
    async review() {
      throw new Error('counter-model adapter exploded');
    },
  };
}

describe('createExecutor counter-model integration', () => {
  it('safe verdict: proceeds to approval flow with original payload', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(evictionTool());
    const auditSink = createInMemoryActionAuditSink();
    const approvalGate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const stub = counterModelStub({ verdict: 'safe', reason: 'no red flags' });

    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      approvalGate,
      autonomyPolicy: approvalPolicy(),
      counterModel: stub.model,
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'evict',
      description: '',
      status: 'active',
      priority: 'high',
      steps: [
        {
          seq: 0,
          description: 'propose eviction',
          toolName: 'tenant-eviction-proposed',
          toolPayload: { tenantId: 't', leaseId: 'L1' },
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(stub.calls).toBe(1);
    expect(out.stepsAwaitingApproval).toBe(1);
    expect(out.proposedActionIds).toHaveLength(1);
  });

  it('risky verdict: approval payload carries _counterModel attachment', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(evictionTool());
    const auditSink = createInMemoryActionAuditSink();
    const store = createInMemoryApprovalStore();
    const approvalGate = createApprovalGate({ store });
    const stub = counterModelStub({
      verdict: 'risky',
      reason: 'tenant_id in payload mismatches actor',
      confidence: 0.6,
    });

    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      approvalGate,
      autonomyPolicy: approvalPolicy(),
      counterModel: stub.model,
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'evict-risky',
      description: '',
      status: 'active',
      priority: 'high',
      steps: [
        {
          seq: 0,
          description: 'propose eviction',
          toolName: 'tenant-eviction-proposed',
          toolPayload: { tenantId: 't-other', leaseId: 'L1' },
        },
      ],
    });
    await exec.executeGoal(id);
    expect(stub.calls).toBe(1);
    const proposedActions = await store.list({ status: 'pending' });
    expect(proposedActions).toHaveLength(1);
    const payload = proposedActions[0]?.action.payload as Record<string, unknown>;
    expect(payload._counterModel).toBeDefined();
    const cm = payload._counterModel as { verdict: string; reason: string };
    expect(cm.verdict).toBe('risky');
    expect(cm.reason).toContain('tenant_id');
  });

  it('refuse verdict: step fails, approval gate is NOT called', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(evictionTool());
    const auditSink = createInMemoryActionAuditSink();
    const store = createInMemoryApprovalStore();
    const approvalGate = createApprovalGate({ store });
    const spyPropose = vi.spyOn(approvalGate, 'propose');
    const stub = counterModelStub({
      verdict: 'refuse',
      reason: 'irreversible payout without budget',
    });

    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      approvalGate,
      autonomyPolicy: approvalPolicy(),
      counterModel: stub.model,
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'evict-refused',
      description: '',
      status: 'active',
      priority: 'high',
      steps: [
        {
          seq: 0,
          description: 'propose eviction',
          toolName: 'tenant-eviction-proposed',
          toolPayload: {},
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(stub.calls).toBe(1);
    expect(out.stepsFailed).toBe(1);
    expect(spyPropose).not.toHaveBeenCalled();
    const failures = out.failureMessages.join(' ');
    expect(failures).toContain('counter-model refused');
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('failed');
  });

  it('does not invoke counter-model for non-sovereign tools', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(reminderTool());
    const auditSink = createInMemoryActionAuditSink();
    const stub = counterModelStub({ verdict: 'refuse' });

    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      autonomyPolicy: autonomousPolicy(),
      counterModel: stub.model,
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'remind',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'send sms',
          toolName: 'rent.send-reminder',
          toolPayload: {},
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(stub.calls).toBe(0); // never consulted
    expect(out.stepsSucceeded).toBe(1);
  });

  it('throwing counter-model defaults to risky and proceeds to approval', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(evictionTool());
    const auditSink = createInMemoryActionAuditSink();
    const store = createInMemoryApprovalStore();
    const approvalGate = createApprovalGate({ store });

    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      approvalGate,
      autonomyPolicy: approvalPolicy(),
      counterModel: throwingCounterModel(),
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'evict-cm-throw',
      description: '',
      status: 'active',
      priority: 'high',
      steps: [
        {
          seq: 0,
          description: 'propose eviction',
          toolName: 'tenant-eviction-proposed',
          toolPayload: {},
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsAwaitingApproval).toBe(1);
    const proposedActions = await store.list({ status: 'pending' });
    expect(proposedActions).toHaveLength(1);
    const cm = (proposedActions[0]?.action.payload as Record<string, unknown>)
      ._counterModel as { verdict: string; reason: string };
    expect(cm.verdict).toBe('risky');
    expect(cm.reason).toMatch(/counter-model adapter threw/);
  });
});
