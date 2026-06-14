/**
 * Regression test — contract-422 finding (4): the owner-web "log new
 * incident" form offered a 'security' kind the gateway IncidentKindEnum
 * rejects (422) and was missing near_miss / equipment_failure / fatality.
 *
 * This test pins the FE `INCIDENT_KINDS` to a faithful copy of the gateway
 * `IncidentKindEnum`
 * (services/api-gateway/src/routes/mining/_openapi/sales-incidents-schemas.ts)
 * and asserts every kind has a label in BOTH locales (no mixing, full
 * EN + SW coverage per CLAUDE.md).
 */

import { describe, it, expect } from 'vitest';
import { INCIDENT_KINDS } from '../incidentKinds';
import { routesBStrings as S } from '@/i18n/strings/routes-b';

// Faithful copy of the gateway IncidentKindEnum values.
const SERVER_INCIDENT_KINDS = [
  'safety',
  'environmental',
  'community',
  'near_miss',
  'equipment_failure',
  'fatality',
] as const;

describe('incident kind contract — FE ↔ gateway IncidentKindEnum', () => {
  it('FE INCIDENT_KINDS matches the server enum exactly (order + values)', () => {
    expect([...INCIDENT_KINDS]).toEqual([...SERVER_INCIDENT_KINDS]);
  });

  it('does not offer the rejected legacy "security" kind', () => {
    expect(INCIDENT_KINDS).not.toContain('security' as never);
  });

  it('includes the previously-missing kinds', () => {
    expect(INCIDENT_KINDS).toContain('near_miss');
    expect(INCIDENT_KINDS).toContain('equipment_failure');
    expect(INCIDENT_KINDS).toContain('fatality');
  });

  it('every kind has a non-empty EN and SW label', () => {
    for (const kind of INCIDENT_KINDS) {
      const label = S.safety.incidentKind[kind];
      expect(label, `missing label for ${kind}`).toBeDefined();
      expect(label.en.length).toBeGreaterThan(0);
      expect(label.sw.length).toBeGreaterThan(0);
    }
  });
});
