/**
 * FarService — happy path + cross-tenant isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import { asTenantId, asUserId } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import {
  FarService,
  FarScheduler,
  FarServiceError,
  type AssetComponent,
  type FarAssignment,
  type ConditionCheckEvent,
  type FarRepository,
  type NotificationDispatcher,
} from '../far/index.js';

const tenantA = asTenantId('tnt_a');
const tenantB = asTenantId('tnt_b');
const propertyId = 'prop_1' as any;
const userId = asUserId('usr_1');

function createRepo(): FarRepository {
  const comps = new Map<string, AssetComponent>();
  const assigns = new Map<string, FarAssignment>();
  const events: ConditionCheckEvent[] = [];

  return {
    async findComponentById(id, tenantId) {
      const c = comps.get(id);
      if (!c || c.tenantId !== tenantId) return null;
      return c;
    },
    async findAssignmentById(id, tenantId) {
      const a = assigns.get(id);
      if (!a || a.tenantId !== tenantId) return null;
      return a;
    },
    async createComponent(c) {
      comps.set(c.id, c);
      return c;
    },
    async createAssignment(a) {
      assigns.set(a.id, a);
      return a;
    },
    async updateAssignment(a) {
      assigns.set(a.id, a);
      return a;
    },
    async createCheckEvent(e) {
      events.push(e);
      return e;
    },
    async findDueAssignments(tenantId, now) {
      const nowMs = new Date(now).getTime();
      return Array.from(assigns.values()).filter(
        (a) =>
          (tenantId === null || a.tenantId === tenantId) &&
          a.status === 'active' &&
          a.nextCheckDueAt &&
          new Date(a.nextCheckDueAt).getTime() <= nowMs
      );
    },
    async findScheduledChecks(tenantId, componentId) {
      return events.filter(
        (e) =>
          e.tenantId === tenantId &&
          (componentId === undefined || e.componentId === componentId)
      );
    },
  };
}

function createEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('FarService', () => {
  it('adds a component, assigns monitoring (auto-schedules first check), logs a check', async () => {
    const repo = createRepo();
    const svc = new FarService(repo, createEventBus());

    const compRes = await svc.addComponent({
      tenantId: tenantA,
      propertyId,
      code: 'ROOF-01',
      name: 'Main roof',
      createdBy: userId,
    });
    expect(compRes.success).toBe(true);
    if (!compRes.success) return;

    const assignRes = await svc.assignMonitoring({
      tenantId: tenantA,
      componentId: compRes.data.id,
      frequency: 'monthly',
      createdBy: userId,
    });
    expect(assignRes.success).toBe(true);
    if (!assignRes.success) return;
    expect(assignRes.data.nextCheckDueAt).not.toBeNull();

    const scheduled = await svc.getScheduledChecks(tenantA, compRes.data.id);
    expect(scheduled.success).toBe(true);
    if (!scheduled.success) return;
    expect(scheduled.data.length).toBe(1); // the auto-scheduled first check

    const logRes = await svc.logCheck({
      tenantId: tenantA,
      assignmentId: assignRes.data.id,
      performedBy: userId,
      outcome: 'pass',
      conditionAfter: 'good',
    });
    expect(logRes.success).toBe(true);
  });

  it('blocks cross-tenant component access', async () => {
    const repo = createRepo();
    const svc = new FarService(repo, createEventBus());

    const compRes = await svc.addComponent({
      tenantId: tenantA,
      propertyId,
      code: 'ROOF-02',
      name: 'Garage roof',
      createdBy: userId,
    });
    if (!compRes.success) return;

    const assignRes = await svc.assignMonitoring({
      tenantId: tenantB, // wrong tenant
      componentId: compRes.data.id,
      frequency: 'quarterly',
      createdBy: userId,
    });
    expect(assignRes.success).toBe(false);
    if (assignRes.success) return;
    expect(assignRes.error.code).toBe(FarServiceError.COMPONENT_NOT_FOUND);
  });

  it('FarScheduler fans out notifications to recipients when due', async () => {
    const repo = createRepo();
    const svc = new FarService(repo, createEventBus());
    const dispatcher: NotificationDispatcher = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    };
    const scheduler = new FarScheduler(repo, dispatcher);

    const comp = await svc.addComponent({
      tenantId: tenantA,
      propertyId,
      code: 'BOILER-01',
      name: 'Boiler',
      createdBy: userId,
    });
    if (!comp.success) return;

    await svc.assignMonitoring({
      tenantId: tenantA,
      componentId: comp.data.id,
      frequency: 'weekly',
      notifyRecipients: [
        { role: 'landlord', userId, email: 'l@e.com', phone: null },
        { role: 'manager', userId, email: 'm@e.com', phone: null },
        { role: 'vendor', userId, email: 'v@e.com', phone: null },
      ],
      createdBy: userId,
    });

    // Move time forward past the weekly due window.
    const future = new Date(Date.now() + 8 * 86400_000).toISOString() as any;
    const fired = await scheduler.run({ tenantId: tenantA, now: future });
    expect(fired.length).toBe(1);
    expect((dispatcher.dispatch as any).mock.calls.length).toBe(3);
  });
});
