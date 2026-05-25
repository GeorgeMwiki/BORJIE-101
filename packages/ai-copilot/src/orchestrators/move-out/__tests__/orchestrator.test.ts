/**
 * MoveOutOrchestrator — tests.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

import { describe, it, expect } from 'vitest';
import {
  MoveOutOrchestrator,
  MoveOutAlreadyCompletedError,
  MoveOutStepNotGatedError,
} from '../orchestrator-service.js';
import type {
  AutonomyPolicyPort,
  DamageAssessmentPort,
  DeductionPort,
  DisputePort,
  EventPort,
  InspectionPort,
  MoveOutOrchestratorDeps,
  RefundPort,
  RunState,
  RunStatus,
  RunStorePort,
  Step,
  StepRecord,
  Trigger,
} from '../types.js';

class InMemoryStore implements RunStorePort {
  runs = new Map<string, RunState>();
  steps: StepRecord[] = [];
  private seq = 0;

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }

  async createRun(input: {
    tenantId: string;
    leaseId: string;
    unitId: string;
    depositMinor: number;
    currency: string;
    trigger: Trigger;
    triggeredBy: string;
  }): Promise<RunState> {
    const id = this.nextId('run');
    const run: RunState = {
      id,
      tenantId: input.tenantId,
      leaseId: input.leaseId,
      unitId: input.unitId,
      depositMinor: input.depositMinor,
      currency: input.currency,
      status: 'running',
      trigger: input.trigger,
      startedAt: new Date().toISOString(),
      completedAt: null,
      triggeredBy: input.triggeredBy,
      lastError: null,
      summary: {},
      steps: [],
    };
    this.runs.set(id, run);
    return run;
  }

  async findRunByLease(tenantId: string, leaseId: string): Promise<RunState | null> {
    for (const r of this.runs.values()) {
      if (r.tenantId === tenantId && r.leaseId === leaseId) return this.withSteps(r);
    }
    return null;
  }

  async findRunById(id: string, tenantId: string): Promise<RunState | null> {
    const r = this.runs.get(id);
    if (!r || r.tenantId !== tenantId) return null;
    return this.withSteps(r);
  }

  async listRuns(tenantId: string, limit: number): Promise<readonly RunState[]> {
    return Array.from(this.runs.values())
      .filter((r) => r.tenantId === tenantId)
      .slice(0, limit)
      .map((r) => this.withSteps(r));
  }

  async updateRun(
    runId: string,
    tenantId: string,
    patch: Partial<{
      status: RunStatus;
      completedAt: string | null;
      lastError: string | null;
      summary: Record<string, unknown>;
    }>,
  ): Promise<RunState> {
    const existing = this.runs.get(runId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`Run ${runId} not found`);
    }
    const updated: RunState = { ...existing, ...patch };
    this.runs.set(runId, updated);
    return this.withSteps(updated);
  }

  async recordStep(input: {
    runId: string;
    tenantId: string;
    stepName: Step;
    stepIndex: number;
    decision: StepRecord['decision'];
    actor: string;
    policyRule: string | null;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    resultJson: Record<string, unknown>;
    errorMessage: string | null;
    idempotencyKey: string;
    retryCount: number;
  }): Promise<StepRecord> {
    this.steps = this.steps.filter(
      (s) => !(s.runId === input.runId && s.stepName === input.stepName),
    );
    const record: StepRecord = { id: this.nextId('step'), ...input };
    this.steps.push(record);
    return record;
  }

  async findStep(runId: string, stepName: Step): Promise<StepRecord | null> {
    return this.steps.find((s) => s.runId === runId && s.stepName === stepName) ?? null;
  }

  private withSteps(run: RunState): RunState {
    return { ...run, steps: this.steps.filter((s) => s.runId === run.id) };
  }
}

function buildFixture(
  opts: {
    policyEnabled?: boolean;
    autoIssueUnderMinor?: number;
    damageMinor?: number;
    hasDispute?: boolean;
    failAssess?: number;
    maxRetries?: number;
  } = {},
) {
  const store = new InMemoryStore();
  const events: Array<{ type: string; runId: string }> = [];
  const refundCalls: Array<{ refundMinor: number }> = [];
  const reverseRefundCalls: Array<{ refundId: string }> = [];
  const reverseAssessCalls: Array<{ assessmentId: string }> = [];
  let assessFailures = opts.failAssess ?? 0;

  const inspection: InspectionPort = {
    async scheduleInspection(input) {
      return {
        inspectionId: `insp_${input.unitId}`,
        scheduledFor: '2026-04-15T10:00:00Z',
      };
    },
    async completeInspection(input) {
      return {
        completedAt: '2026-04-15T12:00:00Z',
        damageCount: 1,
      };
    },
  };

  const damageAssessment: DamageAssessmentPort = {
    async assess(input) {
      if (assessFailures > 0) {
        assessFailures -= 1;
        throw new Error('assessor offline');
      }
      return {
        assessmentId: `asm_${input.inspectionId}`,
        totalDamageMinor: opts.damageMinor ?? 5_000_00,
      };
    },
    async reverseAssessment(input) {
      reverseAssessCalls.push({ assessmentId: input.assessmentId });
    },
  };

  const deduction: DeductionPort = {
    async compute(input) {
      return { deductionMinor: Math.min(input.damageMinor, input.depositMinor) };
    },
  };

  const refund: RefundPort = {
    async calculate(input) {
      return { refundMinor: Math.max(0, input.depositMinor - input.deductionMinor) };
    },
    async issueRefund(input) {
      refundCalls.push({ refundMinor: input.refundMinor });
      return { refundId: `rfd_${input.leaseId}`, status: 'IN_TRANSIT' };
    },
    async reverseRefund(input) {
      reverseRefundCalls.push({ refundId: input.refundId });
    },
  };

  const autonomy: AutonomyPolicyPort = {
    async getPolicy() {
      return {
        autonomousModeEnabled: opts.policyEnabled ?? true,
        refunds: { autoIssueUnderMinor: opts.autoIssueUnderMinor ?? 1_000_000_00 },
      };
    },
  };

  let disputeActive = false;
  const disputes: DisputePort = {
    async hasActiveDispute() {
      // Trigger the dispute exactly when we reach refund_calculated.
      if (opts.hasDispute && !disputeActive) {
        disputeActive = true;
        return true;
      }
      return false;
    },
  };

  const eventBus: EventPort = {
    async publish(event) {
      events.push({ type: event.type, runId: event.runId });
    },
  };

  const logger: MoveOutOrchestratorDeps['logger'] = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const orch = new MoveOutOrchestrator({
    store,
    inspection,
    damageAssessment,
    deduction,
    refund,
    autonomy,
    disputes,
    eventBus,
    logger,
    maxRetries: opts.maxRetries ?? 2,
    clock: () => new Date('2026-04-15T00:00:00Z'),
    idGen: () => `id_${Math.random().toString(36).slice(2)}`,
  });

  return {
    orch,
    store,
    events,
    refundCalls,
    reverseRefundCalls,
    reverseAssessCalls,
  };
}

const baseTrigger = {
  tenantId: 'tnt_a',
  leaseId: 'lea_1',
  unitId: 'unt_1',
  depositMinor: 20_000_00,
  currency: 'KES',
  trigger: 'manual' as const,
  triggeredBy: 'admin_1',
};

describe('MoveOutOrchestrator — happy path', () => {
  it('runs all 8 steps and completes', async () => {
    const fx = buildFixture({});
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('completed');
    expect(run.steps).toHaveLength(8);
  });

  it('issues refund when positive and emits MoveOutCompleted', async () => {
    const fx = buildFixture({});
    await fx.orch.triggerRun(baseTrigger);
    expect(fx.refundCalls).toHaveLength(1);
    expect(fx.refundCalls[0].refundMinor).toBe(15_000_00); // 20k - 5k damage
    expect(fx.events.map((e) => e.type)).toContain('MoveOutCompleted');
  });

  it('skips refund when computed refund is zero', async () => {
    const fx = buildFixture({ damageMinor: 20_000_00 });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('completed');
    expect(fx.refundCalls).toHaveLength(0);
    const refundStep = run.steps.find((s) => s.stepName === 'refund_issued');
    expect(refundStep?.resultJson.skipped).toBe(true);
  });
});

describe('MoveOutOrchestrator — policy gating', () => {
  it('pauses refund_issued when autonomous mode is OFF', async () => {
    const fx = buildFixture({ policyEnabled: false });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('awaiting_approval');
    expect(fx.refundCalls).toHaveLength(0);
  });

  it('pauses refund_issued when refund exceeds the threshold', async () => {
    const fx = buildFixture({ autoIssueUnderMinor: 1_000_00 });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('awaiting_approval');
    const gated = run.steps.find((s) => s.stepName === 'refund_issued');
    expect(gated?.policyRule).toBe('refund.over_auto_issue_threshold');
  });

  it('resumes and completes after step approval', async () => {
    const fx = buildFixture({ autoIssueUnderMinor: 1_000_00 });
    const first = await fx.orch.triggerRun(baseTrigger);
    const resumed = await fx.orch.approveStep({
      runId: first.run.id,
      tenantId: 'tnt_a',
      stepName: 'refund_issued',
      approverUserId: 'u1',
    });
    expect(resumed.status).toBe('completed');
    expect(fx.refundCalls).toHaveLength(1);
  });

  it('throws when approving a non-gated step', async () => {
    const fx = buildFixture({});
    const { run } = await fx.orch.triggerRun(baseTrigger);
    await expect(
      fx.orch.approveStep({
        runId: run.id,
        tenantId: 'tnt_a',
        stepName: 'notice_received',
        approverUserId: 'u',
      }),
    ).rejects.toBeInstanceOf(MoveOutStepNotGatedError);
  });
});

describe('MoveOutOrchestrator — compensation', () => {
  it('compensates on dispute mid-run', async () => {
    const fx = buildFixture({ hasDispute: true });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('disputed');
    // Damage step ran before dispute trigger, so reverseAssessment fires
    expect(fx.reverseAssessCalls).toHaveLength(1);
    expect(fx.events.map((e) => e.type)).toContain('MoveOutDisputed');
  });

  it('reopenOnDispute reverses refund and assessment after completion', async () => {
    const fx = buildFixture({});
    const { run } = await fx.orch.triggerRun(baseTrigger);
    const reopened = await fx.orch.reopenOnDispute(run.id, 'tnt_a');
    expect(reopened.status).toBe('disputed');
    expect(fx.reverseRefundCalls).toHaveLength(1);
    expect(fx.reverseAssessCalls).toHaveLength(1);
  });
});

describe('MoveOutOrchestrator — retry and idempotency', () => {
  it('retries a transient damage-assessment failure and completes', async () => {
    const fx = buildFixture({ failAssess: 1 });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('completed');
    const dmg = run.steps.find((s) => s.stepName === 'damage_assessed');
    expect(dmg?.retryCount).toBeGreaterThanOrEqual(1);
  });

  it('throws when re-triggering a completed run', async () => {
    const fx = buildFixture({});
    await fx.orch.triggerRun(baseTrigger);
    await expect(fx.orch.triggerRun(baseTrigger)).rejects.toBeInstanceOf(
      MoveOutAlreadyCompletedError,
    );
  });
});
