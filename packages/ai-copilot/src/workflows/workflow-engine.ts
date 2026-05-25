/**
 * Workflow Engine — runs named workflows step-by-step with idempotency
 * + human-approval checkpoints. Storage-agnostic — plug in any store.
 *
 * Tenant isolation is enforced at every persistence boundary: the
 * store implementation MUST filter by tenantId.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  getWorkflow,
  WorkflowDefinition,
  WorkflowStep,
} from './workflow-registry.js';
import {
  StepExecutor,
  StepOutcome,
  DefaultStepExecutor,
} from './workflow-step-executor.js';

export const WorkflowRunStatusSchema = z.enum([
  'pending',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export interface WorkflowRun {
  readonly id: string;
  readonly tenantId: string;
  readonly workflowId: string;
  readonly workflowVersion: string;
  readonly initiatedBy: string;
  readonly idempotencyKey?: string;
  readonly status: WorkflowRunStatus;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly currentStep?: string;
  readonly errorMessage?: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly stepLogs: ReadonlyArray<WorkflowStepLog>;
}

export interface WorkflowStepLog {
  readonly id: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly stepId: string;
  readonly stepIndex: number;
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting_approval';
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly errorMessage?: string;
  readonly durationMs?: number;
  readonly approvedBy?: string;
  readonly approvedAt?: string;
  readonly createdAt: string;
}

export interface WorkflowRunStore {
  findByIdempotency(
    tenantId: string,
    workflowId: string,
    idempotencyKey: string
  ): Promise<WorkflowRun | null>;
  create(run: WorkflowRun): Promise<WorkflowRun>;
  update(run: WorkflowRun): Promise<WorkflowRun>;
  findById(tenantId: string, id: string): Promise<WorkflowRun | null>;
  list(tenantId: string): Promise<readonly WorkflowRun[]>;
}

export const StartRunSchema = z.object({
  tenantId: z.string().min(1),
  workflowId: z.string().min(1),
  initiatedBy: z.string().min(1),
  initiatorRoles: z.array(z.string()).default([]),
  input: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
});
export type StartRunInput = z.infer<typeof StartRunSchema>;

export class WorkflowEngine {
  constructor(
    private readonly store: WorkflowRunStore,
    private readonly executor: StepExecutor = new DefaultStepExecutor()
  ) {}

  async start(input: StartRunInput): Promise<WorkflowRun> {
    const parsed = StartRunSchema.parse(input);
    const workflow = getWorkflow(parsed.workflowId);
    if (!workflow) throw new Error(`unknown workflow: ${parsed.workflowId}`);

    this.assertRoles(parsed.initiatorRoles, workflow.defaultRoles);

    if (parsed.idempotencyKey) {
      const existing = await this.store.findByIdempotency(
        parsed.tenantId,
        parsed.workflowId,
        parsed.idempotencyKey
      );
      if (existing) return existing;
    }

    const run: WorkflowRun = {
      id: `run_${randomUUID()}`,
      tenantId: parsed.tenantId,
      workflowId: workflow.id,
      workflowVersion: workflow.version,
      initiatedBy: parsed.initiatedBy,
      ...(parsed.idempotencyKey !== undefined ? { idempotencyKey: parsed.idempotencyKey } : {}),
      status: 'pending',
      input: parsed.input,
      output: {},
      startedAt: new Date().toISOString(),
      stepLogs: [],
    };
    const persisted = await this.store.create(run);
    return this.runLoop(persisted, workflow);
  }

  async advance(
    tenantId: string,
    runId: string,
    approvedBy: string,
    approval: { approve: boolean; reason?: string }
  ): Promise<WorkflowRun> {
    const run = await this.store.findById(tenantId, runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    if (run.tenantId !== tenantId) throw new Error('tenant mismatch');
    if (run.status !== 'awaiting_approval') {
      throw new Error(`run is not awaiting approval (status=${run.status})`);
    }
    const workflow = getWorkflow(run.workflowId);
    if (!workflow) throw new Error(`workflow missing: ${run.workflowId}`);

    if (!approval.approve) {
      return this.store.update({
        ...run,
        status: 'cancelled',
        errorMessage: approval.reason ?? 'human approval rejected',
        completedAt: new Date().toISOString(),
      });
    }

    const lastLog = run.stepLogs[run.stepLogs.length - 1];
    const approvedLog: WorkflowStepLog = {
      ...lastLog,
      status: 'completed',
      approvedBy,
      approvedAt: new Date().toISOString(),
    };
    const updatedRun: WorkflowRun = {
      ...run,
      status: 'running',
      stepLogs: [...run.stepLogs.slice(0, -1), approvedLog],
    };
    const saved = await this.store.update(updatedRun);
    return this.runLoop(saved, workflow, lastLog.stepIndex + 1);
  }

  async get(tenantId: string, runId: string): Promise<WorkflowRun | null> {
    return this.store.findById(tenantId, runId);
  }

  private async runLoop(
    run: WorkflowRun,
    workflow: WorkflowDefinition,
    fromIndex = 0
  ): Promise<WorkflowRun> {
    let current = { ...run, status: 'running' as WorkflowRunStatus };
    current = await this.store.update(current);

    for (let i = fromIndex; i < workflow.steps.length; i += 1) {
      const step = workflow.steps[i];
      const outcome = await this.executor.execute(step, {
        tenantId: run.tenantId,
        initiatedBy: run.initiatedBy,
        runId: run.id,
        stepIndex: i,
        priorOutput: current.output,
        input: run.input,
      });
      const log = buildStepLog(current, step, i, outcome);
      current = {
        ...current,
        currentStep: step.id,
        output: { ...current.output, [step.id]: outcome.output },
        stepLogs: [...current.stepLogs, log],
      };

      if (outcome.status === 'awaiting_approval') {
        current = {
          ...current,
          status: 'awaiting_approval',
        };
        return this.store.update(current);
      }
      if (outcome.status === 'failed') {
        return this.store.update({
          ...current,
          status: 'failed',
          errorMessage: outcome.errorMessage ?? `step ${step.id} failed`,
          completedAt: new Date().toISOString(),
        });
      }
    }

    return this.store.update({
      ...current,
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
  }

  private assertRoles(initiatorRoles: readonly string[], required: readonly string[]): void {
    if (required.length === 0) return;
    const ok = required.some((r) => initiatorRoles.includes(r));
    if (!ok) {
      throw new Error(
        `role check failed: initiator roles=[${initiatorRoles.join(',') || 'none'}] required one of=[${required.join(',')}]`
      );
    }
  }
}

function buildStepLog(
  run: WorkflowRun,
  step: WorkflowStep,
  index: number,
  outcome: StepOutcome
): WorkflowStepLog {
  return {
    id: `log_${randomUUID()}`,
    runId: run.id,
    tenantId: run.tenantId,
    stepId: step.id,
    stepIndex: index,
    status: outcome.status,
    input: {},
    output: outcome.output,
    ...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {}),
    ...(outcome.durationMs !== undefined ? { durationMs: outcome.durationMs } : {}),
    createdAt: new Date().toISOString(),
  };
}

/**
 * In-memory run store — test fixture. Enforces tenant isolation.
 */
export class InMemoryWorkflowRunStore implements WorkflowRunStore {
  private readonly runs: Map<string, WorkflowRun> = new Map();

  async findByIdempotency(
    tenantId: string,
    workflowId: string,
    idempotencyKey: string
  ): Promise<WorkflowRun | null> {
    for (const run of this.runs.values()) {
      if (
        run.tenantId === tenantId &&
        run.workflowId === workflowId &&
        run.idempotencyKey === idempotencyKey
      )
        return run;
    }
    return null;
  }

  async create(run: WorkflowRun): Promise<WorkflowRun> {
    this.runs.set(run.id, run);
    return run;
  }

  async update(run: WorkflowRun): Promise<WorkflowRun> {
    this.runs.set(run.id, run);
    return run;
  }

  async findById(tenantId: string, id: string): Promise<WorkflowRun | null> {
    const r = this.runs.get(id);
    if (!r || r.tenantId !== tenantId) return null;
    return r;
  }

  async list(tenantId: string): Promise<readonly WorkflowRun[]> {
    return Array.from(this.runs.values()).filter((r) => r.tenantId === tenantId);
  }
}
