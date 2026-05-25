/**
 * Reconciliation report generation
 */
import type { ReconciliationResult } from './reconciler';

export interface ReconciliationReport {
  generatedAt: string;
  summary: {
    totalMatches: number;
    totalExceptions: number;
    matchedAmount: number;
    unmatchedPaymentsCount: number;
    unmatchedInvoicesCount: number;
  };
  matches: Array<{
    paymentId: string;
    invoiceId: string;
    amount: number;
    matchType: string;
  }>;
  exceptions: Array<{
    type: string;
    paymentId?: string | undefined;
    invoiceId?: string | undefined;
    amount?: number | undefined;
    description: string;
  }>;
}

export function generateReconciliationReport(
  result: ReconciliationResult
): ReconciliationReport {
  const matchedAmount = result.matches.reduce((sum, m) => sum + m.amount, 0);

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalMatches: result.matches.length,
      totalExceptions: result.exceptions.length,
      matchedAmount,
      unmatchedPaymentsCount: result.unmatchedPayments.length,
      unmatchedInvoicesCount: result.unmatchedInvoices.length,
    },
    matches: result.matches.map((m) => ({
      paymentId: m.paymentId,
      invoiceId: m.invoiceId,
      amount: m.amount,
      matchType: m.matchType,
    })),
    exceptions: result.exceptions.map((e) => {
      const item: ReconciliationReport['exceptions'][number] = {
        type: e.type,
        description: e.description,
      };
      if (e.paymentId != null) item.paymentId = e.paymentId;
      if (e.invoiceId != null) item.invoiceId = e.invoiceId;
      if (e.amount != null) item.amount = e.amount;
      return item;
    }),
  };
}
