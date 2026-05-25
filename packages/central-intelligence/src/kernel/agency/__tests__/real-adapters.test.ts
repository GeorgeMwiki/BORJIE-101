/**
 * Tests for the REAL action-tool adapters.
 *
 *   - One smoke test per tool (5 happy-path cases).
 *   - One additional test that confirms the honest-error path when the
 *     domain port is undefined.
 *
 * The adapters never depend on real Drizzle / API gateway services;
 * they delegate to small duck-typed ports that the tests stub
 * inline.
 */
import { describe, it, expect } from 'vitest';
import {
  createRentSendReminderRealTool,
  createWorkOrderCreateRealTool,
  createInspectionScheduleRealTool,
  createArrearsEscalateRealTool,
  createListingPublishRealTool,
  createRealActionTools,
} from '../action-tools/real-adapters.js';
import type { ActionToolContext } from '../action-tools/types.js';

const ctx: ActionToolContext = {
  tenantId: 't_demo',
  userId: 'u_alice',
};

describe('real action-tool adapters', () => {
  it('rent.send-reminder delegates to the notifications port (happy path)', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const tool = createRentSendReminderRealTool({
      notifications: {
        async sendRentReminder(args) {
          calls.push({ ...args });
          return { id: 'notif_1' };
        },
      },
    });

    const result = await tool.invoke(
      { leaseId: 'l_42', channel: 'sms' },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.id).toBe('notif_1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      tenantId: 't_demo',
      leaseId: 'l_42',
      channel: 'sms',
    });
  });

  it('work-order.create delegates to the work-orders port (happy path)', async () => {
    const tool = createWorkOrderCreateRealTool({
      workOrders: {
        async create(args) {
          expect(args.createdByUserId).toBe('u_alice');
          expect(args.priority).toBe('high');
          return { id: 'wo_99' };
        },
      },
    });

    const result = await tool.invoke(
      {
        propertyId: 'p_1',
        unitId: 'un_1',
        description: 'Leak in kitchen',
        priority: 'high',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.id).toBe('wo_99');
  });

  it('inspection.schedule delegates to the inspections port (happy path)', async () => {
    const tool = createInspectionScheduleRealTool({
      inspections: {
        async schedule(args) {
          expect(args.scheduledFor).toBe('2026-06-01T10:00:00Z');
          expect(args.inspectorId).toBe('insp_7');
          return { id: 'insp_event_1' };
        },
      },
    });

    const result = await tool.invoke(
      {
        unitId: 'un_2',
        scheduledFor: '2026-06-01T10:00:00Z',
        inspectorId: 'insp_7',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.id).toBe('insp_event_1');
  });

  it('arrears.escalate delegates to the arrears port (happy path)', async () => {
    const tool = createArrearsEscalateRealTool({
      arrears: {
        async escalate(args) {
          expect(args.ladderStep).toBe(2);
          return { id: 'arr_step_2' };
        },
      },
    });

    const result = await tool.invoke({ leaseId: 'l_3', ladderStep: 2 }, ctx);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.id).toBe('arr_step_2');
  });

  it('listing.publish delegates to the marketplace port (happy path)', async () => {
    const tool = createListingPublishRealTool({
      marketplace: {
        async publishListing(args) {
          expect(args.headlineRent).toBe(750000);
          expect(args.currency).toBe('TZS');
          expect(args.marketplaceId).toBe('mp_1');
          return { id: 'list_1' };
        },
      },
    });

    const result = await tool.invoke(
      {
        unitId: 'un_5',
        headlineRent: 750000,
        currency: 'TZS',
        marketplaceId: 'mp_1',
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.output.id).toBe('list_1');
  });

  it('returns honest-error result when the domain port is unavailable', async () => {
    const tool = createRentSendReminderRealTool({});
    const result = await tool.invoke(
      { leaseId: 'l_x', channel: 'email' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/service not yet wired/i);
  });

  it('createRealActionTools returns the full bundle of five real tools', () => {
    const bundle = createRealActionTools({});
    expect(bundle).toHaveLength(5);
    const names = bundle.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'arrears.escalate',
        'inspection.schedule',
        'listing.publish',
        'rent.send-reminder',
        'work-order.create',
      ].sort(),
    );
  });
});
