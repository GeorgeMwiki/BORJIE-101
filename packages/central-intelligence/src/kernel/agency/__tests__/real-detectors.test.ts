/**
 * Tests for the REAL wake-trigger detectors.
 *
 *   arrears.30d-threshold
 *     - happy path: 2 overdue rows → 2 goal openers, each with the
 *       review + reminder + escalate steps.
 *     - edge: read port returns empty list → empty array.
 *
 *   lease.expiring-30d
 *     - happy path: 1 expiring row → 1 goal opener with renewal-window
 *       review step + reminder step.
 *     - edge: deps.leases undefined → empty array.
 *
 *   vacancy.30d-vacant
 *     - happy path: 1 row with rent/currency → 1 goal with review +
 *       publish steps.
 *     - edge: row missing rent/currency → goal emitted with ONLY the
 *       review step (no listing.publish).
 */
import { describe, it, expect } from 'vitest';
import {
  createArrears30dDetector,
  createLeaseExpiring30dDetector,
  createVacancy30dDetector,
  createRealWakeTriggers,
} from '../initiative/real-detectors.js';

const fixedClock = (): Date => new Date('2026-05-01T00:00:00Z');

describe('createArrears30dDetector', () => {
  it('happy path emits one goal opener per overdue lease', async () => {
    const trigger = createArrears30dDetector({
      arrears: {
        async listActiveOverdue(args) {
          expect(args.tenantId).toBe('t1');
          expect(args.minDaysOverdue).toBe(30);
          return [
            {
              leaseId: 'l_1',
              tenantId: 't1',
              customerId: 'c_1',
              daysOverdue: 33,
              unitCode: 'A-101',
            },
            {
              leaseId: 'l_2',
              tenantId: 't1',
              customerId: 'c_2',
              daysOverdue: 60,
              unitCode: null,
            },
          ];
        },
      },
    });

    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });

    expect(goals).toHaveLength(2);
    expect(goals[0]?.threadId).toBe('wake-arrears-l_1');
    expect(goals[0]?.title).toContain('A-101');
    expect(goals[0]?.priority).toBe('high');
    expect(goals[0]?.steps).toHaveLength(3);
    expect(goals[0]?.steps[0]?.toolName).toBeNull();
    expect(goals[0]?.steps[1]?.toolName).toBe('rent.send-reminder');
    expect(goals[0]?.steps[2]?.toolName).toBe('arrears.escalate');
  });

  it('edge: empty read port result returns empty array', async () => {
    const trigger = createArrears30dDetector({
      arrears: {
        async listActiveOverdue() {
          return [];
        },
      },
    });
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toEqual([]);
  });

  it('edge: no arrears port wired returns empty array', async () => {
    const trigger = createArrears30dDetector({});
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toEqual([]);
  });
});

describe('createLeaseExpiring30dDetector', () => {
  it('happy path emits one goal opener per expiring lease', async () => {
    const trigger = createLeaseExpiring30dDetector({
      leases: {
        async listExpiringWithin(args) {
          expect(args.windowDays).toBe(30);
          return [
            {
              leaseId: 'l_42',
              tenantId: 't1',
              customerId: 'c_42',
              endDate: '2026-05-25T00:00:00Z',
              unitCode: 'B-204',
            },
          ];
        },
      },
    });

    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });

    expect(goals).toHaveLength(1);
    expect(goals[0]?.threadId).toBe('wake-renewal-l_42');
    expect(goals[0]?.title).toContain('B-204');
    expect(goals[0]?.priority).toBe('medium');
    expect(goals[0]?.steps).toHaveLength(2);
    expect(goals[0]?.steps[1]?.toolName).toBe('rent.send-reminder');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      leaseId: 'l_42',
      channel: 'email',
    });
  });

  it('edge: undefined leases port returns empty array', async () => {
    const trigger = createLeaseExpiring30dDetector({});
    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });
    expect(goals).toEqual([]);
  });
});

describe('createVacancy30dDetector', () => {
  it('happy path emits review + publish steps when rent/currency present', async () => {
    const trigger = createVacancy30dDetector({
      vacancy: {
        async listLongVacant(args) {
          expect(args.minDaysVacant).toBe(30);
          return [
            {
              unitId: 'un_9',
              tenantId: 't1',
              propertyId: 'p_1',
              unitCode: 'C-301',
              headlineRent: 500000,
              currency: 'TZS',
              daysVacant: 45,
            },
          ];
        },
      },
    });

    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });

    expect(goals).toHaveLength(1);
    expect(goals[0]?.steps).toHaveLength(2);
    expect(goals[0]?.steps[1]?.toolName).toBe('listing.publish');
    expect(goals[0]?.steps[1]?.toolPayload).toMatchObject({
      unitId: 'un_9',
      headlineRent: 500000,
      currency: 'TZS',
    });
  });

  it('edge: missing headlineRent / currency emits ONLY the review step', async () => {
    const trigger = createVacancy30dDetector({
      vacancy: {
        async listLongVacant() {
          return [
            {
              unitId: 'un_10',
              tenantId: 't1',
              propertyId: 'p_1',
              unitCode: null,
              headlineRent: null,
              currency: null,
              daysVacant: 60,
            },
          ];
        },
      },
    });

    const goals = await trigger.detect({ tenantId: 't1', clock: fixedClock });

    expect(goals).toHaveLength(1);
    expect(goals[0]?.steps).toHaveLength(1);
    expect(goals[0]?.steps[0]?.toolName).toBeNull();
  });
});

describe('createRealWakeTriggers', () => {
  it('returns the full trio of detectors with stable IDs', () => {
    const triggers = createRealWakeTriggers({});
    expect(triggers.map((t) => t.id)).toEqual([
      'arrears.30d-threshold',
      'lease.expiring-30d',
      'vacancy.30d-vacant',
    ]);
  });

  it('uses resolveAssigneeUserId when provided', async () => {
    const triggers = createRealWakeTriggers({
      arrears: {
        async listActiveOverdue() {
          return [
            {
              leaseId: 'l_x',
              tenantId: 't1',
              customerId: 'c_x',
              daysOverdue: 31,
              unitCode: 'X-1',
            },
          ];
        },
      },
      async resolveAssigneeUserId(tenantId) {
        return `escalation-primary-${tenantId}`;
      },
    });
    const arrearsTrigger = triggers[0];
    expect(arrearsTrigger).toBeDefined();
    const goals = await arrearsTrigger!.detect({
      tenantId: 't1',
      clock: fixedClock,
    });
    expect(goals[0]?.userId).toBe('escalation-primary-t1');
  });
});
