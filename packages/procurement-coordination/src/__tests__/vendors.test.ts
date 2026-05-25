import { describe, it, expect } from 'vitest';
import { createTestHarness } from './test-helpers.js';
import {
  JURISDICTION_KYC,
  kycRequirementsFor,
  supportedKycJurisdictions,
} from '../index.js';

describe('vendor registry — registration', () => {
  it('registers a vendor with KYC pending', async () => {
    const { platform } = createTestHarness();
    const vendor = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'Acme Plumbing Ltd',
      registrationNumber: 'C.123/2023',
      taxId: 'P051234567X',
      categories: ['plumbing', 'maintenance'],
      contactEmail: 'sales@acme-plumbing.co.ke',
    });
    expect(vendor.id).toMatch(/^ven_/);
    expect(vendor.kycStatus).toBe('pending');
    expect(vendor.preferredStatus).toBe('standard');
    expect(vendor.country).toBe('KE');
  });

  it('rejects an invalid email at registration', async () => {
    const { platform } = createTestHarness();
    await expect(
      platform.vendors.registerVendor({
        tenantId: 'tnt-1',
        country: 'KE',
        companyName: 'Acme',
        registrationNumber: 'XYZ',
        taxId: 'TAX1',
        categories: ['maintenance'],
        contactEmail: 'not-an-email',
      }),
    ).rejects.toThrow();
  });

  it('uppercases the country code at registration', async () => {
    const { platform } = createTestHarness();
    const vendor = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'tz',
      companyName: 'Tz Movers',
      registrationNumber: 'TZ-9',
      taxId: 'TIN-1',
      categories: ['logistics'],
      contactEmail: 'ops@tz-movers.co.tz',
    });
    expect(vendor.country).toBe('TZ');
  });
});

describe('vendor registry — per-jurisdiction KYC requirements', () => {
  it('exposes a TZ profile with BRELA + TRA mandates', () => {
    const tz = kycRequirementsFor('TZ');
    expect(tz.requiredDocuments).toContain('brela_registration');
    expect(tz.requiredDocuments).toContain('tra_tax_clearance');
  });

  it('exposes a KE profile with KRA PIN + bank statement', () => {
    const ke = kycRequirementsFor('KE');
    expect(ke.requiredDocuments).toContain('kra_pin');
    expect(ke.requiredDocuments).toContain('bank_statement');
  });

  it('exposes a UG profile with URSB mandate', () => {
    const ug = kycRequirementsFor('UG');
    expect(ug.requiredDocuments).toContain('ursb_registration');
  });

  it('exposes a RW profile with RRA mandate', () => {
    const rw = kycRequirementsFor('RW');
    expect(rw.requiredDocuments).toContain('rra_certificate');
  });

  it('exposes a NG profile with CAC + FIRS mandate', () => {
    const ng = kycRequirementsFor('NG');
    expect(ng.requiredDocuments).toContain('cac_certificate');
    expect(ng.requiredDocuments).toContain('firs_tin');
  });

  it('falls back to a generic profile for unknown countries', () => {
    const xx = kycRequirementsFor('ZZ');
    expect(xx.jurisdictionName).toContain('Generic');
    expect(xx.requiredDocuments).toContain('business_registration_certificate');
  });

  it('lists every supported jurisdiction', () => {
    const list = supportedKycJurisdictions();
    expect(list).toContain('TZ');
    expect(list).toContain('KE');
    expect(list).toContain('UG');
    expect(list).toContain('RW');
    expect(list).toContain('NG');
    expect(list).toHaveLength(JURISDICTION_KYC.length);
  });
});

describe('vendor registry — KYC submission + decision', () => {
  it('keeps vendor in pending when required documents are missing', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'Acme',
      registrationNumber: 'C.1',
      taxId: 'T1',
      categories: ['maintenance'],
      contactEmail: 'a@a.com',
    });
    const result = await platform.vendors.submitKyc({ vendorId: v.id });
    expect(result.missingDocuments.length).toBeGreaterThan(0);
    expect(result.vendor.kycStatus).toBe('pending');
  });

  it('promotes to submitted when every required doc is attached (KE)', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'Acme',
      registrationNumber: 'C.1',
      taxId: 'T1',
      categories: ['maintenance'],
      contactEmail: 'a@a.com',
    });
    for (const docType of kycRequirementsFor('KE').requiredDocuments) {
      await platform.vendors.attachKycDocument({
        vendorId: v.id,
        type: docType,
        fileUrl: `https://example.com/${docType}.pdf`,
      });
    }
    const result = await platform.vendors.submitKyc({ vendorId: v.id });
    expect(result.missingDocuments).toEqual([]);
    expect(result.vendor.kycStatus).toBe('submitted');
  });

  it('approves a submitted KYC and records the approver', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'TZ',
      companyName: 'BRELA Co',
      registrationNumber: 'B-1',
      taxId: 'TIN-1',
      categories: ['cleaning'],
      contactEmail: 'b@b.com',
    });
    for (const docType of kycRequirementsFor('TZ').requiredDocuments) {
      await platform.vendors.attachKycDocument({
        vendorId: v.id,
        type: docType,
        fileUrl: 'https://example.com/x.pdf',
      });
    }
    await platform.vendors.submitKyc({ vendorId: v.id });
    const approved = await platform.vendors.approveKyc({
      vendorId: v.id,
      approverId: 'usr-admin',
    });
    expect(approved.kycStatus).toBe('approved');
    expect(approved.kycDecidedAt).not.toBeNull();
    expect(approved.statusReason).toContain('usr-admin');
  });

  it('refuses to approve a vendor that is not in submitted state', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'TZ',
      companyName: 'X',
      registrationNumber: '1',
      taxId: '1',
      categories: ['cleaning'],
      contactEmail: 'x@x.com',
    });
    await expect(
      platform.vendors.approveKyc({ vendorId: v.id, approverId: 'a' }),
    ).rejects.toThrow(/must be 'submitted'/);
  });

  it('rejects KYC with a reason and prevents reapproval', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'NG',
      companyName: 'X',
      registrationNumber: '1',
      taxId: '1',
      categories: ['IT'],
      contactEmail: 'x@x.com',
    });
    const rejected = await platform.vendors.rejectKyc({
      vendorId: v.id,
      approverId: 'admin',
      reason: 'CAC certificate expired',
    });
    expect(rejected.kycStatus).toBe('rejected');
    expect(rejected.statusReason).toContain('CAC certificate expired');
    await expect(
      platform.vendors.submitKyc({ vendorId: v.id }),
    ).rejects.toThrow(/already finalised/);
  });

  it('throws on empty reject reason', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'NG',
      companyName: 'X',
      registrationNumber: '1',
      taxId: '1',
      categories: ['IT'],
      contactEmail: 'x@x.com',
    });
    await expect(
      platform.vendors.rejectKyc({ vendorId: v.id, approverId: 'a', reason: '' }),
    ).rejects.toThrow();
  });

  it('blacklists a vendor and blocks future approval', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'BadCo',
      registrationNumber: '1',
      taxId: '1',
      categories: ['security'],
      contactEmail: 'b@b.com',
    });
    const bl = await platform.vendors.blacklistVendor({
      vendorId: v.id,
      reason: 'falsified insurance',
    });
    expect(bl.preferredStatus).toBe('blacklisted');
    expect(bl.kycStatus).toBe('blocked');
  });

  it('marks an approved vendor as preferred', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'X',
      registrationNumber: '1',
      taxId: '1',
      categories: ['maintenance'],
      contactEmail: 'a@a.com',
    });
    for (const t of kycRequirementsFor('KE').requiredDocuments) {
      await platform.vendors.attachKycDocument({
        vendorId: v.id,
        type: t,
        fileUrl: 'u',
      });
    }
    await platform.vendors.submitKyc({ vendorId: v.id });
    await platform.vendors.approveKyc({ vendorId: v.id, approverId: 'a' });
    const pref = await platform.vendors.setPreferred({ vendorId: v.id });
    expect(pref.preferredStatus).toBe('preferred');
  });

  it('refuses preferred status until KYC is approved', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'X',
      registrationNumber: '1',
      taxId: '1',
      categories: ['maintenance'],
      contactEmail: 'a@a.com',
    });
    await expect(
      platform.vendors.setPreferred({ vendorId: v.id }),
    ).rejects.toThrow();
  });

  it('rates a vendor and updates a rolling rating', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'X',
      registrationNumber: '1',
      taxId: '1',
      categories: ['maintenance'],
      contactEmail: 'a@a.com',
    });
    const first = await platform.vendors.rateVendor({ vendorId: v.id, rating: 5 });
    expect(first.rating).toBe(5);
    const second = await platform.vendors.rateVendor({ vendorId: v.id, rating: 3 });
    // 5 * 0.7 + 3 * 0.3 = 4.4
    expect(second.rating).toBe(4.4);
  });

  it('rejects out-of-range ratings', async () => {
    const { platform } = createTestHarness();
    const v = await platform.vendors.registerVendor({
      tenantId: 'tnt-1',
      country: 'KE',
      companyName: 'X',
      registrationNumber: '1',
      taxId: '1',
      categories: ['maintenance'],
      contactEmail: 'a@a.com',
    });
    await expect(
      platform.vendors.rateVendor({ vendorId: v.id, rating: 6 }),
    ).rejects.toThrow();
  });

  it('throws when vendor lookup fails', async () => {
    const { platform } = createTestHarness();
    await expect(
      platform.vendors.approveKyc({ vendorId: 'ven_does_not_exist' as never, approverId: 'a' }),
    ).rejects.toThrow();
  });
});
