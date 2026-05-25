/**
 * Executor — edge-case + error-path tests.
 *
 * The existing executor.test.ts covers the happy paths. These tests
 * stress the failure / boundary branches in `createExecutor` that a
 * regression in the agency would silently break:
 *
 *   1. Goal not found → returns a failure outcome with a "unknown goal"
 *      message; never throws.
 *   2. Skipping a step that was already done on a prior pass.
 *   3. Autonomy-policy throwing → step transitions to failed; the
 *      executor bails out of subsequent steps.
 *   4. Approval-gate throwing on propose → step fails (NOT awaiting-
 *      approval) and the executor bails.
 *   5. Tool throwing synchronously is caught the same way as a
 *      Result.error; goal does not abort the whole executor.
 *   6. Audit sink throwing does NOT propagate to the caller — the
 *      executor still mutates the goal and returns its outcome.
 *   7. Goals with multiple succeeding steps flip to 'completed' only
 *      when EVERY step is done (mixed states leave it open).
 *   8. Tool returns `null` output → outcome string normalises to 'ok'.
 *   9. Tool returns object output → outcome is JSON-stringified.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createExecutor,
  createInMemoryActionAuditSink,
  type ActionAuditSink,
} from '../executor/index.js';
import { createInMemoryGoalsPort } from '../goals/goal-tracker.js';
import {
  createActionToolRegistry,
  type ActionToolDef,
} from '../action-tools/index.js';
import {
  createApprovalGate,
  createInMemoryApprovalStore,
  type ApprovalGate,
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

function nullOutputTool(): ActionToolDef {
  return {
    name: 'null.output',
    description: 'returns null output',
    stakes: 'low',
    inputSchema: {},
    async invoke() {
      return { ok: true as const, output: null };
    },
  };
}

function objectOutputTool(): ActionToolDef {
  return {
    name: 'object.output',
    description: 'returns an object output',
    stakes: 'low',
    inputSchema: {},
    async invoke() {
      return {
        ok: true as const,
        output: { who: 'tenant', units: ['U1', 'U2'] },
      };
    },
  };
}

function throwingTool(message: string): ActionToolDef {
  return {
    name: 'throws.tool',
    description: 'throws synchronously',
    stakes: 'low',
    inputSchema: {},
    async invoke() {
      throw new Error(message);
    },
  };
}

beforeEachSilenceConsole();

describe('createExecutor — edge cases', () => {
  it('returns a failure outcome when the goal does not exist', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({ goals, tools, auditSink });

    const out = await exec.executeGoal('does-not-exist');
    expect(out.stepsRun).toBe(0);
    expect(out.stepsSucceeded).toBe(0);
    expect(out.stepsFailed).toBe(0);
    expect(out.failureMessages).toEqual([
      'unknown goal: does-not-exist',
    ]);
    expect(auditSink.entries).toHaveLength(0);
  });

  it('skips steps whose status is not pending (already done on a prior pass)', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({ goals, tools, auditSink });

    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'two-pass',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'first', toolName: null, toolPayload: null },
        { seq: 1, description: 'second', toolName: null, toolPayload: null },
      ],
    });
    // First pass — both run.
    const a = await exec.executeGoal(id);
    expect(a.stepsSucceeded).toBe(2);

    // Second pass — both should be skipped (status='done').
    const b = await exec.executeGoal(id);
    expect(b.stepsRun).toBe(0);
    expect(b.stepsSucceeded).toBe(0);
    expect(b.stepsFailed).toBe(0);
  });

  it('autonomy-policy throwing fails the step and bails subsequent steps', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(nullOutputTool());
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      autonomyPolicy: {
        async decide() {
          throw new Error('autonomy-down');
        },
      },
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'pol-fail',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'first',  toolName: 'null.output', toolPayload: null },
        { seq: 1, description: 'second', toolName: null,          toolPayload: null },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsFailed).toBe(1);
    expect(out.failureMessages.join(' ')).toContain('autonomy-policy error');
    expect(out.failureMessages.join(' ')).toContain('autonomy-down');
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('failed');
    // Subsequent step is bailed → stays pending.
    expect(g?.steps[1]?.status).toBe('pending');
    // Audit sink saw the 'failed' decision.
    expect(auditSink.entries.some((e) => e.decision === 'failed')).toBe(true);
  });

  it('approval-gate.propose throwing fails the step and bails the executor', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(nullOutputTool());
    const auditSink = createInMemoryActionAuditSink();
    // Hand-rolled gate that explodes on propose.
    const explodingGate: ApprovalGate = {
      async propose() {
        throw new Error('gate-down');
      },
      async sign() {
        throw new Error('gate-down');
      },
      async get() {
        return null;
      },
      async list() {
        return [];
      },
    };
    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      approvalGate: explodingGate,
      autonomyPolicy: approvalRequiredPolicy(),
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'gate-fail',
      description: '',
      status: 'active',
      priority: 'medium',
      steps: [
        { seq: 0, description: 'first',  toolName: 'null.output', toolPayload: null },
        { seq: 1, description: 'second', toolName: null,          toolPayload: null },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsFailed).toBe(1);
    expect(out.stepsAwaitingApproval).toBe(0);
    expect(out.failureMessages.join(' ')).toContain('approval-gate error');
    expect(out.failureMessages.join(' ')).toContain('gate-down');
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('failed');
    expect(g?.steps[1]?.status).toBe('pending');
  });

  it('tool throwing synchronously is treated as a step failure (not a runtime crash)', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(throwingTool('boom'));
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
      title: 'throws',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'first', toolName: 'throws.tool', toolPayload: {} },
      ],
    });
    // Should not throw — failure is captured in the outcome.
    const out = await exec.executeGoal(id);
    expect(out.stepsFailed).toBe(1);
    expect(out.failureMessages.join(' ')).toContain('boom');
  });

  it('audit-sink failure does not break the executor — goal state still mutates', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(nullOutputTool());
    const failingSink: ActionAuditSink = {
      async record() {
        throw new Error('sink-down');
      },
    };
    const exec = createExecutor({
      goals,
      tools,
      auditSink: failingSink,
      autonomyPolicy: autonomousPolicy(),
    });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'sink-fail',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'first', toolName: 'null.output', toolPayload: {} },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsSucceeded).toBe(1);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('done');
    expect(g?.status).toBe('completed');
  });

  it('goal flips to completed only when EVERY step is done (awaiting-approval keeps it open)', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(nullOutputTool());
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
      title: 'mixed',
      description: '',
      status: 'active',
      priority: 'medium',
      steps: [
        // First step requires approval (will end as pending+awaiting-approval).
        { seq: 0, description: 'a', toolName: 'null.output', toolPayload: {} },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsAwaitingApproval).toBe(1);
    const g = await goals.get(id);
    // The single step is still pending → goal must NOT be completed.
    expect(g?.status).not.toBe('completed');
  });

  it('null tool output normalises the recorded outcome to "ok"', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(nullOutputTool());
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({ goals, tools, auditSink });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'null-out',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'first', toolName: 'null.output', toolPayload: {} },
      ],
    });
    await exec.executeGoal(id);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('done');
    expect(g?.steps[0]?.outcome).toBe('ok');
  });

  it('object tool output is JSON-stringified into the audit + step outcome', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(objectOutputTool());
    const auditSink = createInMemoryActionAuditSink();
    const exec = createExecutor({ goals, tools, auditSink });
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'obj-out',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 'first', toolName: 'object.output', toolPayload: {} },
      ],
    });
    await exec.executeGoal(id);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('done');
    expect(g?.steps[0]?.outcome).toContain('"who":"tenant"');
    expect(g?.steps[0]?.outcome).toContain('"units":["U1","U2"]');
    // The matching audit row carries the same string.
    const doneAudit = auditSink.entries.find(
      (e) => e.decision === 'done' && e.toolName === 'object.output',
    );
    expect(doneAudit?.outcome).toContain('"who":"tenant"');
  });
});

function beforeEachSilenceConsole(): void {
  // The executor uses console.error on safe-update / safe-audit paths;
  // silence it so test output stays clean.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}
