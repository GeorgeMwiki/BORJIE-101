/**
 * Payment Confirmation Letter Template
 *
 * A formal letter confirming that specified payments have been received
 * (rent, deposit, arrears settlement). Distinct from a rent receipt:
 * this is a narrative letter suitable for banks/employers.
 */

export interface PaymentConfirmationTemplateData {
  readonly letterReference: string;
  readonly issueDate: string;
  readonly tenantName: string;
  readonly tenantIdNumber?: string;
  readonly propertyAddress: string;
  readonly unitIdentifier: string;
  readonly payments: readonly {
    readonly paidOn: string;
    readonly description: string;
    readonly amount: number;
    readonly method: string;
    readonly reference?: string;
  }[];
  readonly currency: string;
  readonly landlordName: string;
  readonly organizationName?: string;
  readonly note?: string;
}

export function generatePaymentConfirmation(data: PaymentConfirmationTemplateData): string {
  const org = data.organizationName ?? data.landlordName;
  const total = data.payments.reduce((s, p) => s + p.amount, 0);
  const rows = data.payments
    .map(
      (p) =>
        `  - ${p.paidOn} | ${p.description} | ${data.currency} ${p.amount.toLocaleString()} | ${p.method}${
          p.reference ? ` | Ref ${p.reference}` : ''
        }`
    )
    .join('\n');
  const note = data.note ? `\n\nNote: ${data.note}\n` : '';

  return `
${org}
${'═'.repeat(60)}

Ref: ${data.letterReference}
Date: ${data.issueDate}

TO WHOM IT MAY CONCERN

RE: CONFIRMATION OF PAYMENTS — ${data.tenantName}${
    data.tenantIdNumber ? ` (ID: ${data.tenantIdNumber})` : ''
  }

We confirm receipt of the following payments from the above tenant
in respect of ${data.propertyAddress}, Unit ${data.unitIdentifier}:

${rows}

  TOTAL: ${data.currency} ${total.toLocaleString()}
${note}
Sincerely,

${data.landlordName}
${org}

Generated: ${new Date().toISOString()}
`.trim();
}

export const PAYMENT_CONFIRMATION_TEMPLATE_ID = 'payment-confirmation-v1';
