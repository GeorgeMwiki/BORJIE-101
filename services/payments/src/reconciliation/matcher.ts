export interface Payment {
  id: string;
  transactionId: string;
  amount: number;
  phoneNumber: string;
  accountReference?: string;
  customerName?: string;
  transactionDate: Date;
  status: 'pending' | 'matched' | 'unmatched' | 'partial';
  /**
   * GePG control number (Tanzania). When present, the
   * `matchByGepgControlNumber` matcher should be preferred because it
   * is a deterministic 1:1 link.
   */
  gepgControlNumber?: string;
  /**
   * Provider channel: useful for disambiguating matchers. E.g. 'gepg',
   * 'mpesa', 'airtel'.
   */
  provider?: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  tenantName?: string;
  tenantPhone?: string;
  unitId: string;
  unitNumber?: string;
  propertyId: string;
  amount: number;
  balance: number;
  dueDate: Date;
  status: 'pending' | 'partial' | 'paid' | 'overdue';
  /**
   * GePG control number bound to this invoice (if one was issued).
   */
  gepgControlNumber?: string;
}

export interface GepgMatchResult {
  readonly matched: boolean;
  readonly confidence: number;
  readonly reason: string;
}

/**
 * Match a payment to an invoice by GePG control number.
 *
 * Deterministic match — if both sides carry the same control number
 * and the invoice belongs to the same tenant, it is an exact match
 * with 100% confidence regardless of amount (partial payments are
 * allowed; amount diff is reported but does not fail the match).
 *
 * Cross-tenant protection: the caller MUST have already filtered
 * invoices by tenantId. This function does not read tenantId from
 * the payment because payments table uses a separate tenant scope.
 */
export function matchByGepgControlNumber(
  payment: Payment,
  invoice: Invoice
): GepgMatchResult {
  if (!payment.gepgControlNumber) {
    return { matched: false, confidence: 0, reason: 'no_control_number_on_payment' };
  }
  if (!invoice.gepgControlNumber) {
    return { matched: false, confidence: 0, reason: 'no_control_number_on_invoice' };
  }
  if (payment.gepgControlNumber.trim() !== invoice.gepgControlNumber.trim()) {
    return { matched: false, confidence: 0, reason: 'control_number_mismatch' };
  }
  if (invoice.status === 'paid' || invoice.balance <= 0) {
    return {
      matched: true,
      confidence: 1,
      reason: 'control_number_match_invoice_already_paid',
    };
  }
  return {
    matched: true,
    confidence: 1,
    reason: 'control_number_exact_match',
  };
}

export interface MatchResult {
  payment: Payment;
  invoice: Invoice | null;
  confidence: number;
  matchType: 'exact' | 'fuzzy' | 'partial' | 'none';
  reasons: string[];
}

export interface ReconciliationSummary {
  totalPayments: number;
  matchedPayments: number;
  unmatchedPayments: number;
  partialMatches: number;
  totalAmountReceived: number;
  totalAmountMatched: number;
  results: MatchResult[];
}

export interface MatcherConfig {
  phoneMatchWeight: number;
  amountMatchWeight: number;
  referenceMatchWeight: number;
  nameMatchWeight: number;
  fuzzyThreshold: number;
  amountTolerancePercent: number;
}

const defaultConfig: MatcherConfig = {
  phoneMatchWeight: 0.35,
  amountMatchWeight: 0.35,
  referenceMatchWeight: 0.2,
  nameMatchWeight: 0.1,
  fuzzyThreshold: 0.7,
  amountTolerancePercent: 1, // 1% tolerance for amount matching
};

export class PaymentMatcher {
  private config: MatcherConfig;

  constructor(config: Partial<MatcherConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Normalize phone number for comparison
   */
  private normalizePhone(phone: string | undefined): string {
    if (!phone) return '';
    return phone.replace(/\D/g, '').slice(-9); // Get last 9 digits
  }

  /**
   * Calculate Levenshtein distance for fuzzy string matching
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const m = str1.length;
    const n = str2.length;
    const dp: number[][] = Array(m + 1)
      .fill(null)
      .map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1];
        } else {
          dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
    }

    return dp[m][n];
  }

  /**
   * Calculate string similarity (0-1)
   */
  private stringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    if (s1 === s2) return 1;

    const maxLen = Math.max(s1.length, s2.length);
    if (maxLen === 0) return 1;

    const distance = this.levenshteinDistance(s1, s2);
    return 1 - distance / maxLen;
  }

  /**
   * Check if phone numbers match
   */
  private phoneMatches(payment: Payment, invoice: Invoice): { matches: boolean; score: number } {
    const paymentPhone = this.normalizePhone(payment.phoneNumber);
    const invoicePhone = this.normalizePhone(invoice.tenantPhone);

    if (!paymentPhone || !invoicePhone) {
      return { matches: false, score: 0 };
    }

    if (paymentPhone === invoicePhone) {
      return { matches: true, score: 1 };
    }

    // Check for partial match (last 8 digits)
    if (paymentPhone.slice(-8) === invoicePhone.slice(-8)) {
      return { matches: true, score: 0.9 };
    }

    return { matches: false, score: 0 };
  }

  /**
   * Check if amounts match with tolerance
   */
  private amountMatches(
    payment: Payment,
    invoice: Invoice
  ): { matches: boolean; score: number; type: 'exact' | 'partial' | 'over' | 'none' } {
    const paymentAmount = payment.amount;
    const invoiceBalance = invoice.balance;
    const tolerance = invoiceBalance * (this.config.amountTolerancePercent / 100);

    // Exact match
    if (Math.abs(paymentAmount - invoiceBalance) <= tolerance) {
      return { matches: true, score: 1, type: 'exact' };
    }

    // Partial payment (less than balance)
    if (paymentAmount < invoiceBalance) {
      const ratio = paymentAmount / invoiceBalance;
      return { matches: true, score: ratio * 0.8, type: 'partial' };
    }

    // Overpayment
    if (paymentAmount > invoiceBalance) {
      const overRatio = invoiceBalance / paymentAmount;
      return { matches: true, score: overRatio * 0.7, type: 'over' };
    }

    return { matches: false, score: 0, type: 'none' };
  }

  /**
   * Check if account reference matches invoice ID or unit number
   */
  private referenceMatches(payment: Payment, invoice: Invoice): { matches: boolean; score: number } {
    const ref = payment.accountReference?.toLowerCase().trim();
    if (!ref) return { matches: false, score: 0 };

    // Direct invoice ID match
    if (ref === invoice.id.toLowerCase()) {
      return { matches: true, score: 1 };
    }

    // Unit number match
    if (invoice.unitNumber && ref.includes(invoice.unitNumber.toLowerCase())) {
      return { matches: true, score: 0.9 };
    }

    // Fuzzy match
    const similarity = Math.max(
      this.stringSimilarity(ref, invoice.id),
      invoice.unitNumber ? this.stringSimilarity(ref, invoice.unitNumber) : 0
    );

    if (similarity > 0.8) {
      return { matches: true, score: similarity };
    }

    return { matches: false, score: 0 };
  }

  /**
   * Check if customer name matches tenant name
   */
  private nameMatches(payment: Payment, invoice: Invoice): { matches: boolean; score: number } {
    if (!payment.customerName || !invoice.tenantName) {
      return { matches: false, score: 0 };
    }

    const similarity = this.stringSimilarity(payment.customerName, invoice.tenantName);

    if (similarity > 0.7) {
      return { matches: true, score: similarity };
    }

    // Check for partial name match (first name or last name)
    const paymentNames = payment.customerName.toLowerCase().split(/\s+/);
    const invoiceNames = invoice.tenantName.toLowerCase().split(/\s+/);

    for (const pName of paymentNames) {
      for (const iName of invoiceNames) {
        if (pName.length > 2 && iName.length > 2 && this.stringSimilarity(pName, iName) > 0.8) {
          return { matches: true, score: 0.7 };
        }
      }
    }

    return { matches: false, score: 0 };
  }

  /**
   * Calculate overall match confidence
   */
  private calculateConfidence(
    phoneScore: number,
    amountScore: number,
    referenceScore: number,
    nameScore: number
  ): number {
    const { phoneMatchWeight, amountMatchWeight, referenceMatchWeight, nameMatchWeight } = this.config;

    return (
      phoneScore * phoneMatchWeight +
      amountScore * amountMatchWeight +
      referenceScore * referenceMatchWeight +
      nameScore * nameMatchWeight
    );
  }

  /**
   * Find best matching invoice for a payment
   */
  fuzzyMatch(payment: Payment, invoices: Invoice[]): MatchResult {
    let bestMatch: MatchResult = {
      payment,
      invoice: null,
      confidence: 0,
      matchType: 'none',
      reasons: [],
    };

    for (const invoice of invoices) {
      // Skip already paid invoices
      if (invoice.status === 'paid' || invoice.balance <= 0) {
        continue;
      }

      const phoneResult = this.phoneMatches(payment, invoice);
      const amountResult = this.amountMatches(payment, invoice);
      const referenceResult = this.referenceMatches(payment, invoice);
      const nameResult = this.nameMatches(payment, invoice);

      const confidence = this.calculateConfidence(
        phoneResult.score,
        amountResult.score,
        referenceResult.score,
        nameResult.score
      );

      if (confidence > bestMatch.confidence) {
        const reasons: string[] = [];
        if (phoneResult.matches) reasons.push(`Phone match (${(phoneResult.score * 100).toFixed(0)}%)`);
        if (amountResult.matches) reasons.push(`Amount ${amountResult.type} (${(amountResult.score * 100).toFixed(0)}%)`);
        if (referenceResult.matches) reasons.push(`Reference match (${(referenceResult.score * 100).toFixed(0)}%)`);
        if (nameResult.matches) reasons.push(`Name match (${(nameResult.score * 100).toFixed(0)}%)`);

        let matchType: 'exact' | 'fuzzy' | 'partial' | 'none' = 'none';
        if (confidence >= 0.95) matchType = 'exact';
        else if (confidence >= this.config.fuzzyThreshold) matchType = 'fuzzy';
        else if (confidence >= 0.5) matchType = 'partial';

        bestMatch = {
          payment,
          invoice,
          confidence,
          matchType,
          reasons,
        };
      }
    }

    // Apply threshold
    if (bestMatch.confidence < this.config.fuzzyThreshold) {
      bestMatch.matchType = bestMatch.confidence >= 0.5 ? 'partial' : 'none';
    }

    return bestMatch;
  }

  /**
   * Reconcile multiple payments against invoices
   */
  reconcile(payments: Payment[], invoices: Invoice[]): ReconciliationSummary {
    const results: MatchResult[] = [];
    const matchedInvoiceIds = new Set<string>();

    // Sort payments by amount descending to match larger payments first
    const sortedPayments = [...payments].sort((a, b) => b.amount - a.amount);

    for (const payment of sortedPayments) {
      // Filter out already matched invoices
      const availableInvoices = invoices.filter((inv) => !matchedInvoiceIds.has(inv.id));
      const result = this.fuzzyMatch(payment, availableInvoices);

      if (result.invoice && result.matchType !== 'none') {
        matchedInvoiceIds.add(result.invoice.id);
      }

      results.push(result);
    }

    const matched = results.filter((r) => r.matchType === 'exact' || r.matchType === 'fuzzy');
    const partial = results.filter((r) => r.matchType === 'partial');
    const unmatched = results.filter((r) => r.matchType === 'none');

    return {
      totalPayments: payments.length,
      matchedPayments: matched.length,
      unmatchedPayments: unmatched.length,
      partialMatches: partial.length,
      totalAmountReceived: payments.reduce((sum, p) => sum + p.amount, 0),
      totalAmountMatched: matched.reduce((sum, r) => sum + r.payment.amount, 0),
      results,
    };
  }

  /**
   * Find potential duplicate payments
   */
  findDuplicates(payments: Payment[]): Payment[][] {
    const duplicates: Payment[][] = [];
    const checked = new Set<string>();

    for (let i = 0; i < payments.length; i++) {
      if (checked.has(payments[i].id)) continue;

      const group: Payment[] = [payments[i]];

      for (let j = i + 1; j < payments.length; j++) {
        if (checked.has(payments[j].id)) continue;

        // Same amount, same phone, within 24 hours
        if (
          payments[i].amount === payments[j].amount &&
          this.normalizePhone(payments[i].phoneNumber) === this.normalizePhone(payments[j].phoneNumber) &&
          Math.abs(payments[i].transactionDate.getTime() - payments[j].transactionDate.getTime()) < 24 * 60 * 60 * 1000
        ) {
          group.push(payments[j]);
          checked.add(payments[j].id);
        }
      }

      if (group.length > 1) {
        duplicates.push(group);
        checked.add(payments[i].id);
      }
    }

    return duplicates;
  }
}

export const paymentMatcher = new PaymentMatcher();
