import { describe, it, expect } from 'vitest';
import {
  generateResidencyProof,
  RESIDENCY_PROOF_TEMPLATE_ID,
} from '../templates/residency-proof.template.js';
import {
  generateTenancyConfirmation,
  TENANCY_CONFIRMATION_TEMPLATE_ID,
} from '../templates/tenancy-confirmation.template.js';
import {
  generatePaymentConfirmation,
  PAYMENT_CONFIRMATION_TEMPLATE_ID,
} from '../templates/payment-confirmation.template.js';
import {
  generateTenantReference,
  TENANT_REFERENCE_TEMPLATE_ID,
} from '../templates/tenant-reference.template.js';

describe('letter templates', () => {
  it('residency proof contains tenant + property', () => {
    const out = generateResidencyProof({
      letterReference: 'R-1',
      issueDate: '2026-04-18',
      tenantName: 'Jane Doe',
      propertyAddress: '123 Moi Ave',
      unitIdentifier: 'A-2',
      residentSince: '2023-01-01',
      landlordName: 'Acme Properties',
    });
    expect(out).toContain('Jane Doe');
    expect(out).toContain('123 Moi Ave');
    expect(out).toContain('A-2');
    expect(out).toContain('2023-01-01');
    expect(RESIDENCY_PROOF_TEMPLATE_ID).toBe('residency-proof-v1');
  });

  it('tenancy confirmation includes rent', () => {
    const out = generateTenancyConfirmation({
      letterReference: 'T-1',
      issueDate: '2026-04-18',
      tenantName: 'John Doe',
      propertyAddress: '1 Kimathi',
      unitIdentifier: 'B-3',
      leaseStartDate: '2024-06-01',
      monthlyRent: 45000,
      currency: 'KES',
      landlordName: 'Acme',
    });
    expect(out).toContain('45,000');
    expect(out).toContain('KES');
    expect(TENANCY_CONFIRMATION_TEMPLATE_ID).toBe('tenancy-confirmation-v1');
  });

  it('payment confirmation totals correctly', () => {
    const out = generatePaymentConfirmation({
      letterReference: 'P-1',
      issueDate: '2026-04-18',
      tenantName: 'X',
      propertyAddress: 'Y',
      unitIdentifier: 'Z',
      currency: 'KES',
      payments: [
        { paidOn: '2026-04-01', description: 'Rent', amount: 30000, method: 'MPesa' },
        { paidOn: '2026-04-05', description: 'Water', amount: 1500, method: 'MPesa' },
      ],
      landlordName: 'Acme',
    });
    expect(out).toContain('31,500');
    expect(PAYMENT_CONFIRMATION_TEMPLATE_ID).toBe('payment-confirmation-v1');
  });

  it('tenant reference reflects recommendation', () => {
    const positive = generateTenantReference({
      letterReference: 'Ref-1',
      issueDate: '2026-04-18',
      tenantName: 'A',
      propertyAddress: 'B',
      unitIdentifier: 'C',
      tenancyStart: '2023-01-01',
      paymentRecord: 'excellent',
      propertyCondition: 'excellent',
      recommend: true,
      landlordName: 'L',
    });
    expect(positive).toContain('recommend this tenant without reservation');
    expect(TENANT_REFERENCE_TEMPLATE_ID).toBe('tenant-reference-v1');

    const negative = generateTenantReference({
      letterReference: 'Ref-2',
      issueDate: '2026-04-18',
      tenantName: 'A',
      propertyAddress: 'B',
      unitIdentifier: 'C',
      tenancyStart: '2023-01-01',
      paymentRecord: 'poor',
      propertyCondition: 'poor',
      recommend: false,
      landlordName: 'L',
    });
    expect(negative).toContain('unable to provide a positive recommendation');
  });
});
