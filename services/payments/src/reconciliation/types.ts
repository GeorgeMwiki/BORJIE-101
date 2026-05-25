/**
 * Reconciliation types
 */
export interface PaymentRecord {
  id: string;
  externalId?: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: Date;
  paidAt?: Date;
  reference?: string;
}

export interface InvoiceRecord {
  id: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  status: string;
  dueDate: Date;
}

export interface ReconciliationMatch {
  paymentId: string;
  invoiceId: string;
  amount: number;
  matchType: 'EXACT' | 'PARTIAL' | 'OVERPAYMENT';
}

export interface ReconciliationException {
  type: 'UNMATCHED_PAYMENT' | 'UNMATCHED_INVOICE' | 'AMOUNT_MISMATCH';
  paymentId?: string;
  invoiceId?: string;
  amount?: number;
  description: string;
}
