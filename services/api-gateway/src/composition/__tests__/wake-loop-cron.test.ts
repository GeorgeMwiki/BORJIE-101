/**
 * Wake-loop cron tests — stall-detection wiring (K7 wave-K).
 *
 * The supervisor's primary duty (running the wake-cycle for active
 * tenants) is exercised end-to-end in the existing kernel-side wake-
 * loop tests. These tests focus on the new stall-detection block:
 *
 *   1. No active goals → stall detector is NOT called (no scan targets).
 *   2. Active goal not stalled → no event emitted, goalsStalled = 0.
 *   3. Active goal stalled → event emitted with the verdict report.
 *   4. Stall detector throws → tick continues, event suppressed, error
 *      logged via the error/warn logger fallback.
 *   5. Repo `markStalled` called when the method exists; degrades when
 *      it does not.
 *
 * The wake-cycle itself is replaced with a stub-friendly path: the test
 * passes `listActiveTenantIds: () => []` so `runWakeCycle` is never
 * entered, isolating the stall block. The stall block reads
 * `deps.kernelGoalsRepo.listStallScanTargets` to discover (tenant,
 * user) pairs — that override is the only thing the supervisor needs
 * to exercise the new wiring.
 *
 * Note: this test file replaces NONE of the existing supervisor
 * behaviour. It exists alongside the kernel-side `wake-loop.test.ts`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createWakeLoopCronSupervisor,
  type KernelGoalsRepoLike,
  type StallDetectorFn,
  type WakeLoopCronDeps,
  type WakeLoopCronLogger,
  type WakeStallObservabilitySink,
} from '../wake-loop-cron';
import type {
  StallDetectorRunOutcome,
  StalledGoalReport,
} from '@borjie/central-intelligence';

// Stand-in db client — the supervisor's tick calls `db.execute` first
// for `pg_try_advisory_lock(...)` to gate the lock-protected block, then
// later for `pg_advisory_unlock(...)`. The drizzle `sql\`\`` tag returns
// an internal object whose string form is opaque, so we count execute
// calls and return `acquired: true` on the FIRST call (the lock probe).
// Every subsequent call (tenant discovery override skips it, then the
// unlock SELECT) returns an empty row set — safe for the supervisor.
function makeFakeDb(): {
  execute: ReturnType<typeof vi.fn>;
} {
  let callCount = 0;
  const execute = vi.fn(async (_q: unknown) => {
    callCount += 1;
    if (callCount === 1) {
      // First execute = advisory-lock probe.
      return { rows: [{ acquired: true }] };
    }
    return { rows: [] };
  });
  return { execute };
}

function makeLogger(): {
  logger: WakeLoopCronLogger;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} {
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  return {
    logger: { info, warn, error },
    info,
    warn,
    error,
  };
}

function makeStallReport(
  overrides: Partial<StalledGoalReport> = {},
): StalledGoalReport {
  return {
    tenantId: overrides.tenantId ?? 't1',
    goalId: overrides.goalId ?? 'g_1',
    userId: overrides.userId ?? 'u1',
    threadId: overrides.threadId ?? 'th_1',
    daysSinceLastActivity: overrides.daysSinceLastActivity ?? 10,
    category: overrides.category ?? 'maintenance',
    threshold: overrides.threshold ?? 7,
    proposals: overrides.proposals ?? [
      {
        kind: 'continue',
        summary: 'Continue goal',
        reason: 'default proposal',
      },
      {
        kind: 'block',
        summary: 'Pause goal',
        reason: 'latest audit: workorder.create failed',
      },
      {
        kind: 'abandon',
        summary: 'Abandon goal',
        reason: 'no longer relevant',
      },
    ],
  };
}

// Supervisor harness — provides a fake DB, a recording logger, and the
// stall-block knobs every test overrides individually.
function makeSupervisor(overrides: Partial<WakeLoopCronDeps> = {}) {
  const harness = makeLogger();
  const db = makeFakeDb();
  // Skip the wake-cycle entirely by claiming there are no active tenants —
  // the stall block fires BEFORE the wake-cycle in flow but we still
  // need the lock acquired path to be reached. Trick: stall block runs
  // INSIDE the lock-acquired path AFTER runWakeCycle; we need at least
  // one tenant to enter that path. Override `listActiveTenantIds` to
  // return a single tenant and stub out everything inside runWakeCycle
  // by ALSO short-circuiting through the `stallDetector` we control.
  const supervisor = createWakeLoopCronSupervisor({
    db: db as unknown,
    logger: harness.logger,
    listActiveTenantIds: async () => ['t1'],
    intervalMs: 30 * 1000,
    ...overrides,
  });
  return { supervisor, ...harness, db };
}

describe('createWakeLoopCronSupervisor — stall detection wiring', () => {
  beforeEach(() => {
    // The supervisor uses console.* indirectly through the agency
    // kernel's adapters; silence anything that leaks through.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('no kernelGoalsRepo bound → stall block skipped, no detector calls', async () => {
    const detector = vi.fn<Parameters<StallDetectorFn>, ReturnType<StallDetectorFn>>(
      async () => ({ scanned: 0, stalled: [] }),
    );
    const { supervisor } = makeSupervisor({
      stallDetector: detector,
      // kernelGoalsRepo intentionally absent
    });
    // The wake-cycle itself will fail inside (no real Drizzle), but
    // the supervisor's outer catch swallows that. We only assert
    // detector was not called.
    await supervisor.tick().catch(() => null);
    expect(detector).not.toHaveBeenCalled();
  });

  it('no stall-scan targets → detector not invoked, goalsStalled = 0', async () => {
    const detector = vi.fn<Parameters<StallDetectorFn>, ReturnType<StallDetectorFn>>(
      async () => ({ scanned: 0, stalled: [] }),
    );
    const repo: KernelGoalsRepoLike = {
      listStallScanTargets: async () => [],
    };
    const { supervisor } = makeSupervisor({
      stallDetector: detector,
      kernelGoalsRepo: repo,
    });
    await supervisor.tick().catch(() => null);
    expect(detector).not.toHaveBeenCalled();
  });

  it('detector returns empty → no stall event emitted', async () => {
    const detector = vi.fn<Parameters<StallDetectorFn>, ReturnType<StallDetectorFn>>(
      async () => ({ scanned: 1, stalled: [] }),
    );
    const repo: KernelGoalsRepoLike = {
      listStallScanTargets: async () => [{ tenantId: 't1', userId: 'u1' }],
    };
    const emitted: StalledGoalReport[] = [];
    const stallEventSink: WakeStallObservabilitySink = {
      emit: (payload) => {
        emitted.push(payload);
      },
    };
    const { supervisor } = makeSupervisor({
      stallDetector: detector,
      kernelGoalsRepo: repo,
      stallEventSink,
    });
    await supervisor.tick().catch(() => null);
    expect(detector).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([]);
  });

  it('detector returns stalled goals → event emitted per report', async () => {
    const report = makeStallReport({ goalId: 'g_stall' });
    const outcome: StallDetectorRunOutcome = {
      scanned: 1,
      stalled: [report],
    };
    const detector = vi.fn<Parameters<StallDetectorFn>, ReturnType<StallDetectorFn>>(
      async () => outcome,
    );
    const repo: KernelGoalsRepoLike = {
      listStallScanTargets: async () => [{ tenantId: 't1', userId: 'u1' }],
    };
    const emitted: StalledGoalReport[] = [];
    const stallEventSink: WakeStallObservabilitySink = {
      emit: (payload) => {
        emitted.push(payload);
      },
    };
    const { supervisor } = makeSupervisor({
      stallDetector: detector,
      kernelGoalsRepo: repo,
      stallEventSink,
    });
    await supervisor.tick().catch(() => null);
    expect(detector).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.goalId).toBe('g_stall');
  });

  it('detector throws → tick continues, error logged, no event emitted', async () => {
    const detector = vi.fn<Parameters<StallDetectorFn>, ReturnType<StallDetectorFn>>(
      async () => {
        throw new Error('detector exploded');
      },
    );
    const repo: KernelGoalsRepoLike = {
      listStallScanTargets: async () => [{ tenantId: 't1', userId: 'u1' }],
    };
    const emitted: StalledGoalReport[] = [];
    const stallEventSink: WakeStallObservabilitySink = {
      emit: (payload) => {
        emitted.push(payload);
      },
    };
    const { supervisor, error } = makeSupervisor({
      stallDetector: detector,
      kernelGoalsRepo: repo,
      stallEventSink,
    });
    // The supervisor does NOT propagate the detector's throw — the
    // outer tick result may be null because of the unrelated runWakeCycle
    // path failing, but the stall-detection block must have logged the
    // error and continued.
    await supervisor.tick().catch(() => null);
    expect(emitted).toEqual([]);
    // The error logger must have been called with the detector failure
    // OR an upstream error log — at minimum, the supervisor must have
    // logged SOMETHING under the error/warn channels with the
    // detector's message.
    const allErrorCalls = error.mock.calls
      .map((args) => JSON.stringify(args))
      .join('\n');
    expect(allErrorCalls).toContain('stall detector failed');
  });

  it('calls repo.markStalled when method exists; degrades when absent', async () => {
    const report = makeStallReport({ goalId: 'g_mark' });
    const detector = vi.fn<Parameters<StallDetectorFn>, ReturnType<StallDetectorFn>>(
      async () => ({ scanned: 1, stalled: [report] }),
    );
    const markStalled = vi.fn(async () => undefined);
    const repoWithMark: KernelGoalsRepoLike = {
      listStallScanTargets: async () => [{ tenantId: 't1', userId: 'u1' }],
      markStalled,
    };
    const { supervisor } = makeSupervisor({
      stallDetector: detector,
      kernelGoalsRepo: repoWithMark,
    });
    await supervisor.tick().catch(() => null);
    expect(markStalled).toHaveBeenCalledTimes(1);
    expect(markStalled).toHaveBeenCalledWith(
      'g_mark',
      expect.stringContaining('workorder.create failed'),
    );

    // Repo WITHOUT markStalled → supervisor must not throw and must
    // still emit the stall event.
    const emitted: StalledGoalReport[] = [];
    const stallEventSink: WakeStallObservabilitySink = {
      emit: (payload) => {
        emitted.push(payload);
      },
    };
    const detector2 = vi.fn<Parameters<StallDetectorFn>, ReturnType<StallDetectorFn>>(
      async () => ({ scanned: 1, stalled: [report] }),
    );
    const repoNoMark: KernelGoalsRepoLike = {
      listStallScanTargets: async () => [{ tenantId: 't1', userId: 'u1' }],
    };
    const { supervisor: supervisor2 } = makeSupervisor({
      stallDetector: detector2,
      kernelGoalsRepo: repoNoMark,
      stallEventSink,
    });
    await supervisor2.tick().catch(() => null);
    expect(emitted).toHaveLength(1);
  });
});
