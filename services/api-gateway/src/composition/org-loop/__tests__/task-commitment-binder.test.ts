/**
 * task-commitment-binder.test.ts — locks the SELF-RUNNING-ORG spine RE-LOOP
 * CLOSURE binder:
 *
 *   1. a `mwikila.acted` / `mining.task.complete` event → findByTask → markDone
 *      (positive proof) + the run advances to stage/status `closed`, and the
 *      owner cockpit gets a closure pulse;
 *   2. an event for a task with NO loop-run is a clean no-op (markDone never
 *      called) — not every task is spine-spawned;
 *   3. a non-completion event (wrong kind / wrong actionKind / malformed
 *      summary) is a clean no-op;
 *   4. the verification spot-check sample is DETERMINISTIC (a stable hash of the
 *      taskId, never an RNG) — the same taskId always yields the same verdict,
 *      and a sampled+flagged closure feeds a down-weight to the matcher;
 *   5. faults are CONTAINED — a markDone throw never propagates into the bus.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInMemoryMdCommitmentRepository,
  createInMemoryOrgLoopRunRepository,
  type MdCommitmentRepository,
  type OrgLoopRunRepository,
} from '@borjie/database/repositories';

import {
  createTaskCommitmentBinder,
  isSampledForVerification,
  sampleBucketForTask,
  parseTaskCompleteEvent,
  type CockpitPublishPort,
  type PerformanceDownWeight,
  type PerformanceSink,
} from '../task-commitment-binder.js';
import type { PinoLikeLogger } from '../../../utils/pino-shim.js';
import type { CockpitEvent } from '../../../services/cockpit-events/types.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function silentLogger(): PinoLikeLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function capturingCockpit(): CockpitPublishPort & {
  readonly events: CockpitEvent[];
} {
  const events: CockpitEvent[] = [];
  return {
    events,
    publish: (event) => {
      events.push(event);
    },
  };
}

function capturingSink(): PerformanceSink & {
  readonly signals: PerformanceDownWeight[];
} {
  const signals: PerformanceDownWeight[] = [];
  return {
    signals,
    downWeight: async (signal) => {
      signals.push(signal);
    },
  };
}

const TENANT = 'tenant_1';
const FIXED_CLOCK = () => new Date('2026-06-11T10:00:00.000Z');

/** Build a `mwikila.acted` / `mining.task.complete` event for a taskId. */
function completeEvent(taskId: string, overrides: Partial<CockpitEvent> = {}): CockpitEvent {
  return {
    kind: 'mwikila.acted',
    tenantId: TENANT,
    emittedAt: '2026-06-11T09:59:00.000Z',
    actionId: taskId,
    actionKind: 'mining.task.complete',
    category: 'task-completion',
    delegationTier: 'T0',
    summary: JSON.stringify({
      taskId,
      parentRfbId: null,
      assignee: 'user_7',
      status: 'done',
      title: 'Renew licence',
    }),
    ...overrides,
  } as CockpitEvent;
}

/**
 * Seed a closed-able run for a commitment. Creates the originating commitment
 * (evidence-required) + an org_loop_run joined to the task, returns the ids.
 */
async function seedRun(
  commitmentRepo: MdCommitmentRepository,
  runRepo: OrgLoopRunRepository,
  taskId: string,
  chosenEmployeeId: string | null = 'emp_7',
): Promise<{ commitmentId: string; runId: string }> {
  const commitment = await commitmentRepo.create({
    tenantId: TENANT,
    class: 'next_action',
    title: 'Renew the mining licence',
    titleSw: 'Fanya upya leseni ya madini',
    rationale: 'It blocks new permits',
    evidenceIds: ['ev_a'],
    triggerKind: 'condition',
    triggerSpec: {},
    idempotencyKey: `idem_${taskId}`,
  });
  const run = await runRepo.create({
    tenantId: TENANT,
    commitmentId: commitment.id,
    taskId,
    chosenEmployeeId,
    stage: 'guide',
    status: 'active',
    strategyJson: { competenceDomain: 'compliance' },
    evidenceIds: ['ev_a'],
  });
  return { commitmentId: commitment.id, runId: run.id };
}

// ---------------------------------------------------------------------------
// Pure-helper determinism
// ---------------------------------------------------------------------------

describe('task-commitment-binder · deterministic sample gate', () => {
  it('sampleBucketForTask is STABLE — same taskId always maps to the same bucket', () => {
    const a = sampleBucketForTask('task_abc');
    const b = sampleBucketForTask('task_abc');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(1);
  });

  it('isSampledForVerification is deterministic across repeated calls', () => {
    for (const id of ['t1', 't2', 'task_99', 'olr_xyz']) {
      expect(isSampledForVerification(id)).toBe(isSampledForVerification(id));
    }
  });

  it('roughly ~15% of a large id space is sampled (deterministic, no RNG)', () => {
    let sampled = 0;
    const N = 5000;
    for (let i = 0; i < N; i += 1) {
      if (isSampledForVerification(`task_${i}`)) sampled += 1;
    }
    const rate = sampled / N;
    // FNV-1a is well-distributed; the sampled fraction sits near the 0.15 rate.
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.2);
  });
});

describe('task-commitment-binder · parseTaskCompleteEvent', () => {
  it('extracts the taskId from a well-formed completion event', () => {
    const parsed = parseTaskCompleteEvent(completeEvent('task_1'));
    expect(parsed).not.toBeNull();
    expect(parsed?.taskId).toBe('task_1');
    expect(parsed?.tenantId).toBe(TENANT);
  });

  it('returns null for a non-acted kind', () => {
    const event = {
      kind: 'risk.changed',
      tenantId: TENANT,
      emittedAt: '2026-06-11T09:59:00.000Z',
      riskId: 'r1',
      severity: 'high',
      previousSeverity: null,
    } as CockpitEvent;
    expect(parseTaskCompleteEvent(event)).toBeNull();
  });

  it('returns null for an acted event with a different actionKind', () => {
    const event = completeEvent('task_1', {
      actionKind: 'mining.licence.renew',
    } as Partial<CockpitEvent>);
    expect(parseTaskCompleteEvent(event)).toBeNull();
  });

  it('returns null for a malformed summary (not JSON / missing taskId)', () => {
    expect(
      parseTaskCompleteEvent(
        completeEvent('x', { summary: 'not-json' } as Partial<CockpitEvent>),
      ),
    ).toBeNull();
    expect(
      parseTaskCompleteEvent(
        completeEvent('x', {
          summary: JSON.stringify({ status: 'done' }),
        } as Partial<CockpitEvent>),
      ),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The closure synapse
// ---------------------------------------------------------------------------

describe('task-commitment-binder · onMwikilaActed', () => {
  let commitmentRepo: MdCommitmentRepository;
  let runRepo: OrgLoopRunRepository;
  let cockpit: ReturnType<typeof capturingCockpit>;

  beforeEach(() => {
    commitmentRepo = createInMemoryMdCommitmentRepository();
    runRepo = createInMemoryOrgLoopRunRepository();
    cockpit = capturingCockpit();
  });

  it('closes the loop: findByTask → markDone (proof) + run advances to closed + cockpit pulse', async () => {
    const taskId = 'task_close_1';
    const { commitmentId, runId } = await seedRun(commitmentRepo, runRepo, taskId);

    const binder = createTaskCommitmentBinder({
      runRepo,
      commitmentRepo,
      cockpit,
      logger: silentLogger(),
      clock: FIXED_CLOCK,
    });

    await binder.onMwikilaActed(completeEvent(taskId));

    // The originating commitment is DONE with the positive-proof kind.
    const closedCommitment = await commitmentRepo.get(TENANT, commitmentId);
    expect(closedCommitment?.status).toBe('done');
    expect(closedCommitment?.confirmationKind).toBe('task_completed');
    expect(closedCommitment?.confirmedAtMs).toBe(
      Date.parse('2026-06-11T09:59:00.000Z'),
    );

    // The run advanced to its terminal stage/status.
    const closedRun = await runRepo.findByTask(TENANT, taskId);
    expect(closedRun?.id).toBe(runId);
    expect(closedRun?.stage).toBe('closed');
    expect(closedRun?.status).toBe('closed');

    // The owner cockpit got a closure pulse.
    expect(cockpit.events).toHaveLength(1);
    expect(cockpit.events[0]?.kind).toBe('decision.recorded');
    expect(cockpit.events[0]?.tenantId).toBe(TENANT);
  });

  it('is a clean no-op for a task with NO loop-run (markDone never called)', async () => {
    const markDone = vi.spyOn(commitmentRepo, 'markDone');
    const binder = createTaskCommitmentBinder({
      runRepo,
      commitmentRepo,
      cockpit,
      logger: silentLogger(),
      clock: FIXED_CLOCK,
    });

    await binder.onMwikilaActed(completeEvent('orphan_task'));

    expect(markDone).not.toHaveBeenCalled();
    expect(cockpit.events).toHaveLength(0);
  });

  it('is a clean no-op for a non-completion event', async () => {
    const markDone = vi.spyOn(commitmentRepo, 'markDone');
    const findByTask = vi.spyOn(runRepo, 'findByTask');
    const binder = createTaskCommitmentBinder({
      runRepo,
      commitmentRepo,
      cockpit,
      logger: silentLogger(),
      clock: FIXED_CLOCK,
    });

    await binder.onMwikilaActed(
      completeEvent('task_x', {
        actionKind: 'mining.licence.renew',
      } as Partial<CockpitEvent>),
    );

    expect(findByTask).not.toHaveBeenCalled();
    expect(markDone).not.toHaveBeenCalled();
  });

  it('a replayed completion for an already-closed run is idempotent (no double pulse)', async () => {
    const taskId = 'task_idem_1';
    await seedRun(commitmentRepo, runRepo, taskId);
    const binder = createTaskCommitmentBinder({
      runRepo,
      commitmentRepo,
      cockpit,
      logger: silentLogger(),
      clock: FIXED_CLOCK,
    });

    await binder.onMwikilaActed(completeEvent(taskId));
    await binder.onMwikilaActed(completeEvent(taskId));

    // Only the first close pulsed; the replay short-circuited.
    expect(cockpit.events).toHaveLength(1);
  });

  it('feeds a matcher down-weight for a deterministically-sampled closure', async () => {
    // Find a taskId that the deterministic gate samples, so the test is stable.
    let sampledTaskId = '';
    for (let i = 0; i < 1000; i += 1) {
      const id = `sampled_task_${i}`;
      if (isSampledForVerification(id)) {
        sampledTaskId = id;
        break;
      }
    }
    expect(sampledTaskId).not.toBe('');

    await seedRun(commitmentRepo, runRepo, sampledTaskId, 'emp_down');
    const sink = capturingSink();
    const binder = createTaskCommitmentBinder({
      runRepo,
      commitmentRepo,
      cockpit,
      performanceSink: sink,
      logger: silentLogger(),
      clock: FIXED_CLOCK,
    });

    await binder.onMwikilaActed(completeEvent(sampledTaskId));

    expect(sink.signals).toHaveLength(1);
    expect(sink.signals[0]?.employeeId).toBe('emp_down');
    expect(sink.signals[0]?.competenceDomain).toBe('compliance');
    expect(sink.signals[0]?.taskId).toBe(sampledTaskId);
  });

  it('does NOT down-weight a closure the gate does not sample', async () => {
    // Find a taskId the gate does NOT sample.
    let unsampledTaskId = '';
    for (let i = 0; i < 1000; i += 1) {
      const id = `unsampled_task_${i}`;
      if (!isSampledForVerification(id)) {
        unsampledTaskId = id;
        break;
      }
    }
    expect(unsampledTaskId).not.toBe('');

    await seedRun(commitmentRepo, runRepo, unsampledTaskId, 'emp_ok');
    const sink = capturingSink();
    const binder = createTaskCommitmentBinder({
      runRepo,
      commitmentRepo,
      cockpit,
      performanceSink: sink,
      logger: silentLogger(),
      clock: FIXED_CLOCK,
    });

    await binder.onMwikilaActed(completeEvent(unsampledTaskId));

    expect(sink.signals).toHaveLength(0);
  });

  it('contains a markDone fault — never throws into the bus', async () => {
    const taskId = 'task_fault_1';
    await seedRun(commitmentRepo, runRepo, taskId);
    vi.spyOn(commitmentRepo, 'markDone').mockRejectedValueOnce(
      new Error('db down'),
    );
    const binder = createTaskCommitmentBinder({
      runRepo,
      commitmentRepo,
      cockpit,
      logger: silentLogger(),
      clock: FIXED_CLOCK,
    });

    // Must resolve (not reject) — the fault is contained.
    await expect(binder.onMwikilaActed(completeEvent(taskId))).resolves.toBeUndefined();
  });
});
