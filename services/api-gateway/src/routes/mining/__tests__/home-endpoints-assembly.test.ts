/**
 * Anti-fabrication contract for the workforce-mobile HOME endpoints
 * (A3 SitePulse · A4 CrewRoster · A5 employee shift+performance).
 *
 * These pins assert the wire-assembly rule the fix exists to enforce: every
 * metric is either wired to a REAL source or emitted as an honest `null` —
 * NEVER a fabricated 0/1/sentinel that a KPI tile would render as a fact. The
 * pure assemblers are exercised cold (same pattern as brief.hono.ts slot
 * computers) so the honest-null behaviour is provable without a live DB.
 */

import { describe, expect, it } from 'vitest';
import {
  assembleSitePulse,
  shiftKeyForHour,
} from '../site-pulse';
import { adaptCrewMember, adaptCrewRoster, crewStatusFor } from '../crew-roster';
import {
  adaptMyPerformance,
  adaptMyShift,
} from '../my-attendance';

describe('A3 — assembleSitePulse honest-nulls unwired metrics', () => {
  it('wires crew/alerts/safety to real inputs and nulls the unwired KPIs', () => {
    const pulse = assembleSitePulse({
      siteName: 'Nyakabale North',
      crewOnShift: 12,
      openCriticalCount: 0,
      openHighCount: 2,
      localHour: 9,
    });
    // Real-source fields.
    expect(pulse.siteName).toBe('Nyakabale North');
    expect(pulse.crewOnShift).toBe(12);
    expect(pulse.alertsCount).toBe(2);
    expect(pulse.safetyStatus).toBe('amber');
    expect(pulse.shiftKey).toBe('day');
    // Honest-null fields — NO fabricated number. This is the defect guard.
    expect(pulse.planAttainmentPct).toBeNull();
    expect(pulse.crewExpected).toBeNull();
    expect(pulse.equipmentAvailabilityPct).toBeNull();
  });

  it('flips safety to red on any open critical, green on none', () => {
    expect(
      assembleSitePulse({
        siteName: null,
        crewOnShift: null,
        openCriticalCount: 1,
        openHighCount: 5,
        localHour: 20,
      }),
    ).toMatchObject({ safetyStatus: 'red', alertsCount: 6, shiftKey: 'night', crewOnShift: null });
    expect(
      assembleSitePulse({
        siteName: null,
        crewOnShift: 0,
        openCriticalCount: 0,
        openHighCount: 0,
        localHour: 12,
      }),
    ).toMatchObject({ safetyStatus: 'green', alertsCount: 0 });
  });

  it('labels shift by local clock (day 06:00–17:59, else night)', () => {
    expect(shiftKeyForHour(6)).toBe('day');
    expect(shiftKeyForHour(17)).toBe('day');
    expect(shiftKeyForHour(18)).toBe('night');
    expect(shiftKeyForHour(5)).toBe('night');
    expect(shiftKeyForHour(0)).toBe('night');
  });
});

describe('A4 — crew roster maps real fields, nulls workload/equipment', () => {
  it('derives status from attendance and honest-nulls the unwired fields', () => {
    const member = adaptCrewMember({
      id: 'emp-1',
      fullName: 'Asha Mwakalinga',
      role: 'driller',
      attendanceStatus: 'present',
    });
    expect(member).toEqual({
      id: 'emp-1',
      fullName: 'Asha Mwakalinga',
      role: 'driller',
      status: 'on_site',
      workloadPct: null,
      equipmentPaired: null,
    });
  });

  it('maps every attendance status onto the crew vocabulary; no row → off', () => {
    expect(crewStatusFor('present')).toBe('on_site');
    expect(crewStatusFor('late')).toBe('late');
    expect(crewStatusFor('absent')).toBe('absent');
    expect(crewStatusFor('sick')).toBe('absent');
    expect(crewStatusFor('leave')).toBe('absent');
    // No attendance row today must NOT fabricate an on-site claim.
    expect(crewStatusFor(null)).toBe('off');
    expect(crewStatusFor('weird')).toBe('off');
  });

  it('adapts a full roster preserving order', () => {
    const rows = adaptCrewRoster([
      { id: 'a', fullName: 'A', role: 'r', attendanceStatus: 'present' },
      { id: 'b', fullName: 'B', role: 'r', attendanceStatus: null },
    ]);
    expect(rows.map((r) => r.status)).toEqual(['on_site', 'off']);
    expect(rows.every((r) => r.workloadPct === null)).toBe(true);
  });
});

describe('A5 — my shift is real state, never a fabricated running timer', () => {
  const NOW = new Date('2026-07-04T10:00:00.000Z');

  it('no row → honest not-started shift (zero timer, no site)', () => {
    expect(adaptMyShift(null, '2026-07-04', NOW)).toEqual({
      id: '',
      state: 'not-started',
      status: 'unknown',
      clockedInAtIso: null,
      siteName: null,
      elapsedSeconds: 0,
    });
  });

  it('open row started today → in-progress with a REAL elapsed count', () => {
    const shift = adaptMyShift(
      {
        id: 'att-1',
        status: 'present',
        hoursWorked: null,
        signedOffAt: '2026-07-04T08:00:00.000Z',
        workDate: '2026-07-04',
      },
      '2026-07-04',
      NOW,
    );
    expect(shift.state).toBe('in-progress');
    expect(shift.status).toBe('present');
    // 08:00 → 10:00 = exactly 2h. A real derived duration, not a constant.
    expect(shift.elapsedSeconds).toBe(2 * 3600);
  });

  it('closed row → ended with a zero timer (never a fabricated run)', () => {
    const shift = adaptMyShift(
      {
        id: 'att-2',
        status: 'present',
        hoursWorked: '8.00',
        signedOffAt: '2026-07-04T08:00:00.000Z',
        workDate: '2026-07-04',
      },
      '2026-07-04',
      NOW,
    );
    expect(shift.state).toBe('ended');
    expect(shift.elapsedSeconds).toBe(0);
  });

  it('stale open row from a prior day → ended, not a runaway timer', () => {
    const shift = adaptMyShift(
      {
        id: 'att-3',
        status: 'present',
        hoursWorked: null,
        signedOffAt: '2026-07-01T08:00:00.000Z',
        workDate: '2026-07-01',
      },
      '2026-07-04',
      NOW,
    );
    expect(shift.state).toBe('ended');
    expect(shift.elapsedSeconds).toBe(0);
  });
});

describe('A5 — performance snapshot is a real shift count with no fake trend', () => {
  it('metricValue = shifts worked; deltaPct 0 when no prior baseline', () => {
    const snap = adaptMyPerformance(5, 7, null);
    expect(snap.metricValue).toBe(5);
    expect(snap.deltaPct).toBe(0);
    expect(snap.rangeDays).toBe(7);
    // Locale-parallel copy — both sw+en present, no cross-language fallback.
    expect(snap.metricLabelSw).toBe('Zamu zilizofanyika');
    expect(snap.metricLabelEn).toBe('Shifts worked');
    expect(snap.metricUnitSw).toBe('zamu');
    expect(snap.metricUnitEn).toBe('shifts');
  });

  it('deltaPct is driven by a REAL prior-window count when present', () => {
    // 6 this week vs 4 last week = +50%.
    expect(adaptMyPerformance(6, 7, 4).deltaPct).toBe(50);
    // Empty prior window stays 0 (division-by-zero → no invented trend).
    expect(adaptMyPerformance(6, 7, 0).deltaPct).toBe(0);
  });
});
