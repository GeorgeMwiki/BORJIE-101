/**
 * Owner cockpit mock data — full daily-brief snapshot.
 *
 * Mirrors the wire shape the gateway returns on
 * `GET /api/v1/owner/cockpit/daily-brief`. Real call falls back to
 * this fixture when offline so the dashboard always renders.
 */

import { COCKPIT_MOCK, type CockpitData } from '@/lib/cockpit-mocks';

export interface DailyBriefResponse extends CockpitData {
  readonly updatedAt: string;
  readonly tenantId: string;
}

export function cockpitMock(): DailyBriefResponse {
  return {
    ...COCKPIT_MOCK,
    updatedAt: new Date().toISOString(),
    tenantId: 'tnt_mawebora',
  };
}
