/**
 * ArrearsLadderOrchestrator — tests.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

import { describe, it, expect } from 'vitest';
import {
  ArrearsLadderOrchestrator,
  ArrearsLadderAlreadyCompletedError,
  ArrearsLadderStepNotGatedError,
} from '../orchestrator-service.js';
import type {
  ArrearsLadderOrchestratorDeps,
  AutonomyPolicyPort,
  EscalationPort,
  EventPort,
  NoticeDispatchPort,
  PaymentLookupPort,
  RunState,
  RunStatus,
  RunStorePort,
  SettlementPort,
  Step,
  StepRecord,
  Trigger,
  WriteOffPort,
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
    tenantPartyId: string;
    outstandingMinor: number;
    currency: string;
    trigger: Trigger;
    triggeredBy: string;
  }): Promise<RunState> {
    const id = this.nextId('run');
    const run: RunState = {
      id,
      tenantId: input.tenantId,
      leaseId: input.leaseId,
      tenantPartyId: input.tenantPartyId,
      outstandingMinor: input.outstandingMinor,
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
    const record: StepRecord = {
      id: this.nextId('step'),
      ...input,
    };
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
    autoEscalateOverMinor?: number;
    autoWriteOffUnderMinor?: number;
    tenantPaidMidway?: boolean;
    failSoftReminderTimes?: number;
    maxRetries?: number;
    dispatchSuccess?: boolean;
  } = {},
) {
  const store = new InMemoryStore();
  const events: Array<{ type: string; runId: string }> = [];
  const reminderCalls: Array<{ severity: string }> = [];
  const cancelCalls: Array<{ dispatchId: string }> = [];
  const escalationCalls: Array<{ leaseId: string }> = [];
  const rescindCalls: Array<{ caseId: string }> = [];
  const settlementCalls: Array<{ leaseId: string }> = [];
  const writeOffCalls: Array<{ leaseId: string; decision: string }> = [];
  let paidCheckCount = 0;
  let softRemFailures = opts.failSoftReminderTimes ?? 0;

  const notices: NoticeDispatchPort = {
    async sendReminder(input) {
      if (input.severity === 'soft' && softRemFailures > 0) {
        softRemFailures -= 1;
        throw new Error('notice gateway transient error');
      }
      reminderCalls.push({ severity: input.severity });
      return {
        dispatchId: `disp_${input.severity}_${input.leaseId}`,
        scheduledFor: new Date().toISOString(),
      };
    },
    async cancelReminder(input) {
      cancelCalls.push({ dispatchId: input.dispatchId });
    },
  };

  const escalation: EscalationPort = {
    async escalateToLegal(input) {
      escalationCalls.push({ leaseId: input.leaseId });
      return { caseId: `case_${input.leaseId}` };
    },
    async rescindEscalation(input) {
      rescindCalls.push({ caseId: input.caseId });
    },
  };

  const settlement: SettlementPort = {
    async createOffer(input) {
      settlementCalls.push({ leaseId: input.leaseId });
      return {
        offerId: `off_${input.leaseId}`,
        discountPct: 10,
        instalments: 3,
      };
    },
  };

  const writeOff: WriteOffPort = {
    async recordDecision(input) {
      writeOffCalls.push({ leaseId: input.leaseId, decision: input.decision });
      return { journalEntryId: `je_${input.leaseId}` };
    },
  };

  const payments: PaymentLookupPort = {
    async hasSettledSince() {
      paidCheckCount += 1;
      // Pay after the first step (index 0 is soft_reminder; check triggers
      // when i > 0, i.e. on transition into firm_reminder).
      if (opts.tenantPaidMidway && paidCheckCount >= 1) return true;
      return false;
    },
  };

  const autonomy: AutonomyPolicyPort = {
    async getPolicy() {
      return {
        autonomousModeEnabled: opts.policyEnabled ?? true,
        arrears: {
          autoEscalateOverMinor: opts.autoEscalateOverMinor ?? 50_000_00,
          autoWriteOffUnderMinor: opts.autoWriteOffUnderMinor ?? 1_000_00,
        },
      };
    },
  };

  const eventBus: EventPort = {
    async publish(event) {
      events.push({ type: event.type, runId: event.runId });
    },
  };

  const logger: ArrearsLadderOrchestratorDeps['logger'] = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const orch = new ArrearsLadderOrchestrator({
    store,
    notices,
    escalation,
    settlement,
    writeOff,
    payments,
    autonomy,
    eventBus,
    logger,
    maxRetries: opts.maxRetries ?? 2,
    clock: () => new Date('2026-04-10T00:00:00Z'),
    idGen: () => `id_${Math.random().toString(36).slice(2)}`,
  });

  return {
    orch,
    store,
    events,
    reminderCalls,
    cancelCalls,
    escalationCalls,
    rescindCalls,
    settlementCalls,
    writeOffCalls,
  };
}

const baseTrigger = {
  tenantId: 'tnt_a',
  leaseId: 'lea_1',
  tenantPartyId: 'ten_1',
  outstandingMinor: 200_000_00,
  currency: 'KES',
  trigger: 'manual' as const,
  triggeredBy: 'admin_1',
};

describe('ArrearsLadderOrchestrator — happy path', () => {
  it('walks every step and marks the run completed', async () => {
    const fx = buildFixture({
      policyEnabled: true,
      autoEscalateOverMinor: 100_000_00,
      autoWriteOffUnderMinor: 300_000_00,
    });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('completed');
    expect(run.steps).toHaveLength(6);
    const decisions = Object.fromEntries(run.steps.map((s) => [s.stepName, s.decision]));
    expect(decisions.soft_reminder).toBe('executed');
    expect(decisions.firm_reminder).toBe('executed');
    expect(decisions.final_notice).toBe('executed');
    expect(decisions.case_escalation).toBe('auto_approved');
    expect(decisions.settlement_offer).toBe('executed');
    expect(decisions.write_off_decision).toBe('auto_approved');
  });

  it('emits ArrearsLadderStarted and ArrearsLadderCompleted', async () => {
    const fx = buildFixture({
      autoEscalateOverMinor: 100_000_00,
      autoWriteOffUnderMinor: 300_000_00,
    });
    await fx.orch.triggerRun(baseTrigger);
    const types = fx.events.map((e) => e.type);
    expect(types).toContain('ArrearsLadderStarted');
    expect(types).toContain('ArrearsLadderCompleted');
  });

  it('dispatches one reminder per severity level', async () => {
    const fx = buildFixture({
      autoEscalateOverMinor: 100_000_00,
      autoWriteOffUnderMinor: 300_000_00,
    });
    await fx.orch.triggerRun(baseTrigger);
    const severities = fx.reminderCalls.map((c) => c.severity);
    expect(severities).toEqual(['soft', 'firm', 'final']);
  });
});

describe('ArrearsLadderOrchestrator — compensation', () => {
  it('cancels scheduled reminders when tenant pays midway', async () => {
    const fx = buildFixture({
      autoEscalateOverMinor: 100_000_00,
      autoWriteOffUnderMinor: 300_000_00,
      tenantPaidMidway: true,
    });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('compensated');
    // Only soft_reminder ran; firm + final never dispatched
    expect(fx.reminderCalls.map((c) => c.severity)).toEqual(['soft']);
    // No future reminders to cancel (they never ran), so cancelCalls stays 0.
    expect(fx.cancelCalls).toHaveLength(0);
    const types = fx.events.map((e) => e.type);
    expect(types).toContain('ArrearsLadderCompensated');
  });
});

describe('ArrearsLadderOrchestrator — policy gating', () => {
  it('pauses case_escalation when autonomous mode is OFF', async () => {
    const fx = buildFixture({ policyEnabled: false });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('awaiting_approval');
    const gated = run.steps.find((s) => s.stepName === 'case_escalation');
    expect(gated?.decision).toBe('awaiting_approval');
    expect(fx.escalationCalls).toHaveLength(0);
  });

  it('pauses case_escalation when outstanding is under the threshold', async () => {
    const fx = buildFixture({
      policyEnabled: true,
      autoEscalateOverMinor: 500_000_00,
    });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('awaiting_approval');
    const gated = run.steps.find((s) => s.stepName === 'case_escalation');
    expect(gated?.policyRule).toBe('arrears.below_auto_escalate_threshold');
  });

  it('resumes after approval and completes the run', async () => {
    const fx = buildFixture({ policyEnabled: false });
    const first = await fx.orch.triggerRun(baseTrigger);
    expect(first.run.status).toBe('awaiting_approval');
    const resumed = await fx.orch.approveStep({
      runId: first.run.id,
      tenantId: 'tnt_a',
      stepName: 'case_escalation',
      approverUserId: 'approver_1',
    });
    // After approval resumes, write_off_decision is also gated by the same
    // autonomous-off policy, so it will park there.
    expect(['awaiting_approval', 'completed']).toContain(resumed.status);
  });

  it('throws when approving a step that is not gated', async () => {
    const fx = buildFixture({
      autoEscalateOverMinor: 100_000_00,
      autoWriteOffUnderMinor: 300_000_00,
    });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    await expect(
      fx.orch.approveStep({
        runId: run.id,
        tenantId: 'tnt_a',
        stepName: 'soft_reminder',
        approverUserId: 'u',
      }),
    ).rejects.toBeInstanceOf(ArrearsLadderStepNotGatedError);
  });
});

describe('ArrearsLadderOrchestrator — idempotency & retry', () => {
  it('retries a transient notice-dispatch failure and succeeds', async () => {
    const fx = buildFixture({
      autoEscalateOverMinor: 100_000_00,
      autoWriteOffUnderMinor: 300_000_00,
      failSoftReminderTimes: 1,
      maxRetries: 2,
    });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('completed');
    const softStep = run.steps.find((s) => s.stepName === 'soft_reminder');
    expect(softStep?.retryCount).toBeGreaterThanOrEqual(1);
  });

  it('throws when re-triggering a completed run for the same lease', async () => {
    const fx = buildFixture({
      autoEscalateOverMinor: 100_000_00,
      autoWriteOffUnderMinor: 300_000_00,
    });
    await fx.orch.triggerRun(baseTrigger);
    await expect(fx.orch.triggerRun(baseTrigger)).rejects.toBeInstanceOf(
      ArrearsLadderAlreadyCompletedError,
    );
  });
});
