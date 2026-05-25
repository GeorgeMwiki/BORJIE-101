/**
 * Breach notification tests.
 *
 * Verifies that the right regulators are notified within the right
 * windows for each jurisdiction, and that letter generation produces
 * one letter per (jurisdiction × recipient).
 */

import { describe, expect, it } from 'vitest';

import {
  BREACH_SLAS,
  generateBreachLetters,
  recordBreach,
  requiredNotifications,
} from '../breach/index.js';
import type { BreachLetterRecipient } from '../breach/service.js';

describe('breach: SLA table', () => {
  it('GDPR (EU) = 72h to regulator', () => {
    expect(BREACH_SLAS.EU.notifyRegulatorWithinHours).toBe(72);
  });
  it('Rwanda = 48h to regulator (the tightest SLA)', () => {
    expect(BREACH_SLAS.RW.notifyRegulatorWithinHours).toBe(48);
  });
  it('CCPA (US-CA) has no regulator deadline (private right of action only)', () => {
    expect(BREACH_SLAS['US-CA'].regulator).toBeNull();
    expect(BREACH_SLAS['US-CA'].notifyRegulatorWithinHours).toBeNull();
  });
});

describe('breach: recordBreach', () => {
  it('returns a frozen event with id', () => {
    const ev = recordBreach({
      severity: 'high',
      scope: 'database leak in eu-west-1',
      detectedAt: new Date('2026-01-01T00:00:00.000Z'),
      affectedJurisdictions: ['EU'],
      affectedTenantIds: ['t_1'],
      piiInScope: ['email', 'full_name'],
      subjectsAffectedCount: 1000,
      id: 'b_test_1',
    });
    expect(ev.id).toBe('b_test_1');
    expect(ev.severity).toBe('high');
    expect(Object.isFrozen(ev)).toBe(true);
  });

  it('throws if affectedJurisdictions is empty', () => {
    expect(() =>
      recordBreach({
        severity: 'low',
        scope: 's',
        detectedAt: new Date(),
        affectedJurisdictions: [],
        affectedTenantIds: [],
        piiInScope: [],
        subjectsAffectedCount: 0,
      }),
    ).toThrow(/non-empty/);
  });

  it('throws on negative subject count', () => {
    expect(() =>
      recordBreach({
        severity: 'low',
        scope: 's',
        detectedAt: new Date(),
        affectedJurisdictions: ['EU'],
        affectedTenantIds: [],
        piiInScope: [],
        subjectsAffectedCount: -1,
      }),
    ).toThrow(/cannot be negative/);
  });
});

describe('breach: requiredNotifications', () => {
  it('GDPR high-severity → regulator deadline 72h after detection, subjects notified', () => {
    const ev = recordBreach({
      severity: 'high',
      scope: 'db leak',
      detectedAt: new Date('2026-01-01T00:00:00.000Z'),
      affectedJurisdictions: ['EU'],
      affectedTenantIds: ['t_1'],
      piiInScope: ['email'],
      subjectsAffectedCount: 100,
      id: 'b_1',
    });
    const plan = requiredNotifications(ev);
    expect(plan.entries).toHaveLength(1);
    const entry = plan.entries[0]!;
    expect(entry.jurisdiction).toBe('EU');
    expect(entry.regulator).toMatch(/EDPB/);
    expect(entry.regulatorDeadline).toBe('2026-01-04T00:00:00.000Z');
    expect(entry.mustNotifySubjects).toBe(true);
  });

  it('Rwanda critical-severity → 48h deadline', () => {
    const ev = recordBreach({
      severity: 'critical',
      scope: 'breach',
      detectedAt: new Date('2026-01-01T00:00:00.000Z'),
      affectedJurisdictions: ['RW'],
      affectedTenantIds: ['t_1'],
      piiInScope: ['email'],
      subjectsAffectedCount: 10,
      id: 'b_2',
    });
    const plan = requiredNotifications(ev);
    expect(plan.entries[0]?.regulatorDeadline).toBe('2026-01-03T00:00:00.000Z');
  });

  it('low severity → no regulator deadline, no subject notification', () => {
    const ev = recordBreach({
      severity: 'low',
      scope: 'minor anomaly',
      detectedAt: new Date('2026-01-01T00:00:00.000Z'),
      affectedJurisdictions: ['EU'],
      affectedTenantIds: ['t_1'],
      piiInScope: [],
      subjectsAffectedCount: 0,
      id: 'b_3',
    });
    const plan = requiredNotifications(ev);
    expect(plan.entries[0]?.regulatorDeadline).toBeNull();
    expect(plan.entries[0]?.mustNotifySubjects).toBe(false);
  });

  it('multi-jurisdiction breach yields one plan entry per jurisdiction', () => {
    const ev = recordBreach({
      severity: 'high',
      scope: 'global leak',
      detectedAt: new Date('2026-01-01T00:00:00.000Z'),
      affectedJurisdictions: ['EU', 'KE', 'NG'],
      affectedTenantIds: ['t_1', 't_2'],
      piiInScope: ['email'],
      subjectsAffectedCount: 10_000,
      id: 'b_4',
    });
    const plan = requiredNotifications(ev);
    expect(plan.entries).toHaveLength(3);
    expect(new Set(plan.entries.map((e) => e.jurisdiction))).toEqual(
      new Set(['EU', 'KE', 'NG']),
    );
  });
});

describe('breach: generateBreachLetters', () => {
  it('produces one letter per (jurisdiction × recipient)', () => {
    const ev = recordBreach({
      severity: 'high',
      scope: 's',
      detectedAt: new Date('2026-01-01T00:00:00.000Z'),
      affectedJurisdictions: ['EU', 'TZ'],
      affectedTenantIds: ['t_1'],
      piiInScope: ['email'],
      subjectsAffectedCount: 5,
      id: 'b_5',
    });
    const recipients: BreachLetterRecipient[] = [
      { kind: 'regulator', name: 'ICO', contact: 'breaches@ico.org.uk' },
      { kind: 'subject', subjectId: 's_1', contact: 'alice@x' },
    ];
    const letters = generateBreachLetters(ev, recipients);
    expect(letters).toHaveLength(4); // 2 jurisdictions × 2 recipients
    for (const l of letters) {
      expect(l.subject).toContain('Personal Data Breach');
      expect(l.body).toContain(ev.id);
    }
  });

  it('regulator vs subject bodies differ', () => {
    const ev = recordBreach({
      severity: 'high',
      scope: 's',
      detectedAt: new Date('2026-01-01T00:00:00.000Z'),
      affectedJurisdictions: ['EU'],
      affectedTenantIds: ['t_1'],
      piiInScope: ['email'],
      subjectsAffectedCount: 5,
      id: 'b_6',
    });
    const letters = generateBreachLetters(ev, [
      { kind: 'regulator', name: 'ICO', contact: '' },
      { kind: 'subject', subjectId: 's', contact: '' },
    ]);
    expect(letters[0]?.body).toContain('Pursuant to');
    expect(letters[1]?.body).toContain('your personal data');
  });
});
