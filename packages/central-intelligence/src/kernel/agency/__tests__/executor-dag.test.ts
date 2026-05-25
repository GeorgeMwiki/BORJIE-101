/**
 * Executor DAG + deadline + blockers tests — Phase D / D12.8.
 *
 * Validates the additive surface on `GoalStep`:
 *   - dependsOn — step skipped with `waiting-on:<id>` until deps done
 *   - due       — step marked `skipped` with `deadline-passed` when ISO
 *                 deadline is in the past
 *   - blockers  — step skipped with `blocked:<kind>` until blockers clear
 *
 * Also exercises `topoSort` directly so the helper is covered.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createExecutor,
  createInMemoryActionAuditSink,
  topoSort,
} from '../executor/index.js';
import { createInMemoryGoalsPort } from '../goals/goal-tracker.js';
import {
  createActionToolRegistry,
  RENT_SEND_REMINDER_TOOL,
} from '../action-tools/index.js';
import type { AutonomyPolicyPort } from '../executor/autonomy-policy.js';
import type { GoalStep } from '../goals/types.js';

function autonomousPolicy(): AutonomyPolicyPort {
  return {
    async decide() {
      return { authorized: true, requiresApproval: false, reason: 'auto' };
    },
  };
}

function silenceConsole(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

function stepFixture(over: Partial<GoalStep>): GoalStep {
  return {
    id: 's_x',
    seq: 0,
    description: 'desc',
    toolName: null,
    toolPayload: null,
    status: 'pending',
    startedAt: null,
    endedAt: null,
    outcome: null,
    errorMessage: null,
    ...over,
  };
}

describe('topoSort — Phase D / D12.8', () => {
  it('preserves seq order when no edges are declared', () => {
    const steps = [
      stepFixture({ id: 'a', seq: 0 }),
      stepFixture({ id: 'b', seq: 1 }),
      stepFixture({ id: 'c', seq: 2 }),
    ];
    expect(topoSort(steps).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('honours dependsOn edges over seq', () => {
    // Declared seq: b first, c second, a last. Edges: a→b, b→c. Expected
    // topological order: c, b, a.
    const steps = [
      stepFixture({ id: 'b', seq: 0, dependsOn: ['c'] }),
      stepFixture({ id: 'c', seq: 1 }),
      stepFixture({ id: 'a', seq: 2, dependsOn: ['b'] }),
    ];
    const order = topoSort(steps).map((s) => s.id);
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
  });

  it('tolerates a cycle by deferring offending nodes without crashing', () => {
    const steps = [
      stepFixture({ id: 'a', seq: 0, dependsOn: ['b'] }),
      stepFixture({ id: 'b', seq: 1, dependsOn: ['a'] }),
      stepFixture({ id: 'c', seq: 2 }),
    ];
    const order = topoSort(steps).map((s) => s.id);
    expect(order).toContain('a');
    expect(order).toContain('b');
    expect(order).toContain('c');
  });

  it('ignores unknown dependsOn ids', () => {
    const steps = [
      stepFixture({ id: 'a', seq: 0, dependsOn: ['nonexistent'] }),
    ];
    expect(topoSort(steps).map((s) => s.id)).toEqual(['a']);
  });
});

describe('executor — dependsOn gate', () => {
  it('skips a step whose dependsOn target has not completed yet', async () => {
    silenceConsole();
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

    // The dependsOn refers to an UNKNOWN id — the step must skip with
    // a waiting-on audit row rather than run.
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'blocked-on-missing-step',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'send',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
          dependsOn: ['s_does_not_exist_in_loop'],
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsSucceeded).toBe(0);
    expect(out.stepsRun).toBe(0);
    const waiting = auditSink.entries.find(
      (e) => e.decision === 'skipped' && (e.outcome ?? '').startsWith('waiting-on:'),
    );
    expect(waiting).toBeDefined();
  });
});

describe('executor — deadline gate', () => {
  it('marks the step skipped with `deadline-passed` when due is in the past', async () => {
    silenceConsole();
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
      title: 'overdue-step',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'send',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
          due: '2020-01-01T00:00:00.000Z',
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsRun).toBe(0);
    const g = await goals.get(id);
    expect(g?.steps[0]?.status).toBe('skipped');
    expect(g?.steps[0]?.outcome).toBe('deadline-passed');
  });

  it('runs the step when due is in the future', async () => {
    silenceConsole();
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

    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { id } = await goals.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'future-due',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'send',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
          due: farFuture,
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsSucceeded).toBe(1);
  });
});

describe('executor — blockers gate', () => {
  it('skips a step that carries at least one blocker', async () => {
    silenceConsole();
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
      title: 'blocked-step',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        {
          seq: 0,
          description: 'send',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
          blockers: [
            {
              kind: 'document-missing',
              description: 'Tenant signature is missing on the renewal',
              ref: 'doc_42',
            },
          ],
        },
      ],
    });
    const out = await exec.executeGoal(id);
    expect(out.stepsRun).toBe(0);
    const blockedRow = auditSink.entries.find(
      (e) => e.decision === 'skipped' && (e.outcome ?? '').startsWith('blocked:'),
    );
    expect(blockedRow?.outcome).toBe('blocked:document-missing');
  });
});
