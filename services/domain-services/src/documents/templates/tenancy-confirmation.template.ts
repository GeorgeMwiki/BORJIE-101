/**
 * Tenancy Confirmation Letter Template
 *
 * Confirms active tenancy terms (start date, rent, unit) — often
 * required by lenders, employers, immigration, or municipal bodies.
 */

export interface TenancyConfirmationTemplateData {
  readonly letterReference: string;
  readonly issueDate: string;
  readonly tenantName: string;
  readonly tenantIdNumber?: string;
  readonly propertyAddress: string;
  readonly unitIdentifier: string;
  readonly leaseStartDate: string;
  readonly leaseEndDate?: string;
  readonly monthlyRent: number;
  readonly currency: string;
  readonly landlordName: string;
  readonly organizationName?: string;
  readonly requestedBy?: string;
}

export function generateTenancyConfirmation(data: TenancyConfirmationTemplateData): string {
  const org = data.organizationName ?? data.landlordName;
  const end = data.leaseEndDate
    ? `until ${data.leaseEndDate}`
    : 'on a month-to-month basis';
  const requestedBy = data.requestedBy
    ? `This letter is issued at the request of ${data.requestedBy}.\n\n`
    : '';

  return `
${org}
${'═'.repeat(60)}

Ref: ${data.letterReference}
Date: ${data.issueDate}

TO WHOM IT MAY CONCERN

RE: TENANCY CONFIRMATION — ${data.tenantName}${
    data.tenantIdNumber ? ` (ID: ${data.tenantIdNumber})` : ''
  }

We confirm that ${data.tenantName} holds an active tenancy at the
following address under the terms below:

  Address:        ${data.propertyAddress}
  Unit:           ${data.unitIdentifier}
  Start date:     ${data.leaseStartDate}
  Term:           ${end}
  Monthly rent:   ${data.currency} ${data.monthlyRent.toLocaleString()}

${requestedBy}Should you require additional documentation, please contact
the undersigned.

Sincerely,

${data.landlordName}
${org}

Generated: ${new Date().toISOString()}
`.trim();
}

export const TENANCY_CONFIRMATION_TEMPLATE_ID = 'tenancy-confirmation-v1';
