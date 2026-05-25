/**
 * A2b-2 wire #6 — per-tenant tool-call denylist check at dispatch.
 *
 * An entry of the form `(tenantA, platform.evict_tenant)` MUST cause
 * the executor to refuse the step with a `tool-denylisted` outcome
 * and the denial reason preserved on the audit row. The same tool
 * called for a DIFFERENT tenant runs normally.
 */
import { describe, it, expect } from 'vitest';
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
  createInMemoryToolCallDenylist,
} from '../../tool-spec/tool-call-denylist.js';

function evictTool(): ActionToolDef {
  return {
    name: 'platform.evict_tenant',
    description: 'Evicts a tenant (sovereign tier).',
    stakes: 'critical',
    schemaIn: { type: 'object' },
    schemaOut: { type: 'object' },
    async invoke() {
      return { ok: true, output: { evicted: true } };
    },
  };
}

describe('A2b-2 wire #6 — tool-call denylist consulted at dispatch', () => {
  it('refuses a denylisted tool for the affected tenant', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(evictTool());
    const auditSink = createInMemoryActionAuditSink();
    const denylist = createInMemoryToolCallDenylist();
    await denylist.add({
      tenantId: 'tenantA',
      toolName: 'platform.evict_tenant',
      reason: 'regulator hold #1234',
    });

    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      toolDenylist: denylist,
    });

    const { id } = await goals.open({
      tenantId: 'tenantA',
      userId: 'u_1',
      threadId: 'thr_1',
      title: 'Process eviction',
      description: 'eviction',
      status: 'active',
      priority: 'high',
      steps: [
        {
          seq: 1,
          description: 'evict the tenant',
          toolName: 'platform.evict_tenant',
          toolPayload: { unitId: 'unit_42' },
        },
      ],
    });

    const outcome = await exec.executeGoal(id);
    expect(outcome.stepsFailed).toBe(1);
    expect(outcome.stepsSucceeded).toBe(0);
    expect(outcome.failureMessages[0]).toMatch(/tool-denylisted/);
    const auditRows = auditSink.entries;
    const denialAudit = auditRows.find((e) => e.outcome === 'tool-denylisted');
    expect(denialAudit).toBeDefined();
    expect(denialAudit!.errorMessage).toMatch(/regulator hold/);
  });

  it('allows the same tool for a tenant NOT in the denylist', async () => {
    const goals = createInMemoryGoalsPort();
    const tools = createActionToolRegistry();
    tools.register(evictTool());
    const auditSink = createInMemoryActionAuditSink();
    const denylist = createInMemoryToolCallDenylist();
    await denylist.add({
      tenantId: 'tenantA',
      toolName: 'platform.evict_tenant',
      reason: 'regulator hold #1234',
    });

    const exec = createExecutor({
      goals,
      tools,
      auditSink,
      toolDenylist: denylist,
    });

    const { id } = await goals.open({
      tenantId: 'tenantB',
      userId: 'u_2',
      threadId: 'thr_2',
      title: 'Process eviction',
      description: 'eviction',
      status: 'active',
      priority: 'high',
      steps: [
        {
          seq: 1,
          description: 'evict the tenant',
          toolName: 'platform.evict_tenant',
          toolPayload: { unitId: 'unit_99' },
        },
      ],
    });

    const outcome = await exec.executeGoal(id);
    // Tool succeeds (no autonomy policy gate forces approval here).
    expect(outcome.stepsSucceeded + outcome.stepsAwaitingApproval).toBeGreaterThan(0);
    expect(outcome.failureMessages.some((m) => /tool-denylisted/.test(m))).toBe(false);
  });
});
