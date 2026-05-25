/**
 * Tenant Reference Letter Template
 *
 * Written by the current/former landlord to support the tenant's
 * application at a NEW property. Covers behaviour, payment history,
 * and property condition.
 */

export interface TenantReferenceTemplateData {
  readonly letterReference: string;
  readonly issueDate: string;
  readonly tenantName: string;
  readonly tenantIdNumber?: string;
  readonly propertyAddress: string;
  readonly unitIdentifier: string;
  readonly tenancyStart: string;
  readonly tenancyEnd?: string;
  readonly paymentRecord: 'excellent' | 'good' | 'satisfactory' | 'poor';
  readonly propertyCondition: 'excellent' | 'good' | 'satisfactory' | 'poor';
  readonly conductNotes?: string;
  readonly recommend: boolean;
  readonly landlordName: string;
  readonly landlordContact?: string;
  readonly organizationName?: string;
}

export function generateTenantReference(data: TenantReferenceTemplateData): string {
  const org = data.organizationName ?? data.landlordName;
  const status = data.tenancyEnd
    ? `from ${data.tenancyStart} until ${data.tenancyEnd}`
    : `from ${data.tenancyStart} and is currently in residence`;
  const recommend = data.recommend
    ? 'On the basis of the above, we recommend this tenant without reservation.'
    : 'We are unable to provide a positive recommendation at this time.';
  const notes = data.conductNotes ? `\nAdditional notes: ${data.conductNotes}\n` : '';
  const contact = data.landlordContact ? `Contact: ${data.landlordContact}\n` : '';

  return `
${org}
${'═'.repeat(60)}

Ref: ${data.letterReference}
Date: ${data.issueDate}

TO WHOM IT MAY CONCERN

RE: TENANT REFERENCE — ${data.tenantName}${
    data.tenantIdNumber ? ` (ID: ${data.tenantIdNumber})` : ''
  }

The above-named individual rented ${data.propertyAddress},
Unit ${data.unitIdentifier}, ${status}.

Payment record:      ${data.paymentRecord}
Property condition:  ${data.propertyCondition}
${notes}
${recommend}

Sincerely,

${data.landlordName}
${contact}${org}

Generated: ${new Date().toISOString()}
`.trim();
}

export const TENANT_REFERENCE_TEMPLATE_ID = 'tenant-reference-v1';
