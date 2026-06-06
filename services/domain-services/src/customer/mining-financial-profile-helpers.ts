/**
 * Pure helpers for the mining buyer financial-profile service.
 *
 * Kept side-effect-free so the service file stays small and every
 * function here is independently unit-testable. No DB, no I/O, no
 * mutation — inputs in, new values out.
 */

import type {
  BuyerFinancialProfile,
  BuyerPaymentEntry,
} from '../buyer/postgres-buyer-financial-profile-repository.js';

/**
 * Locale-aware currency render. Mirrors `@borjie/genui`'s formatter but
 * is inlined here because `@borjie/domain-services` does not depend on
 * `@borjie/genui`. NEVER hard-codes a currency — the ISO-4217 code is
 * always supplied by the caller.
 */
export function formatCurrency(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currencyCode} ${value}`;
  }
}

/**
 * Derive a buyer credit limit from a submitted financial statement.
 *
 * Mining off-takers extend credit to buyers based on demonstrated
 * disposable income. We take monthly disposable cash (net income +
 * other income − expenses − debt service), annualise it, and apply a
 * conservative coverage multiple. Arrears shrink the limit pound-for-
 * pound. The result is floored at zero (never negative credit).
 */
export function deriveCreditLimit(input: {
  readonly monthlyNetIncome: number;
  readonly otherIncome: number;
  readonly monthlyExpenses: number;
  readonly monthlyDebtService: number;
  readonly existingArrears: number;
  readonly coverageMonths: number;
}): number {
  const disposable =
    input.monthlyNetIncome +
    input.otherIncome -
    input.monthlyExpenses -
    input.monthlyDebtService;
  const annualisedHeadroom = disposable * input.coverageMonths;
  const limit = annualisedHeadroom - input.existingArrears;
  return Math.max(0, Math.round(limit));
}

/** A single payment-track entry derived from a financial statement. */
export function statementPaymentEntry(input: {
  readonly statementId: string;
  readonly disposableMonthly: number;
  readonly currencyCode: string;
  readonly submittedAt: string;
}): BuyerPaymentEntry {
  return {
    saleId: `stmt:${input.statementId}`,
    amountTzs: Math.max(0, Math.round(input.disposableMonthly)),
    paidAt: input.submittedAt,
    method: 'financial_statement',
    status: 'succeeded',
  };
}

/** Outcome of a bank-reference verification against the stored banking blob. */
export interface BankReferenceVerdict {
  readonly buyerId: string;
  readonly verified: boolean;
  readonly bankNameMatch: boolean;
  readonly accountLast4Match: boolean;
  readonly onFileBankName: string | null;
  readonly onFileAccountLast4: string | null;
  readonly reason: string;
}

/**
 * Match a claimed bank reference against the banking already on file for
 * the buyer. Read-only verdict — no DB mutation. A field is treated as a
 * match when the claimant either omits it or it equals the on-file value
 * (case-insensitive for bank name). Verified iff every supplied field
 * matches AND at least one field was supplied.
 */
export function verifyBankReference(
  profile: BuyerFinancialProfile,
  claim: {
    readonly bankName?: string | undefined;
    readonly bankAccountLast4?: string | undefined;
  },
): BankReferenceVerdict {
  const onFileName = profile.banking.bankName;
  const onFileLast4 = profile.banking.accountLast4;
  const nameSupplied = claim.bankName !== undefined;
  const last4Supplied = claim.bankAccountLast4 !== undefined;
  const bankNameMatch = nameSupplied
    ? normaliseName(claim.bankName) === normaliseName(onFileName)
    : true;
  const accountLast4Match = last4Supplied
    ? claim.bankAccountLast4 === onFileLast4
    : true;
  const verified =
    (nameSupplied || last4Supplied) && bankNameMatch && accountLast4Match;
  return {
    buyerId: profile.buyerId,
    verified,
    bankNameMatch,
    accountLast4Match,
    onFileBankName: onFileName,
    onFileAccountLast4: onFileLast4,
    reason: bankRefReason({ verified, nameSupplied, last4Supplied }),
  };
}

function bankRefReason(input: {
  readonly verified: boolean;
  readonly nameSupplied: boolean;
  readonly last4Supplied: boolean;
}): string {
  if (!input.nameSupplied && !input.last4Supplied) {
    return 'No bank reference fields supplied to verify against.';
  }
  return input.verified
    ? 'Supplied bank reference matches banking on file.'
    : 'Supplied bank reference does not match banking on file.';
}

function normaliseName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Build the AML concern reason persisted when adverse litigation is
 * recorded against a mining buyer. Litigation against an off-taker is a
 * counterparty-risk signal, so it flows through the repo's AML-flag path.
 */
export function litigationConcernReason(input: {
  readonly kind: string;
  readonly outcome?: string | undefined;
  readonly caseNumber?: string | undefined;
  readonly court?: string | undefined;
  readonly jurisdiction?: string | undefined;
  readonly amountInvolved?: number | undefined;
  readonly currency?: string | undefined;
  readonly summary?: string | undefined;
  readonly recordedBy: string;
}): string {
  const parts: string[] = [`Litigation recorded (${input.kind})`];
  if (input.outcome) parts.push(`outcome=${input.outcome}`);
  if (input.caseNumber) parts.push(`case=${input.caseNumber}`);
  if (input.court) parts.push(`court=${input.court}`);
  if (input.jurisdiction) parts.push(`jurisdiction=${input.jurisdiction}`);
  if (input.amountInvolved !== undefined && input.currency) {
    parts.push(`amount=${formatCurrency(input.amountInvolved, input.currency)}`);
  }
  if (input.summary) parts.push(`summary=${input.summary}`);
  parts.push(`recordedBy=${input.recordedBy}`);
  return parts.join(' | ').slice(0, 2000);
}
