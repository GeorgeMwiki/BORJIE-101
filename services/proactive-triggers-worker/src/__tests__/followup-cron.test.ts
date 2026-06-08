import { describe, expect, it, vi } from 'vitest';
import {
  createInMemoryCandidateRepository,
  createInMemoryPreferencesRepository,
  createInMemoryAuditChain,
  type ChannelDispatcher,
  type FollowupCandidate,
  type FollowupChannel,
  type SchedulerDeps,
} from '@borjie/user-followup';
import {
  createInMemoryScorecardRepository,
  createInMemoryKpiTemplateRepository,
  createInMemoryPerfNudgeRepository,
  createInMemoryAuditChain as createPerfAuditChain,
  stableHash,
  type DailyPerfCronDeps,
} from '@borjie/employee-perf-followup';
import { runFollowupCron } from '../schedule/followup-cron.js';
import type { TenantDirectory } from '../types.js';

/**
 * These tests prove the dispatch path the worker now drives:
 *   directory.listActiveTenants()
 *     -> runFollowupCron iterates tenants
 *       -> runSchedulerOnce pulls due candidates
 *         -> channel dispatcher delivers to the user
 *
 * The schedulers themselves are unit-tested inside their own packages;
 * here we verify the WORKER's orchestration + wiring, not their internal
 * suppression rules.
 */

function directory(tenants: string[]): TenantDirectory {
  return {
    async listActiveTenants() {
      return tenants;
    },
    async listActiveUsers() {
      return [];
    },
  };
}

function dueCandidate(over: Partial<FollowupCandidate> = {}): FollowupCandidate {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    tenant_id: 't1',
    user_id: 'u1',
    source: 'user_flag',
    payload: { text: 'Renew your PML licence' },
    priority: 0.9,
    channel: 'inapp',
    scheduled_for: '2000-01-01T00:00:00.000Z', // long past → due now
    status: 'pending',
    sent_at: null,
    audit_hash: '',
    created_at: '2000-01-01T00:00:00.000Z',
    critical: true, // bypass quiet hours + daily cap so delivery is deterministic
    ...over,
  };
}

function deliveringDispatcher(
  delivered: FollowupCandidate[],
): ChannelDispatcher {
  return {
    channel: 'inapp',
    async dispatch(candidate) {
      delivered.push(candidate);
      return { delivered: true, delivered_at: new Date().toISOString() };
    },
  };
}

async function buildUserFollowupDeps(args: {
  readonly candidates: FollowupCandidate[];
  readonly dispatchers: ReadonlyMap<FollowupChannel, ChannelDispatcher>;
}): Promise<SchedulerDeps> {
  const candidateRepo = createInMemoryCandidateRepository();
  for (const c of args.candidates) await candidateRepo.insert(c);
  return {
    candidateRepo,
    prefsRepo: createInMemoryPreferencesRepository(),
    dispatchers: args.dispatchers,
    audit: createInMemoryAuditChain(),
    clock: () => new Date('2026-06-08T12:00:00.000Z'),
  };
}

describe('runFollowupCron', () => {
  it('is a no-op when neither scheduler is wired', async () => {
    const info = vi.fn();
    const summary = await runFollowupCron({
      directory: directory(['t1']),
      wiring: {},
      logger: { info, warn: vi.fn() },
    });
    expect(summary.tenantsProcessed).toBe(0);
    expect(summary.userFollowupDispatched).toBe(0);
  });

  it('dispatches a due follow-up candidate to the user (scheduler -> sink -> user)', async () => {
    const delivered: FollowupCandidate[] = [];
    const dispatchers = new Map<FollowupChannel, ChannelDispatcher>([
      ['inapp', deliveringDispatcher(delivered)],
    ]);

    const summary = await runFollowupCron({
      directory: directory(['t1']),
      wiring: {
        userFollowup: {
          dispatchers,
          buildDepsForTenant: () =>
            buildUserFollowupDeps({
              candidates: [dueCandidate()],
              dispatchers,
            }),
        },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.tenantsProcessed).toBe(1);
    expect(summary.userFollowupDispatched).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(summary.results[0]?.status).toBe('ok');
  });

  it('skips a tenant whose buildDepsForTenant returns null', async () => {
    const summary = await runFollowupCron({
      directory: directory(['t1']),
      wiring: {
        userFollowup: {
          dispatchers: new Map(),
          buildDepsForTenant: () => null,
        },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(summary.results[0]?.status).toBe('skipped');
    expect(summary.userFollowupDispatched).toBe(0);
  });

  it('records a per-tenant scheduler failure and continues the pass', async () => {
    const warn = vi.fn();
    const summary = await runFollowupCron({
      directory: directory(['t1', 't2']),
      wiring: {
        userFollowup: {
          dispatchers: new Map(),
          buildDepsForTenant: (tenantId) => {
            if (tenantId === 't1') throw new Error('repo down');
            return null;
          },
        },
      },
      logger: { info: vi.fn(), warn },
    });
    expect(summary.tenantsProcessed).toBe(2);
    expect(summary.errored).toBe(1);
    expect(warn).toHaveBeenCalled();
  });

  it('runs the employee-perf daily cron branch (empty roster → ok with zero fires)', async () => {
    const perfDeps: DailyPerfCronDeps = {
      // Empty roster: the scheduler returns { fired: [], skipped: [] }
      // without touching the scorer machinery (covered in its own pkg).
      roster: { async listEmployees() { return []; } },
      templates: createInMemoryKpiTemplateRepository(),
      scorecards: createInMemoryScorecardRepository(),
      nudges: createInMemoryPerfNudgeRepository(),
      orgScope: {
        async resolveDirectSupervisor() { return null; },
        async resolveOwner() { return null; },
      },
      voice: { async readMode() { return 'balanced'; } },
      measurementPort: { async measure() { return 0; } },
      audit: createPerfAuditChain(),
      clock: () => new Date('2026-06-08T06:00:00.000Z'),
      hash: stableHash,
      newId: () => 'id-1',
    };

    const summary = await runFollowupCron({
      directory: directory(['t1']),
      wiring: {
        perfCron: { buildDepsForTenant: () => perfDeps },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.tenantsProcessed).toBe(1);
    expect(summary.perfNudgesEmitted).toBe(0);
    // perfCron branch ran (non-null) so the tenant is 'ok', not 'skipped'.
    expect(summary.results[0]?.status).toBe('ok');
    expect(summary.results[0]?.perfCron).not.toBeNull();
  });

  it('runs BOTH schedulers in one pass and rolls up their counts', async () => {
    const delivered: FollowupCandidate[] = [];
    const dispatchers = new Map<FollowupChannel, ChannelDispatcher>([
      ['inapp', deliveringDispatcher(delivered)],
    ]);
    const perfDeps: DailyPerfCronDeps = {
      roster: { async listEmployees() { return []; } },
      templates: createInMemoryKpiTemplateRepository(),
      scorecards: createInMemoryScorecardRepository(),
      nudges: createInMemoryPerfNudgeRepository(),
      orgScope: {
        async resolveDirectSupervisor() { return null; },
        async resolveOwner() { return null; },
      },
      voice: { async readMode() { return 'balanced'; } },
      measurementPort: { async measure() { return 0; } },
      audit: createPerfAuditChain(),
      clock: () => new Date('2026-06-08T06:00:00.000Z'),
      hash: stableHash,
      newId: () => 'id-1',
    };

    const summary = await runFollowupCron({
      directory: directory(['t1']),
      wiring: {
        userFollowup: {
          dispatchers,
          buildDepsForTenant: () =>
            buildUserFollowupDeps({ candidates: [dueCandidate()], dispatchers }),
        },
        perfCron: { buildDepsForTenant: () => perfDeps },
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(summary.userFollowupDispatched).toBe(1);
    expect(summary.perfNudgesEmitted).toBe(0);
    expect(summary.results[0]?.userFollowup).not.toBeNull();
    expect(summary.results[0]?.perfCron).not.toBeNull();
    expect(delivered).toHaveLength(1);
  });

  it('aborts cleanly when the tenant directory throws', async () => {
    const warn = vi.fn();
    const summary = await runFollowupCron({
      directory: {
        async listActiveTenants() {
          throw new Error('directory down');
        },
        async listActiveUsers() {
          return [];
        },
      },
      wiring: {
        userFollowup: { dispatchers: new Map(), buildDepsForTenant: () => null },
      },
      logger: { info: vi.fn(), warn },
    });
    expect(summary.tenantsProcessed).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
