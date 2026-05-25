/**
 * Rent Receipt Document Template
 * Payment receipt for rent and related charges.
 */

export interface RentReceiptTemplateData {
  readonly receiptNumber: string;
  readonly tenantName: string;
  readonly tenantId?: string;
  readonly propertyAddress: string;
  readonly unitIdentifier: string;
  readonly paymentDate: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: number;
  readonly currency: string;
  readonly paymentMethod: string;
  readonly referenceNumber?: string;
  readonly breakdown?: readonly {
    readonly description: string;
    readonly amount: number;
  }[];
  readonly landlordName?: string;
  readonly organizationName?: string;
}

/** Generate rent receipt document content */
export function generateRentReceipt(data: RentReceiptTemplateData): string {
  const total = data.breakdown?.reduce((sum, b) => sum + b.amount, 0) ?? data.amount;

  let content = `
RENT PAYMENT RECEIPT
${'═'.repeat(50)}

Receipt No: ${data.receiptNumber}
Date: ${data.paymentDate}
${data.referenceNumber ? `Reference: ${data.referenceNumber}` : ''}

RECEIVED FROM: ${data.tenantName}
${data.tenantId ? `ID: ${data.tenantId}` : ''}

PROPERTY: ${data.propertyAddress}
UNIT: ${data.unitIdentifier}

PERIOD: ${data.periodStart} to ${data.periodEnd}

${'─'.repeat(50)}
`;

  if (data.breakdown?.length) {
    content += 'BREAKDOWN:\n';
    for (const b of data.breakdown) {
      content += `  ${b.description}: ${data.currency} ${b.amount.toLocaleString()}\n`;
    }
    content += `${'─'.repeat(50)}\n`;
  }

  content += `TOTAL PAID: ${data.currency} ${total.toLocaleString()}\n`;
  content += `Payment Method: ${data.paymentMethod}\n`;

  if (data.organizationName || data.landlordName) {
    content += `\n${data.organizationName ?? data.landlordName ?? ''}\n`;
  }

  content += `\nGenerated: ${new Date().toISOString()}`;

  return content.trim();
}

/** Template identifier */
export const RENT_RECEIPT_TEMPLATE_ID = 'rent-receipt-v1';
