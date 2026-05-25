/**
 * Tests for createExecutor.
 *
 *   1. Informational step (toolName=null) marks done
 *   2. Tool happy path — invokes the tool, marks done, audits done
 *   3. Unknown tool fails the goal and bails out
 *   4. AutonomyPolicy requires approval → step pending(awaiting-approval),
 *      no tool invocation, approval gate proposes the action
 *   5. Autonomous tool error fails the step and bails subsequent steps
 *   6. Audit sink receives every transition (running + outcome)
 *   7. No autonomyPolicy supplied → autonomous (default)
 *   8. Goal flips to completed when every step is done
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createExecutor,
  createInMemoryActionAuditSink,
} from '../executor/index.js';
import { createInMemoryGoalsPort } from '../goals/goal-tracker.js';
import {
  createActionToolRegistry,
  RENT_SEND_REMINDER_TOOL,
  WORK_ORDER_CREATE_TOOL,
  type ActionToolDef,
} from '../action-tools/index.js';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
} from '../../four-eye-approval.js';
import type { AutonomyPolicyPort } from '../executor/autonomy-policy.js';

function autonomousPolicy(): AutonomyPolicyPort {
  return {
    async decide() {
      return {
        authorized: true,
        requiresApproval: false,
        reason: 'autonomous-stub',
      };
    },
  };
}

function approvalRequiredPolicy(): AutonomyPolicyPort {
  return {
    async decide() {
      return {
        authorized: true,
        requiresApproval: true,
        reason: 'requires-approval-stub',
      };
    },
  };
}

function failingTool(): ActionToolDef<Record<string, unknown>, { id: string }> {
  return {
    name: 'failing.tool',
    description: 'Always fails.',
    stakes: 'low',
    inputSchema: {},
    async invoke() {
      return { ok: false as const, message: 'tool said no' };
    },
  };
}

describe('createExecutor', () => {
  beforeEachSilenceConsole();

  it('informational step is marked done', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({ goals, tools, auditSink });

    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'note',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'analyse', toolName: null, toolPayload: null },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsSucceeded).toBe(1);
    expect(out.stepsFailed).toBe(0);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('done');
  });

  it('tool happy path invokes the tool and marks done', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(RENT_SEND_REMINDER_TOOL);
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      autonomyPolicy: autonomousPolicy(),
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
          description: 'send',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsSucceeded).toBe(1);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('done');
    expect(g?.status).toBe('completed');
    const decisions = auditSink.entries.map((e) => e.decision);
    expect(decisions).toContain('running');
    expect(decisions).toContain('done');
  });

  it('unknown tool fails the goal and bails subsequent steps', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      autonomyPolicy: autonomousPolicy(),
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'broken',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'use missing tool',
          toolName: 'nope.unknown',
          toolPayload: null,
        },
        {
          seq: 1,
          description: 'never reached',
          toolName: null,
          toolPayload: null,
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsFailed).toBe(1);
    expect(out.stepsRun).toBe(1);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('failed');
    expect(g?.steps[1]?.status).toBe('pending');
    expect(auditSink.entries.some((e) => e.decision === 'unknown-tool')).toBe(
      true,
    );
  });

  it('autonomy-requires-approval branches to the gate without invoking the tool', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    let invoked = 0;
    const wrappedTool: ActionToolDef = {
      ...WORK_ORDER_CREATE_TOOL,
      async invoke(input, ctx) {
        invoked += 1;
        return WORK_ORDER_CREATE_TOOL.invoke(input as never, ctx);
      },
    };
    tools.register(wrappedTool);
    const auditSink = createInMemoryActionAuditSink();
    const approvalGate = createApprovalGate({
      store: createInMemoryApprovalStore(),
    });
    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      approvalGate,
      autonomyPolicy: approvalRequiredPolicy(),
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'create wo',
      description: '',
      status: 'active',
      priority: 'medium',
      steps: [
        {
          seq: 0,
          description: 'create',
          toolName: 'work-order.create',
          toolPayload: {
            propertyId: 'P1',
            unitId: 'U1',
            description: 'leak',
            priority: 'medium',
          },
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsAwaitingApproval).toBe(1);
    expect(out.proposedActionIds).toHaveLength(1);
    expect(invoked).toBe(0);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('pending');
    expect(g?.steps[0]?.outcome).toMatch(/^awaiting-approval:/);
    expect(auditSink.entries.some((e) => e.decision === 'awaiting-approval'))
      .toBe(true);
  });

  it('autonomous tool error fails the step and bails subsequent ones', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(failingTool());
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      autonomyPolicy: autonomousPolicy(),
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'tries',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'first',
          toolName: 'failing.tool',
          toolPayload: {},
        },
        {
          seq: 1,
          description: 'second',
          toolName: null,
          toolPayload: null,
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsFailed).toBe(1);
    expect(out.failureMessages.join(' ')).toContain('tool said no');
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('failed');
    expect(g?.steps[1]?.status).toBe('pending');
  });

  it('audit sink receives every transition (running + done)', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(RENT_SEND_REMINDER_TOOL);
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      autonomyPolicy: autonomousPolicy(),
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'audit-target',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'a',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
        },
        {
          seq: 1,
          description: 'b',
          toolName: null,
          toolPayload: null,
        },
      ],
    });
    await exec.executeGoal(id);
    const decisions = auditSink.entries.map((e) => e.decision);
    expect(decisions.filter((d) => d === 'running')).toHaveLength(2);
    expect(decisions.filter((d) => d === 'done')).toHaveLength(2);
  });

  it('no autonomyPolicy supplied → step runs autonomously', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(RENT_SEND_REMINDER_TOOL);
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({ goals, tools, auditSink });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'no-policy',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'a',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsSucceeded).toBe(1);
  });

  it('completed goal status flips to "completed" once every step is done', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({ goals, tools, auditSink });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'done-flip',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'a', toolName: null, toolPayload: null },
        { seq: 1, description: 'b', toolName: null, toolPayload: null },
      ],
    });
    await exec.executeGoal(id);
    const g = await goals.get(id);
    expect(g?.status).toBe('completed');
  });
});

function beforeEachSilenceConsole(): void {
  // Silence the executor's `console.error` calls so test output stays
  // clean. The test still asserts behaviour through goals + audit sink.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}
