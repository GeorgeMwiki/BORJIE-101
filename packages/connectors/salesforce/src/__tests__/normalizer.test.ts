/**
 * Salesforce normalizer tests — raw SOQL record → canonical envelope.
 */

import { describe, it, expect } from 'vitest';

import { normaliseSalesforceRecord } from '../ingest/normalizer.js';

describe('salesforce/normalizer', () => {
  it('normalises an Opportunity row with stage + amount + closeDate', () => {
    const record = {
      attributes: {
        type: 'Opportunity',
        url: '/services/data/v60.0/sobjects/Opportunity/006xx0000000ABC',
      },
      Id: '006xx0000000ABCAA0',
      Name: 'Mr. Mwikila — Q1 Gold Off-Take',
      StageName: 'Negotiation',
      Amount: 250000.5,
      CloseDate: '2026-03-31',
      LastModifiedDate: '2026-01-15T10:00:00.000Z',
    };
    const normalised = normaliseSalesforceRecord({ record });
    expect(normalised).not.toBeNull();
    expect(normalised?.sobjectType).toBe('Opportunity');
    expect(normalised?.name).toBe('Mr. Mwikila — Q1 Gold Off-Take');
    expect(normalised?.stage).toBe('Negotiation');
    expect(normalised?.amount).toBe(250000.5);
    expect(normalised?.closeDate).toBe('2026-03-31');
    expect(normalised?.lastModifiedDate).toBe('2026-01-15T10:00:00.000Z');
  });

  it('returns null when sobject type is not in the allowlist', () => {
    const record = {
      attributes: { type: 'Lead', url: '/x' },
      Id: '00Qxx0000000ABC',
      Name: 'Lead Name',
      LastModifiedDate: '2026-01-15T10:00:00.000Z',
    };
    expect(normaliseSalesforceRecord({ record })).toBeNull();
  });

  it('returns null when Id or LastModifiedDate is missing', () => {
    const record = {
      attributes: { type: 'Account', url: '/x' },
      Name: 'Borjie Mining',
    };
    expect(normaliseSalesforceRecord({ record })).toBeNull();
  });
});
