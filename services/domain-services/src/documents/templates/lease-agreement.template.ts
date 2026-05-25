/**
 * Lease Agreement Document Template
 * Standard residential lease agreement template for property management.
 */

export interface LeaseAgreementTemplateData {
  readonly tenantName: string;
  readonly tenantIdNumber?: string;
  readonly landlordName: string;
  readonly propertyAddress: string;
  readonly unitIdentifier: string;
  readonly rentAmount: number;
  readonly rentCurrency: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly depositAmount?: number;
  readonly utilitiesIncluded?: string[];
  readonly specialTerms?: string;
  readonly signingDate?: string;
}

/** Generate lease agreement document content (HTML or plain text) */
export function generateLeaseAgreement(data: LeaseAgreementTemplateData): string {
  const deposit = data.depositAmount
    ? `${data.rentCurrency} ${data.depositAmount.toLocaleString()}`
    : 'As per local regulations';
  const utilities = data.utilitiesIncluded?.length
    ? data.utilitiesIncluded.join(', ')
    : 'As agreed';
  const specialTerms = data.specialTerms ?? 'None';
  const signingDate = data.signingDate ?? new Date().toISOString().split('T')[0];

  return `
LEASE AGREEMENT

This Lease Agreement ("Agreement") is entered into on ${signingDate} between:

LANDLORD: ${data.landlordName}
TENANT: ${data.tenantName}${data.tenantIdNumber ? ` (ID: ${data.tenantIdNumber})` : ''}

PROPERTY: ${data.propertyAddress}
UNIT: ${data.unitIdentifier}

TERMS:
1. Lease Period: ${data.startDate} to ${data.endDate}
2. Monthly Rent: ${data.rentCurrency} ${data.rentAmount.toLocaleString()} (due on the 1st of each month)
3. Security Deposit: ${deposit}
4. Utilities Included: ${utilities}

5. SPECIAL TERMS:
${specialTerms}

SIGNATURES:
_________________________          _________________________
Landlord                              Tenant
${data.landlordName}                  ${data.tenantName}

Date: ${signingDate}
`.trim();
}

/** Template identifier for programmatic use */
export const LEASE_AGREEMENT_TEMPLATE_ID = 'lease-agreement-v1';
