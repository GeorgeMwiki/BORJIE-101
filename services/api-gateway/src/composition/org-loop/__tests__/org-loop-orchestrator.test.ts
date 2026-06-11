/**
 * org-loop-orchestrator.test.ts — locks the SELF-RUNNING-ORG SPINE contract:
 *
 *   1. the happy thread: a due commitment → run CREATED (close-the-loop
 *      back-edge) → strategize + match called → dispatcher.dispatch fired →
 *      run ADVANCED with the taskId forward-edge → owner brief surfaced
 *      through the gated sink.
 *   2. the HITL guard: a HIGH/sovereign assignment is PROPOSED for owner
 *      approval, NOT executed (dispatcher.dispatch never called).
 *   3. fault isolation: a throwing strategist/matcher/dispatcher advances the
 *      run to `failed` and returns a `failed` outcome — it NEVER throws into
 *      the caller.
 *   4. de-dupe: a commitment that already has a dispatched run is skipped.
 *   5. the sweep: tickOnce threads every delegatable commitment across active
 *      tenants and counts the outcomes; the kill-switch / test-env gate keeps
 *      start() inert.
 *   6. the LoopSpec: the spine registers as a builtin loop-economy LoopSpec.
 */

import { describe, expect, it, vi } from 'vitest';

import { createInMemoryOrgLoopRunRepository } from '@borjie/database';
import type {
  MdCommitment,
  MdCommitmentRepository,
} from '@borjie/database/repositories';
import type { ScoredCandidate } from '@borjie/workforce-orchestrator';

import {
  createOrgLoopOrchestrator,
  needsDelegation,
  previewRequiresApproval,
  strategyToMatchNeed,
  ORG_LOOP_SPEC_ID,
  type CockpitPublisher,
  type PersonMatcherPort,
  type ProposalSinkPort,
} from '../org-loop-orchestrator.js';
import type { GapBriefingPort } from '../gap-briefing-port.js';
import type { StrategizePort, StrategyTrace } from '../strategize-port.js';
import type {
  TaskDispatchPort,
  TaskDispatchResult,
} from '../task-dispatch-port.js';
import type { PinoLikeLogger } from '../../../utils/pino-shim.js';

// ─────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────

function silentLogger(): PinoLikeLogger {
  const noop = (): void => {};
  return { info: noop, warn: noop, error: noop } as unknown as PinoLikeLogger;
}

function commitment(overrides: Partial<MdCommitment> = {}): MdCommitment {
  return {
    id: 'cmt_1',
    tenantId: 'tenant_1',
    ownerId: 'mwikila',
    threadId: null,
    class: 'next_action',
    kind: 'general',
    title: 'Restock the pump spares for shift coverage',
    titleSw: 'Jaza vipuri vya pampu',
    rationale: 'Spares are low and the crew needs coverage.',
    evidenceIds: ['ev_1', 'ev_2'],
    triggerKind: 'event',
    triggerSpec: {},
    triggerDueAtMs: null,
    status: 'open',
    rungLevel: 0,
    sovereign: false,
    lastNudgedAtMs: null,
    ackedAtMs: null,
    confirmedAtMs: null,
    confirmationKind: null,
    blockedReason: null,
    attemptCount: 0,
    attemptFailedCount: 0,
    gapAuditSeq: 0,
    auditChainHash: null,
    idempotencyKey: 'idem_1',
    gapKind: null,
    blockedBy: [],
    unblockTrigger: null,
    competenceDomain: null,
    createdAtMs: 0,
    updatedAtMs: 0,
    ...overrides,
  } as MdCommitment;
}

function trace(overrides: Partial<StrategyTrace> = {}): StrategyTrace {
  return {
    taskShape: {
      title: 'Restock the pump spares',
      description: 'Order replacement pump spares so the crew has coverage.',
      priority: 'medium',
      competenceDomain: 'procurement',
    },
    rationale: 'Spares are low.',
    urgency: 'medium',
    evidenceIds: ['ev_1', 'ev_2'],
    source: 'deterministic',
    ...overrides,
  };
}

function candidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    employeeId: 'emp_top',
    score: 0.9,
    reasons: ['cert match', 'low load'],
    confidence: 0.82,
    ...overrides,
  };
}

function stubStrategist(out: StrategyTrace | (() => Promise<never>)): StrategizePort {
  return {
    async strategize() {
      if (typeof out === 'function') return out();
      return out;
    },
  };
}

function stubMatcher(out: ScoredCandidate[] | (() => Promise<never>)): PersonMatcherPort {
  return {
    async match() {
      if (typeof out === 'function') return out();
      return out;
    },
  };
}

function dispatchResult(over: Partial<TaskDispatchResult> = {}): TaskDispatchResult {
  return {
    taskId: 'task_123',
    riskTier: 'LOW',
    hitlRequired: false,
    notificationDelivered: true,
    followupCount: 2,
    ...over,
  };
}

function stubBriefer(): GapBriefingPort & { calls: number } {
  const port = {
    calls: 0,
    brief(run: unknown, locale?: 'en' | 'sw') {
      port.calls += 1;
      return {
        tenantId: 'tenant_1',
        id: 'gap:cmt_1',
        driveId: 'procurement' as never,
        title: 'Restock the pump spares',
        rationale: 'note',
        locale: locale ?? 'en',
        urgency: 'medium' as never,
        breachSeverity: 0,
        evidenceEntityIds: ['ev_1'],
        proposedAtMs: 0,
      } as ReturnType<GapBriefingPort['brief']>;
    },
  };
  return port;
}

function stubSink(): ProposalSinkPort & { proposals: number } {
  const sink = {
    proposals: 0,
    async propose() {
      sink.proposals += 1;
      return true;
    },
  };
  return sink;
}

function stubCockpit(): CockpitPublisher & { events: unknown[] } {
  const cockpit = {
    events: [] as unknown[],
    publish(event: unknown) {
      cockpit.events.push(event);
    },
  };
  return cockpit;
}

/** A minimal commitment repo whose only live method is listLive (sweep path). */
function stubCommitmentRepo(
  live: ReadonlyArray<MdCommitment>,
): MdCommitmentRepository {
  return {
    async listLive() {
      return live;
    },
  } as unknown as MdCommitmentRepository;
}

const TEST_DEPS_BASE = {
  logger: silentLogger(),
  enabled: false as const,
  listActiveTenantIds: null,
};

// ─────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────

describe('pure helpers', () => {
  it('strategyToMatchNeed carries the competence domain', () => {
    expect(strategyToMatchNeed(trace()).competenceDomain).toBe('procurement');
  });

  it('previewRequiresApproval gates a high-risk task shape', () => {
    const safe = trace();
    expect(previewRequiresApproval(safe)).toBe(false);
    const risky = trace({
      taskShape: {
        title: 'Terminate the employee for the safety violation',
        description: 'Process the termination and final pay.',
        priority: 'urgent',
        competenceDomain: 'workforce',
      },
    });
    expect(previewRequiresApproval(risky)).toBe(true);
  });

  it('needsDelegation includes open/overdue/reopened, not done', () => {
    expect(needsDelegation(commitment({ status: 'open' }))).toBe(true);
    expect(needsDelegation(commitment({ status: 'overdue' }))).toBe(true);
    expect(needsDelegation(commitment({ status: 'reopened' }))).toBe(true);
    expect(needsDelegation(commitment({ status: 'scheduled' }))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// The happy thread
// ─────────────────────────────────────────────────────────────────────

describe('onCommitmentDue — the happy thread', () => {
  it('creates a run, dispatches, advances with the taskId, and briefs the owner', async () => {
    const runRepo = createInMemoryOrgLoopRunRepository();
    const briefer = stubBriefer();
    const sink = stubSink();
    const cockpit = stubCockpit();
    const dispatch = vi.fn(async () => dispatchResult());
    const dispatcher: TaskDispatchPort = { dispatch };

    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo,
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([candidate()]),
      dispatcher,
      briefer,
      proposalSink: sink,
      cockpit,
    });

    const outcome = await orch.onCommitmentDue('tenant_1', commitment());

    expect(outcome.kind).toBe('dispatched');
    expect(dispatch).toHaveBeenCalledTimes(1);
    // The dispatch trace threads the chosen employee + the commitment evidence.
    const dispatchArg = dispatch.mock.calls[0]![0];
    expect(dispatchArg.chosenEmployeeId).toBe('emp_top');
    expect(dispatchArg.evidenceIds).toEqual(['ev_1', 'ev_2']);
    expect(dispatchArg.commitmentId).toBe('cmt_1');

    // The run is durable + carries the forward-edge taskId + the back-edge.
    const run = await runRepo.findByCommitment('tenant_1', 'cmt_1');
    expect(run).not.toBeNull();
    expect(run!.taskId).toBe('task_123');
    expect(run!.chosenEmployeeId).toBe('emp_top');
    expect(run!.commitmentId).toBe('cmt_1');
    expect(run!.loopKind).toBe(ORG_LOOP_SPEC_ID);

    // The owner was briefed through the gated sink.
    expect(briefer.calls).toBe(1);
    expect(sink.proposals).toBe(1);
    // The cockpit feed observed the advance.
    expect(cockpit.events.length).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────
// The HITL guard
// ─────────────────────────────────────────────────────────────────────

describe('onCommitmentDue — HITL guard', () => {
  it('PROPOSES a HIGH/sovereign assignment for owner approval, never executes it', async () => {
    const runRepo = createInMemoryOrgLoopRunRepository();
    const sink = stubSink();
    const dispatch = vi.fn(async () => dispatchResult());
    const dispatcher: TaskDispatchPort = { dispatch };

    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo,
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([candidate()]),
      dispatcher,
      briefer: stubBriefer(),
      proposalSink: sink,
    });

    // sovereign flag forces the HITL path even for an otherwise-safe shape.
    const outcome = await orch.onCommitmentDue(
      'tenant_1',
      commitment({ sovereign: true }),
    );

    expect(outcome.kind).toBe('proposed_for_approval');
    // The load-bearing rail: the assignment was NOT auto-executed.
    expect(dispatch).not.toHaveBeenCalled();
    // The owner was still surfaced the brief for approval.
    expect(sink.proposals).toBe(1);
    const run = await runRepo.findByCommitment('tenant_1', 'cmt_1');
    expect(run!.taskId).toBeNull();
    expect(run!.chosenEmployeeId).toBe('emp_top');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Fault isolation
// ─────────────────────────────────────────────────────────────────────

describe('onCommitmentDue — fault isolation', () => {
  it('advances the run to failed (never throws) when the dispatcher faults', async () => {
    const runRepo = createInMemoryOrgLoopRunRepository();
    const dispatcher: TaskDispatchPort = {
      async dispatch() {
        throw new Error('boom: employee not found');
      },
    };

    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo,
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([candidate()]),
      dispatcher,
      briefer: stubBriefer(),
      proposalSink: stubSink(),
    });

    const outcome = await orch.onCommitmentDue('tenant_1', commitment());
    expect(outcome.kind).toBe('failed');

    const run = await runRepo.findByCommitment('tenant_1', 'cmt_1');
    expect(run!.status).toBe('failed');
  });

  it('returns failed when the strategist throws (run never created)', async () => {
    const runRepo = createInMemoryOrgLoopRunRepository();
    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo,
      strategist: stubStrategist(async () => {
        throw new Error('strategize blew up');
      }),
      personMatcher: stubMatcher([candidate()]),
      dispatcher: { async dispatch() { return dispatchResult(); } },
      briefer: stubBriefer(),
      proposalSink: stubSink(),
    });

    const outcome = await orch.onCommitmentDue('tenant_1', commitment());
    expect(outcome.kind).toBe('failed');
  });

  it('skips (parks at pick) when no candidate matches', async () => {
    const runRepo = createInMemoryOrgLoopRunRepository();
    const dispatch = vi.fn(async () => dispatchResult());
    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo,
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([]),
      dispatcher: { dispatch },
      briefer: stubBriefer(),
      proposalSink: stubSink(),
    });

    const outcome = await orch.onCommitmentDue('tenant_1', commitment());
    expect(outcome.kind).toBe('skipped');
    expect(dispatch).not.toHaveBeenCalled();
    const run = await runRepo.findByCommitment('tenant_1', 'cmt_1');
    expect(run!.stage).toBe('pick');
  });
});

// ─────────────────────────────────────────────────────────────────────
// De-dupe
// ─────────────────────────────────────────────────────────────────────

describe('onCommitmentDue — de-dupe', () => {
  it('skips a commitment that already has a dispatched run', async () => {
    const runRepo = createInMemoryOrgLoopRunRepository();
    // Seed a run that already carries a taskId (already dispatched).
    const seeded = await runRepo.create({
      tenantId: 'tenant_1',
      commitmentId: 'cmt_1',
    });
    await runRepo.advance('tenant_1', seeded.id, { taskId: 'task_pre' });

    const dispatch = vi.fn(async () => dispatchResult());
    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo,
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([candidate()]),
      dispatcher: { dispatch },
      briefer: stubBriefer(),
      proposalSink: stubSink(),
    });

    const outcome = await orch.onCommitmentDue('tenant_1', commitment());
    expect(outcome.kind).toBe('skipped');
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// The sweep + the gate
// ─────────────────────────────────────────────────────────────────────

describe('tickOnce — the sweep', () => {
  it('threads delegatable commitments across active tenants and counts outcomes', async () => {
    const runRepo = createInMemoryOrgLoopRunRepository();
    const dispatch = vi.fn(async () => dispatchResult());
    const live = [
      commitment({ id: 'cmt_a', idempotencyKey: 'idem_a', status: 'open' }),
      commitment({ id: 'cmt_b', idempotencyKey: 'idem_b', status: 'scheduled' }), // filtered out
    ];

    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo(live),
      runRepo,
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([candidate()]),
      dispatcher: { dispatch },
      briefer: stubBriefer(),
      proposalSink: stubSink(),
      listActiveTenantIds: async () => ['tenant_1'],
    });

    const result = await orch.tickOnce();
    expect(result.tenantsScanned).toBe(1);
    // Only the open commitment is threaded (scheduled is filtered out).
    expect(result.commitmentsThreaded).toBe(1);
    expect(result.dispatched).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('keeps start() inert under the test/kill-switch gate', () => {
    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo: createInMemoryOrgLoopRunRepository(),
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([candidate()]),
      dispatcher: { async dispatch() { return dispatchResult(); } },
      briefer: stubBriefer(),
      proposalSink: stubSink(),
    });
    expect(orch.enabled).toBe(false);
    // start()/stop() are safe no-ops when disabled.
    expect(() => {
      orch.start();
      orch.stop();
    }).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────
// The LoopSpec
// ─────────────────────────────────────────────────────────────────────

describe('loopSpec', () => {
  it('registers the spine as a builtin loop-economy LoopSpec', () => {
    const orch = createOrgLoopOrchestrator({
      ...TEST_DEPS_BASE,
      commitmentRepo: stubCommitmentRepo([]),
      runRepo: createInMemoryOrgLoopRunRepository(),
      strategist: stubStrategist(trace()),
      personMatcher: stubMatcher([candidate()]),
      dispatcher: { async dispatch() { return dispatchResult(); } },
      briefer: stubBriefer(),
      proposalSink: stubSink(),
    });
    expect(orch.loopSpec.id).toBe(ORG_LOOP_SPEC_ID);
    expect(orch.loopSpec.origin).toBe('builtin');
    expect(orch.loopSpec.trigger.kind).toBe('tick');
  });
});
