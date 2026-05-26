/**
 * Breach tests — detector signals + notifier N-hour deadline.
 *
 * Universal framework port used here is a TEST DOUBLE — it carries
 * NO jurisdiction identity, only a numeric notification window. This
 * keeps the package code jurisdiction-agnostic (per the founder
 * universal addendum).
 */

import { describe, expect, it } from 'vitest';

import {
  detectBreaches,
  DEFAULT_DETECTOR_CONFIG,
  type AccessEvent,
} from '../breach/breach-detector.js';
import {
  createBreachEvent,
  evaluateDeadlines,
  notifyAuthority,
  notifySubjects,
} from '../breach/breach-notifier.js';
import { combineStrictest, validateFramework } from '../frameworks/index.js';
import type { ComplianceFrameworkPort } from '../types.js';

const TEST_FRAMEWORK_72H: ComplianceFrameworkPort = Object.freeze({
  id: 'test_framework_72h',
  label: 'Test framework — 72h authority notification window',
  breachAuthorityNotificationHours: 72,
  breachSubjectNotificationHours: 168,
  rtbfFulfilmentDays: 30,
  minRetentionDaysByClass: Object.freeze({}),
  maxRetentionDaysByClass: Object.freeze({}),
  provenance: Object.freeze([
    Object.freeze({
      url: 'https://example.test/spec',
      title: 'Test framework spec',
      date: '2026-05-26',
    }),
  ]),
});

const TEST_FRAMEWORK_24H: ComplianceFrameworkPort = Object.freeze({
  ...TEST_FRAMEWORK_72H,
  id: 'test_framework_24h',
  label: 'Test framework — 24h authority window',
  breachAuthorityNotificationHours: 24,
});

describe('breach/breach-detector', () => {
  it('detects bulk-export when rowCount exceeds threshold', () => {
    const events: AccessEvent[] = [
      {
        actorId: 'actor_1',
        tenantId: 't1',
        resource: 'pii_table',
        classes: ['pii'],
        rowCount: DEFAULT_DETECTOR_CONFIG.bulkExportThreshold + 100,
        geo: 'TZ',
        at: new Date('2026-05-26T00:00:00Z'),
        directDb: false,
      },
    ];
    const findings = detectBreaches({
      events,
      knownGeosByActor: new Map(),
    });
    const bulk = findings.find((f) => f.signal === 'bulk_export');
    expect(bulk).toBeDefined();
    expect(bulk?.severity).toBe('high');
  });

  it('detects direct-DB bypass', () => {
    const events: AccessEvent[] = [
      {
        actorId: 'a',
        tenantId: 't1',
        resource: 'r',
        classes: ['confidential'],
        rowCount: 1,
        geo: 'TZ',
        at: new Date(),
        directDb: true,
      },
    ];
    const findings = detectBreaches({
      events,
      knownGeosByActor: new Map(),
    });
    expect(findings.some((f) => f.signal === 'direct_db_bypass')).toBe(true);
  });

  it('detects geo anomaly when actor accesses from an unknown geo', () => {
    const events: AccessEvent[] = [
      {
        actorId: 'a1',
        tenantId: 't1',
        resource: 'r',
        classes: ['pii'],
        rowCount: 1,
        geo: 'CN',
        at: new Date(),
        directDb: false,
      },
    ];
    const known = new Map<string, ReadonlySet<string>>([
      ['a1', new Set(['TZ', 'KE'])],
    ]);
    const findings = detectBreaches({ events, knownGeosByActor: known });
    expect(findings.some((f) => f.signal === 'geo_anomaly')).toBe(true);
  });

  it('detects actor burst beyond the configured rate', () => {
    const t0 = new Date('2026-05-26T00:00:00Z').getTime();
    const events: AccessEvent[] = [];
    for (let i = 0; i < DEFAULT_DETECTOR_CONFIG.actorRatePerWindow + 5; i++) {
      events.push({
        actorId: 'a1',
        tenantId: 't1',
        resource: 'r',
        classes: ['internal'],
        rowCount: 1,
        geo: 'TZ',
        at: new Date(t0 + i * 100),
        directDb: false,
      });
    }
    const findings = detectBreaches({
      events,
      knownGeosByActor: new Map(),
    });
    expect(findings.some((f) => f.signal === 'actor_burst')).toBe(true);
  });
});

describe('breach/breach-notifier — N-hour deadline', () => {
  it('authorityOnTime is TRUE when notified within the framework window', () => {
    const detectedAt = new Date('2026-05-26T00:00:00Z');
    const event0 = createBreachEvent({
      id: 'b1',
      tenantId: 't1',
      detectedAt,
      severity: 'high',
      affectedClasses: ['pii'],
      affectedCountEstimate: 100,
    });
    // Notify at +48h (within the 72h window).
    const at = new Date(detectedAt.getTime() + 48 * 60 * 60 * 1000);
    const event1 = notifyAuthority({ event: event0, at });
    const check = evaluateDeadlines({
      event: event1,
      framework: TEST_FRAMEWORK_72H,
      now: at,
      subjectsRequired: false,
    });
    expect(check.authorityOnTime).toBe(true);
  });

  it('authorityOnTime is FALSE when notified after the window', () => {
    const detectedAt = new Date('2026-05-26T00:00:00Z');
    const event0 = createBreachEvent({
      id: 'b2',
      tenantId: 't1',
      detectedAt,
      severity: 'critical',
      affectedClasses: ['phi'],
      affectedCountEstimate: 50,
    });
    // Notify at +80h (LATE under the 72h window).
    const at = new Date(detectedAt.getTime() + 80 * 60 * 60 * 1000);
    const event1 = notifyAuthority({ event: event0, at });
    const check = evaluateDeadlines({
      event: event1,
      framework: TEST_FRAMEWORK_72H,
      now: at,
      subjectsRequired: true,
    });
    expect(check.authorityOnTime).toBe(false);
  });

  it('authority deadline is shorter under combineStrictest', () => {
    const both = combineStrictest([TEST_FRAMEWORK_72H, TEST_FRAMEWORK_24H]);
    expect(both.breachAuthorityNotificationHours).toBe(24);
  });

  it('subject notification path updates the audit chain', () => {
    const detectedAt = new Date();
    const e0 = createBreachEvent({
      id: 'b3',
      tenantId: 't1',
      detectedAt,
      severity: 'high',
      affectedClasses: ['pii'],
      affectedCountEstimate: 10,
    });
    const e1 = notifyAuthority({ event: e0, at: new Date(detectedAt.getTime() + 1000) });
    const e2 = notifySubjects({ event: e1, at: new Date(detectedAt.getTime() + 2000) });
    expect(e2.notifiedSubjectsAt).not.toBeNull();
    expect(e2.prevHash).toBe(e1.auditHash);
    expect(e2.auditHash).not.toBe(e1.auditHash);
  });

  it('validateFramework rejects a framework with zero notification hours', () => {
    const bad: ComplianceFrameworkPort = {
      ...TEST_FRAMEWORK_72H,
      breachAuthorityNotificationHours: 0,
    };
    expect(validateFramework(bad).length).toBeGreaterThan(0);
  });
});
