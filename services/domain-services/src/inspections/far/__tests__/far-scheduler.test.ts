/**
 * FarScheduler — fan-out notification scanner (NEW 16).
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId, asUserId } from '@borjie/domain-models';
import { FarScheduler, type NotificationDispatcher } from '../far-scheduler.js';
import {
  asFarAssignmentId,
  asAssetComponentId,
  type FarAssignment,
  type FarRepository,
  type NotifyRecipient,
} from '../types.js';

const tenantA = asTenantId('tnt_a');
const userId = asUserId('usr_1');

function makeAssignment(
  overrides: Partial<FarAssignment> = {},
): FarAssignment {
  const recipients: readonly NotifyRecipient[] = [
    { role: 'landlord', userId, email: 'l@x.com', phone: null },
    { role: 'manager', userId, email: 'm@x.com', phone: null },
    { role: 'vendor', userId: null, email: 'v@x.com', phone: null },
  ];
  return {
    id: asFarAssignmentId('far_1'),
    tenantId: tenantA,
    componentId: asAssetComponentId('comp_1'),
    assignedTo: userId,
    frequency: 'monthly',
    status: 'active',
    triggerRules: {},
    firstCheckDueAt: '2026-05-01T00:00:00Z' as never,
    nextCheckDueAt: '2026-05-08T00:00:00Z' as never,
    lastCheckedAt: null,
    notifyRecipients: recipients,
    createdAt: '2026-04-01T00:00:00Z' as never,
    updatedAt: '2026-04-01T00:00:00Z' as never,
    createdBy: userId,
    updatedBy: userId,
    ...overrides,
  };
}

function makeRepo(due: readonly FarAssignment[] = []): FarRepository {
  return {
    findComponentById: vi.fn(),
    findAssignmentById: vi.fn(),
    createComponent: vi.fn(),
    createAssignment: vi.fn(),
    updateAssignment: vi.fn(),
    createCheckEvent: vi.fn(),
    findDueAssignments: vi.fn(async () => due),
    findScheduledChecks: vi.fn(async () => []),
  } as unknown as FarRepository;
}

function makeDispatcher() {
  return { dispatch: vi.fn(async () => undefined) } satisfies NotificationDispatcher;
}

describe('FarScheduler.run', () => {
  it('returns empty array when no assignments due', async () => {
    const repo = makeRepo([]);
    const dispatcher = makeDispatcher();
    const scheduler = new FarScheduler(repo, dispatcher);

    const result = await scheduler.run();
    expect(result).toEqual([]);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches one notification per recipient on each due assignment', async () => {
    const assignment = makeAssignment();
    const repo = makeRepo([assignment]);
    const dispatcher = makeDispatcher();
    const scheduler = new FarScheduler(repo, dispatcher);

    const result = await scheduler.run();
    expect(result).toHaveLength(1);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
    const firstCall = dispatcher.dispatch.mock.calls[0]?.[0];
    expect(firstCall?.tenantId).toBe(tenantA);
    expect(firstCall?.context.assignmentId).toBe(assignment.id);
  });

  it('skips dispatch when no recipients configured', async () => {
    const assignment = makeAssignment({ notifyRecipients: [] });
    const repo = makeRepo([assignment]);
    const dispatcher = makeDispatcher();
    const scheduler = new FarScheduler(repo, dispatcher);

    const result = await scheduler.run();
    expect(result).toHaveLength(1);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('continues notifying remaining recipients when one dispatch fails', async () => {
    const assignment = makeAssignment();
    const repo = makeRepo([assignment]);
    const dispatcher: NotificationDispatcher = {
      dispatch: vi
        .fn()
        .mockRejectedValueOnce(new Error('SMTP down'))
        .mockResolvedValue(undefined),
    };
    // Suppress the eslint-disable console.error — replace with spy.
    const errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const scheduler = new FarScheduler(repo, dispatcher);

    const result = await scheduler.run();
    expect(result).toHaveLength(1);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(3);
    errSpy.mockRestore();
  });

  it('forwards options.tenantId and options.now to repository', async () => {
    const repo = makeRepo([]);
    const dispatcher = makeDispatcher();
    const scheduler = new FarScheduler(repo, dispatcher);
    const now = '2030-01-01T00:00:00Z' as never;

    await scheduler.run({ tenantId: tenantA, now });
    expect(repo.findDueAssignments).toHaveBeenCalledWith(tenantA, now);
  });

  it('passes null tenantId when option omitted', async () => {
    const repo = makeRepo([]);
    const scheduler = new FarScheduler(repo, makeDispatcher());

    await scheduler.run();
    const args = (repo.findDueAssignments as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(args[0]).toBeNull();
  });

  it('processes multiple due assignments in sequence', async () => {
    const a1 = makeAssignment({ id: asFarAssignmentId('far_1') });
    const a2 = makeAssignment({ id: asFarAssignmentId('far_2') });
    const repo = makeRepo([a1, a2]);
    const dispatcher = makeDispatcher();
    const scheduler = new FarScheduler(repo, dispatcher);

    const result = await scheduler.run();
    expect(result).toHaveLength(2);
    // 3 recipients × 2 assignments = 6 dispatches
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(6);
  });

  it('includes componentId and frequency in dispatch context', async () => {
    const assignment = makeAssignment({ frequency: 'quarterly' });
    const repo = makeRepo([assignment]);
    const dispatcher = makeDispatcher();
    const scheduler = new FarScheduler(repo, dispatcher);

    await scheduler.run();
    const call = dispatcher.dispatch.mock.calls[0]?.[0];
    expect(call?.context.componentId).toBe(assignment.componentId);
    expect(call?.context.frequency).toBe('quarterly');
  });
});
