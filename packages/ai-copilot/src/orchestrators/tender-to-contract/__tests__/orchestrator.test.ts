/**
 * TenderToContractOrchestrator — tests.
 *
 * Wave 28 AGENT ORCHESTRATE.
 */

import { describe, it, expect } from 'vitest';
import {
  TenderToContractOrchestrator,
  TenderAlreadyCompletedError,
  TenderStepNotGatedError,
} from '../orchestrator-service.js';
import type {
  AutonomyPolicyPort,
  AwardPort,
  ContractPort,
  EventPort,
  RunState,
  RunStatus,
  RunStorePort,
  Step,
  StepRecord,
  TenderPort,
  TenderToContractOrchestratorDeps,
  Trigger,
  VendorOnboardingPort,
} from '../types.js';

class InMemoryStore implements RunStorePort {
  runs = new Map<string, RunState>();
  steps: StepRecord[] = [];
  private seq = 0;
  private nextId(prefix: string) {
    this.seq += 1;
    return `${prefix}_${this.seq}`;
  }
  async createRun(input: {
    tenantId: string;
    tenderKey: string;
    scope: string;
    budgetMinor: number;
    currency: string;
    trigger: Trigger;
    triggeredBy: string;
  }): Promise<RunState> {
    const id = this.nextId('run');
    const run: RunState = {
      id,
      tenantId: input.tenantId,
      tenderKey: input.tenderKey,
      scope: input.scope,
      budgetMinor: input.budgetMinor,
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
  async findRunByKey(tenantId: string, tenderKey: string): Promise<RunState | null> {
    for (const r of this.runs.values()) {
      if (r.tenantId === tenantId && r.tenderKey === tenderKey) return this.withSteps(r);
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
      throw new Error('Run not found');
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
    autoAwardUnderMinor?: number;
    failSigning?: boolean;
    emptyBids?: boolean;
    failPublishTimes?: number;
    maxRetries?: number;
    topPickAmountMinor?: number;
  } = {},
) {
  const store = new InMemoryStore();
  const events: Array<{ type: string; runId: string }> = [];
  const awardCalls: Array<{ vendorId: string; amountMinor: number }> = [];
  const rescindCalls: Array<{ awardId: string }> = [];
  let pubFailures = opts.failPublishTimes ?? 0;

  const tender: TenderPort = {
    async publishTender(input) {
      if (pubFailures > 0) {
        pubFailures -= 1;
        throw new Error('publisher transient error');
      }
      return {
        tenderId: `tnd_${input.scope}`,
        publishedAt: new Date().toISOString(),
      };
    },
    async collectBids() {
      if (opts.emptyBids) return { bids: [] };
      return {
        bids: [
          { vendorId: 'vnd_1', amountMinor: opts.topPickAmountMinor ?? 50_000_00, score: 92 },
          { vendorId: 'vnd_2', amountMinor: 60_000_00, score: 85 },
        ],
      };
    },
    async shortlist(input) {
      const top = input.bids.reduce((best, b) => (b.score > best.score ? b : best), input.bids[0]);
      return {
        shortlistedVendorIds: input.bids.map((b) => b.vendorId),
        topPick: { vendorId: top.vendorId, amountMinor: top.amountMinor },
      };
    },
  };

  const award: AwardPort = {
    async awardContract(input) {
      awardCalls.push({ vendorId: input.vendorId, amountMinor: input.amountMinor });
      return { awardId: `awd_${input.vendorId}` };
    },
    async rescindAward(input) {
      rescindCalls.push({ awardId: input.awardId });
    },
  };

  const contract: ContractPort = {
    async draftContract(input) {
      return { contractId: `ctr_${input.awardId}` };
    },
    async signContract(input) {
      if (opts.failSigning) {
        throw new Error('vendor withdrew signature');
      }
      return { signedAt: new Date().toISOString() };
    },
  };

  const onboarding: VendorOnboardingPort = {
    async onboardVendor(input) {
      return { vendorProfileId: `vp_${input.vendorId}` };
    },
  };

  const autonomy: AutonomyPolicyPort = {
    async getPolicy() {
      return {
        autonomousModeEnabled: opts.policyEnabled ?? true,
        procurement: { autoAwardUnderMinor: opts.autoAwardUnderMinor ?? 1_000_000_00 },
      };
    },
  };

  const eventBus: EventPort = {
    async publish(event) {
      events.push({ type: event.type, runId: event.runId });
    },
  };

  const logger: TenderToContractOrchestratorDeps['logger'] = {
    info: () => {},
    warn: () => {},
    error: () => {},
  };

  const orch = new TenderToContractOrchestrator({
    store,
    tender,
    award,
    contract,
    onboarding,
    autonomy,
    eventBus,
    logger,
    maxRetries: opts.maxRetries ?? 2,
    clock: () => new Date('2026-04-10T00:00:00Z'),
    idGen: () => `id_${Math.random().toString(36).slice(2)}`,
  });

  return { orch, store, events, awardCalls, rescindCalls };
}

const baseTrigger = {
  tenantId: 'tnt_a',
  tenderKey: 'tnd_clean_2026q2',
  scope: 'Cleaning services Q2 2026',
  budgetMinor: 100_000_00,
  currency: 'KES',
  trigger: 'manual' as const,
  triggeredBy: 'admin_1',
};

describe('TenderToContractOrchestrator — happy path', () => {
  it('runs every step and marks the run completed', async () => {
    const fx = buildFixture({});
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('completed');
    expect(run.steps).toHaveLength(8);
    expect(fx.awardCalls).toHaveLength(1);
  });

  it('emits TenderAwardSent and TenderCompleted', async () => {
    const fx = buildFixture({});
    await fx.orch.triggerRun(baseTrigger);
    const types = fx.events.map((e) => e.type);
    expect(types).toContain('TenderAwardSent');
    expect(types).toContain('TenderCompleted');
  });
});

describe('TenderToContractOrchestrator — policy gating', () => {
  it('pauses award when autonomous mode is OFF', async () => {
    const fx = buildFixture({ policyEnabled: false });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('awaiting_approval');
    expect(fx.awardCalls).toHaveLength(0);
  });

  it('pauses award when amount exceeds threshold', async () => {
    const fx = buildFixture({ autoAwardUnderMinor: 10_000_00, topPickAmountMinor: 50_000_00 });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    const gated = run.steps.find((s) => s.stepName === 'award');
    expect(gated?.decision).toBe('awaiting_approval');
    expect(gated?.policyRule).toBe('procurement.over_auto_award_threshold');
  });

  it('resumes and completes after award approval', async () => {
    const fx = buildFixture({ autoAwardUnderMinor: 10_000_00 });
    const first = await fx.orch.triggerRun(baseTrigger);
    const resumed = await fx.orch.approveStep({
      runId: first.run.id,
      tenantId: 'tnt_a',
      stepName: 'award',
      approverUserId: 'u',
    });
    expect(resumed.status).toBe('completed');
    expect(fx.awardCalls).toHaveLength(1);
  });

  it('throws when approving a non-gated step', async () => {
    const fx = buildFixture({});
    const { run } = await fx.orch.triggerRun(baseTrigger);
    await expect(
      fx.orch.approveStep({
        runId: run.id,
        tenantId: 'tnt_a',
        stepName: 'publish_tender',
        approverUserId: 'u',
      }),
    ).rejects.toBeInstanceOf(TenderStepNotGatedError);
  });
});

describe('TenderToContractOrchestrator — failure + compensation', () => {
  it('compensates by rescinding the award when signing fails', async () => {
    const fx = buildFixture({ failSigning: true });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('compensated');
    expect(fx.rescindCalls).toHaveLength(1);
    expect(fx.events.map((e) => e.type)).toContain('TenderCompensated');
  });

  it('fails the run when the bid window returns empty', async () => {
    const fx = buildFixture({ emptyBids: true });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('failed');
    expect(run.lastError).toMatch(/no bids/i);
  });
});

describe('TenderToContractOrchestrator — retry + idempotency', () => {
  it('retries transient tender-publish failure', async () => {
    const fx = buildFixture({ failPublishTimes: 1, maxRetries: 2 });
    const { run } = await fx.orch.triggerRun(baseTrigger);
    expect(run.status).toBe('completed');
    const pub = run.steps.find((s) => s.stepName === 'publish_tender');
    expect(pub?.retryCount).toBeGreaterThanOrEqual(1);
  });

  it('throws when re-triggering a completed run', async () => {
    const fx = buildFixture({});
    await fx.orch.triggerRun(baseTrigger);
    await expect(fx.orch.triggerRun(baseTrigger)).rejects.toBeInstanceOf(
      TenderAlreadyCompletedError,
    );
  });
});
