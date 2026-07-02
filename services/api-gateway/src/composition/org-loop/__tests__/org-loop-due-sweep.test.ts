/**
 * org-loop-due-sweep.test.ts — proves the FAST-PATH `onCommitmentDue` has a
 * production caller (RED before wiring: zero callers).
 *
 * The due-sweep scans `listDueByTime(tenantId, now)` per active tenant and
 * threads each DUE, delegatable commitment through `onCommitmentDue`. The tests
 * assert:
 *   - a due commitment INVOKES `onCommitmentDue` (the dark synapse fires);
 *   - the call is TENANT-SCOPED (listDueByTime + onCommitmentDue receive the
 *     tenant id — no cross-tenant read, no RLS-darkness);
 *   - non-delegatable due rows (e.g. status 'done'/'scheduled') are filtered;
 *   - a store fault degrades that tenant and never throws;
 *   - the fast-path's own de-dupe (skipped) is honoured (re-scan safe).
 */

import { describe, expect, it, vi } from 'vitest';

import type { MdCommitment, MdCommitmentRepository } from '@borjie/database/repositories';
import type { PinoLikeLogger } from '../../../utils/pino-shim.js';
import type { OrgLoopThreadOutcome } from '../org-loop-types.js';
import {
  createOrgLoopDueSweep,
  type DueSweepOrchestrator,
} from '../org-loop-due-sweep.js';

function silentLogger(): PinoLikeLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => silentLogger()),
  } as unknown as PinoLikeLogger;
}

function commitment(over: Partial<MdCommitment> = {}): MdCommitment {
  return {
    id: 'cmt_1',
    tenantId: 'tenant_1',
    status: 'overdue',
    triggerKind: 'time',
    triggerDueAtMs: 1_000,
    evidenceIds: [],
    sovereign: false,
    ...over,
  } as unknown as MdCommitment;
}

/** A repo whose `listDueByTime` returns the given rows per tenant. */
function stubDueRepo(
  byTenant: Record<string, ReadonlyArray<MdCommitment>>,
): { repo: Pick<MdCommitmentRepository, 'listDueByTime'>; calls: string[] } {
  const calls: string[] = [];
  const repo = {
    async listDueByTime(tenantId: string) {
      calls.push(tenantId);
      return byTenant[tenantId] ?? [];
    },
  } as unknown as Pick<MdCommitmentRepository, 'listDueByTime'>;
  return { repo, calls };
}

function stubOrchestrator(
  outcome: OrgLoopThreadOutcome = { kind: 'dispatched', runId: 'run_1', taskId: 'task_1', chosenEmployeeId: 'emp_1' },
): DueSweepOrchestrator & { calls: Array<{ tenantId: string; commitmentId: string }> } {
  const calls: Array<{ tenantId: string; commitmentId: string }> = [];
  return {
    calls,
    async onCommitmentDue(tenantId, c) {
      calls.push({ tenantId, commitmentId: c.id });
      return outcome;
    },
  };
}

describe('org-loop-due-sweep — fast-path caller', () => {
  it('a DUE commitment INVOKES onCommitmentDue (the dark synapse fires)', async () => {
    const { repo } = stubDueRepo({ tenant_1: [commitment({ id: 'cmt_a' })] });
    const orch = stubOrchestrator();
    const sweep = createOrgLoopDueSweep({
      commitmentRepo: repo,
      orchestrator: orch,
      listActiveTenantIds: async () => ['tenant_1'],
      logger: silentLogger(),
      enabled: false,
    });

    const result = await sweep.tickOnce();

    // The wiring: onCommitmentDue was actually called for the due commitment.
    expect(orch.calls).toHaveLength(1);
    expect(orch.calls[0]).toEqual({ tenantId: 'tenant_1', commitmentId: 'cmt_a' });
    expect(result.commitmentsDue).toBe(1);
    expect(result.threaded).toBe(1);
    expect(result.dispatched).toBe(1);
  });

  it('is TENANT-SCOPED: listDueByTime + onCommitmentDue both receive the tenant id', async () => {
    const { repo, calls: repoCalls } = stubDueRepo({
      tenant_a: [commitment({ id: 'cmt_a', tenantId: 'tenant_a' })],
      tenant_b: [commitment({ id: 'cmt_b', tenantId: 'tenant_b' })],
    });
    const orch = stubOrchestrator();
    const sweep = createOrgLoopDueSweep({
      commitmentRepo: repo,
      orchestrator: orch,
      listActiveTenantIds: async () => ['tenant_a', 'tenant_b'],
      logger: silentLogger(),
      enabled: false,
    });

    await sweep.tickOnce();

    // listDueByTime is bound per-tenant (no un-scoped global read).
    expect(repoCalls).toEqual(['tenant_a', 'tenant_b']);
    // Each commitment is delegated under ITS OWN tenant (no cross-tenant leak).
    expect(orch.calls).toEqual([
      { tenantId: 'tenant_a', commitmentId: 'cmt_a' },
      { tenantId: 'tenant_b', commitmentId: 'cmt_b' },
    ]);
  });

  it('filters non-delegatable due rows (done / scheduled are NOT threaded)', async () => {
    const { repo } = stubDueRepo({
      tenant_1: [
        commitment({ id: 'live', status: 'overdue' }),
        commitment({ id: 'closed', status: 'done' }),
        commitment({ id: 'sched', status: 'scheduled' }),
      ],
    });
    const orch = stubOrchestrator();
    const sweep = createOrgLoopDueSweep({
      commitmentRepo: repo,
      orchestrator: orch,
      listActiveTenantIds: async () => ['tenant_1'],
      logger: silentLogger(),
      enabled: false,
    });

    await sweep.tickOnce();

    expect(orch.calls).toEqual([{ tenantId: 'tenant_1', commitmentId: 'live' }]);
  });

  it('honours the fast-path de-dupe (a skipped outcome does not dispatch)', async () => {
    const { repo } = stubDueRepo({ tenant_1: [commitment({ id: 'dup' })] });
    const orch = stubOrchestrator({ kind: 'skipped', reason: 'already dispatched (live run carries a taskId)' });
    const sweep = createOrgLoopDueSweep({
      commitmentRepo: repo,
      orchestrator: orch,
      listActiveTenantIds: async () => ['tenant_1'],
      logger: silentLogger(),
      enabled: false,
    });

    const result = await sweep.tickOnce();

    expect(orch.calls).toHaveLength(1); // it was still THREADED (called once)…
    expect(result.dispatched).toBe(0); // …but the fast-path's de-dupe skipped it.
    expect(result.skipped).toBe(1);
  });

  it('degrades a tenant on a store fault and never throws', async () => {
    const orch = stubOrchestrator();
    const repo = {
      async listDueByTime() {
        throw new Error('boom');
      },
    } as unknown as Pick<MdCommitmentRepository, 'listDueByTime'>;
    const sweep = createOrgLoopDueSweep({
      commitmentRepo: repo,
      orchestrator: orch,
      listActiveTenantIds: async () => ['tenant_1'],
      logger: silentLogger(),
      enabled: false,
    });

    const result = await sweep.tickOnce();

    expect(orch.calls).toHaveLength(0);
    expect(result.failed).toBe(1);
    expect(result.tenantsScanned).toBe(1);
  });

  it('is inert with no tenant source (null lister → no scan)', async () => {
    const { repo, calls } = stubDueRepo({ tenant_1: [commitment()] });
    const orch = stubOrchestrator();
    const sweep = createOrgLoopDueSweep({
      commitmentRepo: repo,
      orchestrator: orch,
      listActiveTenantIds: null,
      logger: silentLogger(),
      enabled: false,
    });

    const result = await sweep.tickOnce();

    expect(calls).toHaveLength(0);
    expect(orch.calls).toHaveLength(0);
    expect(result.tenantsScanned).toBe(0);
  });

  it('start() is inert under the test/kill-switch gate (enabled=false)', () => {
    const { repo } = stubDueRepo({});
    const sweep = createOrgLoopDueSweep({
      commitmentRepo: repo,
      orchestrator: stubOrchestrator(),
      listActiveTenantIds: async () => [],
      logger: silentLogger(),
      enabled: false,
    });
    expect(sweep.enabled).toBe(false);
    expect(() => sweep.start()).not.toThrow();
    sweep.stop();
  });
});
