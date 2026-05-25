/**
 * Residency Proof Letter Template
 *
 * Issued on request to a tenant who needs to demonstrate residence
 * at a property (e.g. bank KYC, embassy, employer).
 */

export interface ResidencyProofTemplateData {
  readonly letterReference: string;
  readonly issueDate: string;
  readonly tenantName: string;
  readonly tenantIdNumber?: string;
  readonly propertyAddress: string;
  readonly unitIdentifier: string;
  readonly residentSince: string;
  readonly landlordName: string;
  readonly landlordContact?: string;
  readonly organizationName?: string;
  readonly purposeNote?: string;
}

export function generateResidencyProof(data: ResidencyProofTemplateData): string {
  const org = data.organizationName ?? data.landlordName;
  const contact = data.landlordContact ? `Contact: ${data.landlordContact}\n` : '';
  const purpose = data.purposeNote
    ? `This letter is issued for the following purpose: ${data.purposeNote}.\n\n`
    : '';

  return `
${org}
${'═'.repeat(60)}

Ref: ${data.letterReference}
Date: ${data.issueDate}

TO WHOM IT MAY CONCERN

RE: PROOF OF RESIDENCY — ${data.tenantName}${
    data.tenantIdNumber ? ` (ID: ${data.tenantIdNumber})` : ''
  }

This letter confirms that ${data.tenantName} is a resident at:

  ${data.propertyAddress}
  Unit: ${data.unitIdentifier}

and has been in continuous residence since ${data.residentSince}.

${purpose}If you require further verification, please contact the
undersigned.

Sincerely,

${data.landlordName}
${contact}${org}

Generated: ${new Date().toISOString()}
`.trim();
}

export const RESIDENCY_PROOF_TEMPLATE_ID = 'residency-proof-v1';
