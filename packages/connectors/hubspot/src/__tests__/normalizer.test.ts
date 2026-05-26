/**
 * HubSpot normalizer tests.
 */

import { describe, it, expect } from 'vitest';

import { normaliseHubSpotRow } from '../ingest/normalizer.js';

describe('hubspot/normalizer', () => {
  it('normalises a deal row with stage + amount', () => {
    const row = {
      id: '4567',
      properties: {
        dealname: 'Borjie Q1 Off-Take',
        amount: '250000',
        dealstage: 'negotiation',
        hs_lastmodifieddate: '2026-01-15T10:00:00.000Z',
      },
    };
    const n = normaliseHubSpotRow({ objectType: 'deals', row });
    expect(n).not.toBeNull();
    expect(n?.objectId).toBe('4567');
    expect(n?.dealName).toBe('Borjie Q1 Off-Take');
    expect(n?.amount).toBe(250000);
    expect(n?.stage).toBe('negotiation');
  });

  it('returns null when id is missing', () => {
    const row = {
      id: '',
      properties: { hs_lastmodifieddate: '2026-01-15T10:00:00.000Z' },
    };
    expect(normaliseHubSpotRow({ objectType: 'contacts', row })).toBeNull();
  });

  it('returns null when updatedAt is missing', () => {
    const row = { id: '1', properties: { firstname: 'A' } };
    expect(normaliseHubSpotRow({ objectType: 'contacts', row })).toBeNull();
  });
});
