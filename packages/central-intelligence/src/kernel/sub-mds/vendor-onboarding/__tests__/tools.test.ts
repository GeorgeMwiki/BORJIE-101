import { describe, expect, it } from 'vitest';
import { verifyKyc, type KycLookupPort } from '../tools/verify-kyc.js';
import { draftMsa } from '../tools/draft-msa.js';
import {
  setupPaymentRail,
  type PaymentRegistryPort,
  type PaymentMethodRecord,
} from '../tools/setup-payment-rail.js';

describe('verifyKyc', () => {
  it('returns verified when name matches', async () => {
    const port: KycLookupPort = {
      async lookup() {
        return { verified: true, fullNameOnRecord: 'Asha Mwakasege', lookupSourceTag: 'nida-tz', checkedAtMs: 1000 };
      },
    };
    const r = await verifyKyc({
      jurisdiction: 'TZ',
      idNumberToken: 'hash-1',
      claimedName: 'Asha Mwakasege',
      port,
    });
    expect(r.status).toBe('verified');
  });

  it('returns mismatch when name differs', async () => {
    const port: KycLookupPort = {
      async lookup() {
        return { verified: true, fullNameOnRecord: 'John Doe', lookupSourceTag: 'huduma-ke', checkedAtMs: 1000 };
      },
    };
    const r = await verifyKyc({
      jurisdiction: 'KE',
      idNumberToken: 'hash-2',
      claimedName: 'Asha Mwakasege',
      port,
    });
    expect(r.status).toBe('mismatch');
    expect(r.mismatchedFields).toEqual(['name']);
  });

  it('returns not-found when registry has no record', async () => {
    const port: KycLookupPort = {
      async lookup() {
        return { verified: false, lookupSourceTag: 'nin-ug', checkedAtMs: 1000 };
      },
    };
    const r = await verifyKyc({
      jurisdiction: 'UG',
      idNumberToken: 'hash-3',
      claimedName: 'Asha',
      port,
    });
    expect(r.status).toBe('not-found');
  });

  it('returns unsupported-jurisdiction on OTHER', async () => {
    const port: KycLookupPort = {
      async lookup() { return { verified: true, lookupSourceTag: 'x', checkedAtMs: 1000 }; },
    };
    const r = await verifyKyc({
      jurisdiction: 'OTHER',
      idNumberToken: 'x', claimedName: 'X', port,
    });
    expect(r.status).toBe('unsupported-jurisdiction');
  });

  it('returns error when adapter throws', async () => {
    const port: KycLookupPort = {
      async lookup() { throw new Error('mcp-503'); },
    };
    const r = await verifyKyc({
      jurisdiction: 'KE',
      idNumberToken: 'hash-1', claimedName: 'Asha', port,
    });
    expect(r.status).toBe('error');
    expect(r.reason).toContain('mcp-503');
  });
});

describe('draftMsa', () => {
  it('produces a draft, never auto-signs', () => {
    const d = draftMsa({
      vendorId: 'v1',
      vendorLegalName: 'Aqua Plumb Ltd',
      ownerLegalName: 'Asha Estates Ltd',
      jurisdiction: 'KE',
      capabilityTags: ['plumber', 'gas-fitter'],
      serviceAreas: ['Kilimani', 'Westlands'],
      emergencyAvailable: true,
      paymentTermsDays: 30,
      language: 'en',
    });
    expect(d.draftStatus).toBe('queued-for-owner-signature');
    expect(d.nextStepGuidance).toContain('does NOT sign');
    expect(d.clauses.length).toBeGreaterThanOrEqual(8);
  });

  it('clauses include governing law per jurisdiction', () => {
    const ke = draftMsa({
      vendorId: 'v1', vendorLegalName: 'X', ownerLegalName: 'Y',
      jurisdiction: 'KE', capabilityTags: ['plumber'], serviceAreas: [],
      emergencyAvailable: false, paymentTermsDays: 30, language: 'en',
    });
    expect(ke.body).toContain('Kenya');
    const tz = draftMsa({
      vendorId: 'v1', vendorLegalName: 'X', ownerLegalName: 'Y',
      jurisdiction: 'TZ', capabilityTags: ['plumber'], serviceAreas: [],
      emergencyAvailable: false, paymentTermsDays: 30, language: 'en',
    });
    expect(tz.body).toContain('Tanzania');
  });

  it('renders Swahili when language=sw', () => {
    const d = draftMsa({
      vendorId: 'v1', vendorLegalName: 'X', ownerLegalName: 'Y',
      jurisdiction: 'TZ', capabilityTags: ['plumber'], serviceAreas: [],
      emergencyAvailable: true, paymentTermsDays: 30, language: 'sw',
    });
    expect(d.title).toContain('Mkataba');
  });
});

describe('setupPaymentRail', () => {
  const record: PaymentMethodRecord = {
    vendorId: 'v1',
    rail: 'mpesa',
    accountToken: 'tok-xxx',
    accountLabel: '254 7** *** 123',
    currency: 'KES',
  };

  function mkRegistry(): { registry: PaymentRegistryPort; added: string[] } {
    const added: string[] = [];
    const registry: PaymentRegistryPort = {
      async add({ record }) {
        added.push(record.vendorId);
        return { registryEntryId: `reg-${record.vendorId}` };
      },
      async remove() { /* no-op */ },
    };
    return { registry, added };
  }

  it('blocks when MSA unsigned', async () => {
    const { registry, added } = mkRegistry();
    const r = await setupPaymentRail({
      record, msaSigned: false, registry, correlationId: 'c-1',
    }, 1000);
    expect(r.status).toBe('blocked-msa-unsigned');
    expect(added.length).toBe(0);
  });

  it('adds when MSA signed', async () => {
    const { registry, added } = mkRegistry();
    const r = await setupPaymentRail({
      record, msaSigned: true, registry, correlationId: 'c-2',
    }, 1000);
    expect(r.status).toBe('added');
    expect(r.registryEntryId).toBe('reg-v1');
    expect(added).toEqual(['v1']);
    expect(r.recallableUntilMs).toBe(1000 + 5 * 60 * 1000);
  });

  it('returns failed on registry exception', async () => {
    const registry: PaymentRegistryPort = {
      async add() { throw new Error('db-down'); },
      async remove() {},
    };
    const r = await setupPaymentRail({
      record, msaSigned: true, registry, correlationId: 'c-3',
    }, 1000);
    expect(r.status).toBe('failed');
    expect(r.reason).toContain('db-down');
  });
});
