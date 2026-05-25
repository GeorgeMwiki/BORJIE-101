import { describe, it, expect } from 'vitest';
import {
  WorkflowEngine,
  InMemoryWorkflowRunStore,
} from '../workflow-engine.js';
import {
  ScriptedStepExecutor,
  DefaultStepExecutor,
} from '../workflow-step-executor.js';
import {
  listWorkflows,
  getWorkflow,
  WORKFLOWS,
} from '../workflow-registry.js';

describe('workflow registry', () => {
  it('ships the 10 seeded workflows', () => {
    expect(listWorkflows().length).toBe(10);
  });

  it('every workflow has at least one step', () => {
    for (const wf of WORKFLOWS) {
      expect(wf.steps.length).toBeGreaterThan(0);
    }
  });

  it('getWorkflow returns undefined for unknown id', () => {
    expect(getWorkflow('nope')).toBeUndefined();
  });
});

describe('workflow engine — happy paths', () => {
  const runSimple = async (workflowId: string) => {
    const store = new InMemoryWorkflowRunStore();
    // Script all human approvals to auto-pass so the engine runs end-to-end.
    const wf = getWorkflow(workflowId);
    if (!wf) throw new Error(`no wf ${workflowId}`);
    const scripts: Record<string, Awaited<ReturnType<DefaultStepExecutor['execute']>>> = {};
    for (const s of wf.steps) {
      if (s.kind === 'human' && s.blocksUntilApproved) {
        scripts[s.id] = { status: 'completed', output: {}, durationMs: 1 };
      }
    }
    const engine = new WorkflowEngine(store, new ScriptedStepExecutor(scripts));
    return engine.start({
      tenantId: 't1',
      workflowId,
      initiatedBy: 'user_1',
      initiatorRoles: ['OWNER', 'MANAGER', 'ADMIN', 'STATION_MASTER'],
      input: {},
    });
  };

  const ids = [
    'onboard_new_property',
    'process_rent_payment',
    'resolve_maintenance_case',
    'execute_lease_renewal',
    'run_arrears_recovery_ladder',
    'execute_move_out_inspection',
    'onboard_new_tenant',
    'draft_monthly_owner_report',
    'vendor_dispatch',
    'rent_repricing_review',
  ];

  for (const id of ids) {
    it(`runs ${id} end-to-end`, async () => {
      const run = await runSimple(id);
      expect(run.status).toBe('completed');
      expect(run.tenantId).toBe('t1');
    });
  }
});

describe('workflow engine — approval paths', () => {
  it('pauses at a human step until advance is called', async () => {
    const store = new InMemoryWorkflowRunStore();
    const engine = new WorkflowEngine(store);
    const run = await engine.start({
      tenantId: 't1',
      workflowId: 'execute_lease_renewal',
      initiatedBy: 'user_1',
      initiatorRoles: ['OWNER'],
      input: {},
    });
    expect(run.status).toBe('awaiting_approval');
  });

  it('advances after approval and completes', async () => {
    const store = new InMemoryWorkflowRunStore();
    const engine = new WorkflowEngine(store);
    let run = await engine.start({
      tenantId: 't1',
      workflowId: 'onboard_new_tenant',
      initiatedBy: 'u',
      initiatorRoles: ['OWNER'],
      input: {},
    });
    // Walk through approvals until completed.
    let safety = 0;
    while (run.status === 'awaiting_approval' && safety < 20) {
      run = await engine.advance('t1', run.id, 'approver', { approve: true });
      safety += 1;
    }
    expect(run.status).toBe('completed');
  });

  it('cancels on rejection', async () => {
    const store = new InMemoryWorkflowRunStore();
    const engine = new WorkflowEngine(store);
    const run = await engine.start({
      tenantId: 't1',
      workflowId: 'onboard_new_tenant',
      initiatedBy: 'u',
      initiatorRoles: ['OWNER'],
      input: {},
    });
    const rejected = await engine.advance('t1', run.id, 'approver', {
      approve: false,
      reason: 'failed credit check',
    });
    expect(rejected.status).toBe('cancelled');
    expect(rejected.errorMessage).toContain('credit');
  });
});

describe('workflow engine — isolation + idempotency', () => {
  it('isolates runs by tenant', async () => {
    const store = new InMemoryWorkflowRunStore();
    const engine = new WorkflowEngine(store);
    const run = await engine.start({
      tenantId: 't1',
      workflowId: 'process_rent_payment',
      initiatedBy: 'u',
      initiatorRoles: ['OWNER'],
      input: {},
    });
    const crossTenant = await engine.get('t2', run.id);
    expect(crossTenant).toBeNull();
  });

  it('returns the same run for a repeated idempotency key', async () => {
    const store = new InMemoryWorkflowRunStore();
    const engine = new WorkflowEngine(store);
    const a = await engine.start({
      tenantId: 't1',
      workflowId: 'process_rent_payment',
      initiatedBy: 'u',
      initiatorRoles: ['OWNER'],
      input: { amount: 1000 },
      idempotencyKey: 'k1',
    });
    const b = await engine.start({
      tenantId: 't1',
      workflowId: 'process_rent_payment',
      initiatedBy: 'u',
      initiatorRoles: ['OWNER'],
      input: { amount: 9999 },
      idempotencyKey: 'k1',
    });
    expect(b.id).toBe(a.id);
  });

  it('rejects insufficient roles', async () => {
    const store = new InMemoryWorkflowRunStore();
    const engine = new WorkflowEngine(store);
    await expect(
      engine.start({
        tenantId: 't1',
        workflowId: 'onboard_new_property',
        initiatedBy: 'u',
        initiatorRoles: ['TENANT'],
        input: {},
      })
    ).rejects.toThrow(/role check/);
  });

  it('advance rejects cross-tenant calls', async () => {
    const store = new InMemoryWorkflowRunStore();
    const engine = new WorkflowEngine(store);
    const run = await engine.start({
      tenantId: 't1',
      workflowId: 'execute_lease_renewal',
      initiatedBy: 'u',
      initiatorRoles: ['OWNER'],
      input: {},
    });
    await expect(
      engine.advance('t2', run.id, 'approver', { approve: true })
    ).rejects.toThrow();
  });
});
