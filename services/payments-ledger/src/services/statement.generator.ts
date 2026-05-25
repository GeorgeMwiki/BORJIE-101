/**
 * Statement Generator Service
 * 
 * Generates monthly owner statements with:
 * - Period summary
 * - Transaction details by property
 * - Fee breakdowns
 * - Disbursement history
 * - PDF rendering support
 */
import { v4 as uuidv4 } from 'uuid';
import { Money, CurrencyCode, LedgerEntryType } from '@borjie/domain-models';
import {
  Statement,
  StatementId,
  StatementLineItem,
  StatementSummary,
  StatementType,
  StatementPeriodType,
  StatementStatus,
  MoneyData,
  TenantId,
  OwnerId,
  CustomerId,
  AccountId,
  PropertyId,
  LedgerEntry,
  formatMoney,
  zeroMoney,
  addMoney,
  subtractMoney,
} from '../types';

/**
 * Statement generator dependencies
 */
export interface StatementGeneratorDeps {
  getLedgerEntries: (
    accountId: AccountId,
    tenantId: TenantId,
    fromDate: Date,
    toDate: Date
  ) => Promise<LedgerEntry[]>;
  getAccountBalance: (
    accountId: AccountId,
    tenantId: TenantId,
    asOfDate: Date
  ) => Promise<MoneyData | null>;
  getOwnerAccounts: (
    tenantId: TenantId,
    ownerId: OwnerId
  ) => Promise<{ id: AccountId; type: string; currency: CurrencyCode }[]>;
  getPropertyDetails: (
    propertyId: PropertyId,
    tenantId: TenantId
  ) => Promise<{ name: string; address: string } | null>;
  saveStatement: (statement: Statement) => Promise<Statement>;
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
}

/**
 * Statement PDF options
 */
export interface StatementPdfOptions {
  companyName: string;
  companyAddress: string;
  companyLogo?: string;
  companyEmail?: string;
  companyPhone?: string;
  showPropertyBreakdown: boolean;
  showTransactionDetails: boolean;
  includeDisclaimer: boolean;
  disclaimer?: string;
}

/**
 * Property transaction summary
 */
export interface PropertyTransactionSummary {
  propertyId: PropertyId;
  propertyName: string;
  rentCollected: MoneyData;
  platformFees: MoneyData;
  maintenanceCosts: MoneyData;
  otherExpenses: MoneyData;
  netIncome: MoneyData;
  occupancyRate?: number;
  transactions: StatementLineItem[];
}

/**
 * Statement PDF data for rendering
 */
export interface StatementPdfData {
  statement: Statement;
  options: StatementPdfOptions;
  ownerName: string;
  ownerEmail?: string;
  propertyBreakdown: PropertyTransactionSummary[];
  formattedAmounts: {
    openingBalance: string;
    closingBalance: string;
    totalDebits: string;
    totalCredits: string;
    netChange: string;
  };
}

/**
 * Entry type display names
 */
const ENTRY_TYPE_LABELS: Record<string, string> = {
  RENT_CHARGE: 'Rent Charge',
  RENT_PAYMENT: 'Rent Payment',
  DEPOSIT_CHARGE: 'Security Deposit',
  DEPOSIT_PAYMENT: 'Deposit Payment',
  DEPOSIT_REFUND: 'Deposit Refund',
  LATE_FEE: 'Late Fee',
  MAINTENANCE_CHARGE: 'Maintenance',
  UTILITY_CHARGE: 'Utilities',
  OWNER_CONTRIBUTION: 'Owner Contribution',
  OWNER_DISBURSEMENT: 'Disbursement',
  PLATFORM_FEE: 'Platform Fee',
  PAYMENT_PROCESSING_FEE: 'Processing Fee',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
  CORRECTION: 'Correction',
  WRITE_OFF: 'Write-Off',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
};

/**
 * Statement Generator Service
 */
export class StatementGenerator {
  private deps: StatementGeneratorDeps;

  constructor(deps: StatementGeneratorDeps) {
    this.deps = deps;
  }

  /**
   * Generate an owner monthly statement
   */
  async generateOwnerStatement(params: {
    tenantId: TenantId;
    ownerId: OwnerId;
    ownerName: string;
    accountId: AccountId;
    year: number;
    month: number;
    currency: CurrencyCode;
    createdBy: string;
  }): Promise<Statement> {
    const { periodStart, periodEnd } = this.getMonthlyPeriod(params.year, params.month);

    return this.generateStatement({
      tenantId: params.tenantId,
      type: 'OWNER_STATEMENT',
      periodType: 'MONTHLY',
      periodStart,
      periodEnd,
      accountId: params.accountId,
      ownerId: params.ownerId,
      currency: params.currency,
      createdBy: params.createdBy,
    });
  }

  /**
   * Generate a customer statement
   */
  async generateCustomerStatement(params: {
    tenantId: TenantId;
    customerId: CustomerId;
    accountId: AccountId;
    periodStart: Date;
    periodEnd: Date;
    currency: CurrencyCode;
    createdBy: string;
  }): Promise<Statement> {
    return this.generateStatement({
      tenantId: params.tenantId,
      type: 'CUSTOMER_STATEMENT',
      periodType: 'CUSTOM',
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      accountId: params.accountId,
      customerId: params.customerId,
      currency: params.currency,
      createdBy: params.createdBy,
    });
  }

  /**
   * Generate a property statement
   */
  async generatePropertyStatement(params: {
    tenantId: TenantId;
    propertyId: PropertyId;
    accountId: AccountId;
    periodStart: Date;
    periodEnd: Date;
    currency: CurrencyCode;
    createdBy: string;
  }): Promise<Statement> {
    return this.generateStatement({
      tenantId: params.tenantId,
      type: 'PROPERTY_STATEMENT',
      periodType: 'CUSTOM',
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      accountId: params.accountId,
      propertyId: params.propertyId,
      currency: params.currency,
      createdBy: params.createdBy,
    });
  }

  /**
   * Core statement generation logic
   */
  async generateStatement(params: {
    tenantId: TenantId;
    type: StatementType;
    periodType: StatementPeriodType;
    periodStart: Date;
    periodEnd: Date;
    accountId: AccountId;
    ownerId?: OwnerId;
    customerId?: CustomerId;
    propertyId?: PropertyId;
    currency: CurrencyCode;
    createdBy: string;
  }): Promise<Statement> {
    const statementId = `stmt_${uuidv4()}` as StatementId;
    const now = new Date();

    // Get opening balance (balance at the instant before period start).
    // Use UTC arithmetic — local getDate/setHours depend on the server's
    // TZ and silently shift the boundary when the server is not at UTC,
    // which caused boundary-day transactions to be double-counted or
    // dropped on reports.
    const openingBalanceDate = new Date(params.periodStart.getTime() - 1);

    const openingBalanceResult = await this.deps.getAccountBalance(
      params.accountId,
      params.tenantId,
      openingBalanceDate
    );
    const openingBalance = openingBalanceResult || zeroMoney(params.currency);

    // Get ledger entries for the period
    const entries = await this.deps.getLedgerEntries(
      params.accountId,
      params.tenantId,
      params.periodStart,
      params.periodEnd
    );

    // Build line items from entries
    let runningBalance = { ...openingBalance };
    const lineItems: StatementLineItem[] = [];
    let totalDebitsMinor = 0;
    let totalCreditsMinor = 0;

    for (const entry of entries) {
      const debit = entry.direction === 'DEBIT' ? entry.amount : undefined;
      const credit = entry.direction === 'CREDIT' ? entry.amount : undefined;

      if (debit) {
        runningBalance = addMoney(runningBalance, debit);
        totalDebitsMinor += debit.amountMinorUnits;
      }
      if (credit) {
        runningBalance = subtractMoney(runningBalance, credit);
        totalCreditsMinor += credit.amountMinorUnits;
      }

      lineItems.push({
        date: entry.effectiveDate,
        type: entry.type as LedgerEntryType,
        description: entry.description || ENTRY_TYPE_LABELS[entry.type] || entry.type,
        reference: entry.reference || entry.journalId,
        debit,
        credit,
        balance: { ...runningBalance },
        propertyId: entry.propertyId,
        unitId: entry.unitId,
      });
    }

    // Calculate summaries by entry type
    const summaries = this.calculateSummaries(entries, params.currency);

    const statement: Statement = {
      id: statementId,
      tenantId: params.tenantId,
      type: params.type,
      status: 'GENERATED',
      accountId: params.accountId,
      ownerId: params.ownerId,
      customerId: params.customerId,
      propertyId: params.propertyId,
      periodType: params.periodType,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      currency: params.currency,
      openingBalance,
      closingBalance: runningBalance,
      totalDebits: { amountMinorUnits: totalDebitsMinor, currency: params.currency },
      totalCredits: { amountMinorUnits: totalCreditsMinor, currency: params.currency },
      lineItems,
      summaries,
      generatedAt: now,
      createdAt: now,
      createdBy: params.createdBy,
      updatedAt: now,
      updatedBy: params.createdBy,
    };

    const savedStatement = await this.deps.saveStatement(statement);

    this.deps.logger.info('Statement generated', {
      statementId: savedStatement.id,
      tenantId: savedStatement.tenantId,
      type: savedStatement.type,
      periodStart: savedStatement.periodStart,
      periodEnd: savedStatement.periodEnd,
      openingBalance: formatMoney(savedStatement.openingBalance),
      closingBalance: formatMoney(savedStatement.closingBalance),
    });

    return savedStatement;
  }

  /**
   * Generate PDF data for a statement
   */
  async generatePdfData(
    statement: Statement,
    ownerName: string,
    options: StatementPdfOptions,
    ownerEmail?: string
  ): Promise<StatementPdfData> {
    // Group transactions by property
    const propertyBreakdown = await this.calculatePropertyBreakdown(
      statement,
      options.showPropertyBreakdown
    );

    const netChange = subtractMoney(statement.closingBalance, statement.openingBalance);

    return {
      statement,
      options,
      ownerName,
      ownerEmail,
      propertyBreakdown,
      formattedAmounts: {
        openingBalance: formatMoney(statement.openingBalance),
        closingBalance: formatMoney(statement.closingBalance),
        totalDebits: formatMoney(statement.totalDebits),
        totalCredits: formatMoney(statement.totalCredits),
        netChange: formatMoney(netChange),
      },
    };
  }

  /**
   * Generate HTML template for statement PDF
   */
  generateHtmlTemplate(pdfData: StatementPdfData): string {
    const { statement, options, ownerName, formattedAmounts, propertyBreakdown } = pdfData;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Statement - ${this.formatPeriod(statement.periodStart, statement.periodEnd)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #333; line-height: 1.4; }
    .statement { max-width: 800px; margin: 0 auto; padding: 30px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #2563eb; padding-bottom: 20px; }
    .company-info { }
    .company-name { font-size: 20px; font-weight: bold; color: #2563eb; margin-bottom: 4px; }
    .statement-title { text-align: right; }
    .statement-title h1 { font-size: 24px; color: #1f2937; margin-bottom: 4px; }
    .period { font-size: 12px; color: #6b7280; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .party { }
    .party-label { font-size: 9px; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; letter-spacing: 0.5px; }
    .party-name { font-weight: 600; font-size: 13px; }
    .summary-boxes { display: flex; gap: 15px; margin-bottom: 30px; }
    .summary-box { flex: 1; padding: 15px; background: #f9fafb; border-radius: 8px; text-align: center; }
    .summary-box.highlight { background: #2563eb; color: white; }
    .summary-label { font-size: 9px; text-transform: uppercase; color: #6b7280; margin-bottom: 4px; }
    .summary-box.highlight .summary-label { color: rgba(255,255,255,0.8); }
    .summary-value { font-size: 18px; font-weight: bold; }
    .section { margin-bottom: 25px; }
    .section-title { font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #e5e7eb; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #f9fafb; padding: 8px 10px; text-align: left; font-size: 9px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
    td { padding: 8px 10px; border-bottom: 1px solid #f3f4f6; }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .debit { color: #059669; }
    .credit { color: #dc2626; }
    .property-summary { background: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
    .property-name { font-weight: 600; font-size: 12px; margin-bottom: 8px; }
    .property-stats { display: flex; gap: 20px; }
    .property-stat { }
    .property-stat-label { font-size: 9px; color: #6b7280; }
    .property-stat-value { font-weight: 600; }
    .category-summary { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
    .category-summary:last-child { border-bottom: none; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
    .footer-text { font-size: 9px; color: #9ca3af; text-align: center; }
    .disclaimer { background: #fef3c7; padding: 12px; border-radius: 6px; font-size: 9px; color: #92400e; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="statement">
    <div class="header">
      <div class="company-info">
        ${options.companyLogo ? `<img src="${options.companyLogo}" alt="Logo" style="height: 40px; margin-bottom: 8px;">` : ''}
        <div class="company-name">${options.companyName}</div>
        <div>${options.companyAddress}</div>
        ${options.companyEmail ? `<div>${options.companyEmail}</div>` : ''}
      </div>
      <div class="statement-title">
        <h1>OWNER STATEMENT</h1>
        <div class="period">${this.formatPeriod(statement.periodStart, statement.periodEnd)}</div>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="party-label">Statement For</div>
        <div class="party-name">${ownerName}</div>
        ${pdfData.ownerEmail ? `<div>${pdfData.ownerEmail}</div>` : ''}
      </div>
      <div class="party">
        <div class="party-label">Statement Date</div>
        <div class="party-name">${this.formatDate(statement.generatedAt || new Date())}</div>
      </div>
    </div>

    <div class="summary-boxes">
      <div class="summary-box">
        <div class="summary-label">Opening Balance</div>
        <div class="summary-value">${formattedAmounts.openingBalance}</div>
      </div>
      <div class="summary-box">
        <div class="summary-label">Total Debits</div>
        <div class="summary-value debit">+${formattedAmounts.totalDebits}</div>
      </div>
      <div class="summary-box">
        <div class="summary-label">Total Credits</div>
        <div class="summary-value credit">-${formattedAmounts.totalCredits}</div>
      </div>
      <div class="summary-box highlight">
        <div class="summary-label">Closing Balance</div>
        <div class="summary-value">${formattedAmounts.closingBalance}</div>
      </div>
    </div>

    ${options.showPropertyBreakdown && propertyBreakdown.length > 0 ? `
    <div class="section">
      <div class="section-title">Property Summary</div>
      ${propertyBreakdown.map(prop => `
      <div class="property-summary">
        <div class="property-name">${prop.propertyName}</div>
        <div class="property-stats">
          <div class="property-stat">
            <div class="property-stat-label">Rent Collected</div>
            <div class="property-stat-value debit">${formatMoney(prop.rentCollected)}</div>
          </div>
          <div class="property-stat">
            <div class="property-stat-label">Platform Fees</div>
            <div class="property-stat-value credit">${formatMoney(prop.platformFees)}</div>
          </div>
          <div class="property-stat">
            <div class="property-stat-label">Maintenance</div>
            <div class="property-stat-value credit">${formatMoney(prop.maintenanceCosts)}</div>
          </div>
          <div class="property-stat">
            <div class="property-stat-label">Net Income</div>
            <div class="property-stat-value">${formatMoney(prop.netIncome)}</div>
          </div>
        </div>
      </div>
      `).join('')}
    </div>
    ` : ''}

    <div class="section">
      <div class="section-title">Summary by Category</div>
      ${statement.summaries.map(summary => `
      <div class="category-summary">
        <span>${summary.category}</span>
        <span class="${summary.netAmount.amountMinorUnits >= 0 ? 'debit' : 'credit'}">${formatMoney(summary.netAmount)}</span>
      </div>
      `).join('')}
    </div>

    ${options.showTransactionDetails ? `
    <div class="section">
      <div class="section-title">Transaction Details</div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Reference</th>
            <th class="text-right">Debit</th>
            <th class="text-right">Credit</th>
            <th class="text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colspan="5"><em>Opening Balance</em></td>
            <td class="text-right"><strong>${formattedAmounts.openingBalance}</strong></td>
          </tr>
          ${statement.lineItems.map(item => `
          <tr>
            <td>${this.formatDate(item.date)}</td>
            <td>${item.description}</td>
            <td>${item.reference || '-'}</td>
            <td class="text-right debit">${item.debit ? formatMoney(item.debit) : '-'}</td>
            <td class="text-right credit">${item.credit ? formatMoney(item.credit) : '-'}</td>
            <td class="text-right">${formatMoney(item.balance)}</td>
          </tr>
          `).join('')}
          <tr style="font-weight: bold; background: #f9fafb;">
            <td colspan="5">Closing Balance</td>
            <td class="text-right">${formattedAmounts.closingBalance}</td>
          </tr>
        </tbody>
      </table>
    </div>
    ` : ''}

    ${options.includeDisclaimer && options.disclaimer ? `
    <div class="disclaimer">
      ${options.disclaimer}
    </div>
    ` : ''}

    <div class="footer">
      <div class="footer-text">
        This statement was generated on ${this.formatDate(new Date())}. 
        For questions, please contact ${options.companyEmail || options.companyName}.
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Get period dates for monthly statement.
   *
   * Uses UTC — `new Date(y, m, d)` implicitly uses the server's LOCAL
   * timezone which shifts period boundaries for anyone not running at
   * UTC. A tenant requesting "April 2026" on a UTC+3 server previously
   * produced a window starting at 2026-03-31T21:00:00Z, silently
   * pulling 3 hours of prior-month entries into the current report.
   */
  getMonthlyPeriod(year: number, month: number): { periodStart: Date; periodEnd: Date } {
    return {
      periodStart: new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)),
      periodEnd: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
    };
  }

  /**
   * Get period dates for quarterly statement (UTC-based — see getMonthlyPeriod).
   */
  getQuarterlyPeriod(year: number, quarter: number): { periodStart: Date; periodEnd: Date } {
    const startMonth = (quarter - 1) * 3;
    return {
      periodStart: new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0)),
      periodEnd: new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999)),
    };
  }

  /**
   * Get period dates for annual statement (UTC-based — see getMonthlyPeriod).
   */
  getAnnualPeriod(year: number): { periodStart: Date; periodEnd: Date } {
    return {
      periodStart: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
      periodEnd: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
    };
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private calculateSummaries(entries: LedgerEntry[], currency: CurrencyCode): StatementSummary[] {
    const byType: Map<string, { debits: number; credits: number }> = new Map();

    for (const entry of entries) {
      const existing = byType.get(entry.type) || { debits: 0, credits: 0 };
      if (entry.direction === 'DEBIT') {
        existing.debits += entry.amount.amountMinorUnits;
      } else {
        existing.credits += entry.amount.amountMinorUnits;
      }
      byType.set(entry.type, existing);
    }

    return Array.from(byType.entries())
      .map(([type, totals]) => ({
        category: ENTRY_TYPE_LABELS[type] || type,
        totalDebits: { amountMinorUnits: totals.debits, currency },
        totalCredits: { amountMinorUnits: totals.credits, currency },
        netAmount: { amountMinorUnits: totals.debits - totals.credits, currency },
      }))
      .sort((a, b) => Math.abs(b.netAmount.amountMinorUnits) - Math.abs(a.netAmount.amountMinorUnits));
  }

  private async calculatePropertyBreakdown(
    statement: Statement,
    includeBreakdown: boolean
  ): Promise<PropertyTransactionSummary[]> {
    if (!includeBreakdown) {
      return [];
    }

    const byProperty: Map<string, {
      rentCollected: number;
      platformFees: number;
      maintenanceCosts: number;
      otherExpenses: number;
      transactions: StatementLineItem[];
    }> = new Map();

    for (const item of statement.lineItems) {
      const propertyId = item.propertyId || 'GENERAL';
      const existing = byProperty.get(propertyId) || {
        rentCollected: 0,
        platformFees: 0,
        maintenanceCosts: 0,
        otherExpenses: 0,
        transactions: [],
      };

      existing.transactions.push(item);

      // Categorize amounts
      if (item.debit) {
        if (item.type === 'RENT_PAYMENT') {
          existing.rentCollected += item.debit.amountMinorUnits;
        }
      }
      if (item.credit) {
        if (item.type === 'PLATFORM_FEE' || item.type === 'PAYMENT_PROCESSING_FEE') {
          existing.platformFees += item.credit.amountMinorUnits;
        } else if (item.type === 'MAINTENANCE_CHARGE') {
          existing.maintenanceCosts += item.credit.amountMinorUnits;
        } else {
          existing.otherExpenses += item.credit.amountMinorUnits;
        }
      }

      byProperty.set(propertyId, existing);
    }

    // Wave 25 Agent V: previously each property lookup ran sequentially
    // inside the loop, costing N round-trips serialized by latency. We
    // now resolve all property names in parallel before building the
    // results. (A true batched loader would require extending
    // `StatementGeneratorDeps.getPropertyDetails` to accept an id array
    // — flagged in Docs/WAVE25_FINDINGS as a follow-up; this change
    // preserves the existing deps contract.)
    const entries = Array.from(byProperty.entries());
    const propertyNames = await Promise.all(
      entries.map(async ([propertyId]) => {
        if (propertyId === 'GENERAL') return 'General';
        const details = await this.deps.getPropertyDetails(
          propertyId as PropertyId,
          statement.tenantId
        );
        return details?.name || `Property ${propertyId}`;
      })
    );

    const results: PropertyTransactionSummary[] = entries.map(([propertyId, data], index) => {
      const netIncome = data.rentCollected - data.platformFees - data.maintenanceCosts - data.otherExpenses;
      return {
        propertyId: propertyId as PropertyId,
        propertyName: propertyNames[index]!,
        rentCollected: { amountMinorUnits: data.rentCollected, currency: statement.currency },
        platformFees: { amountMinorUnits: data.platformFees, currency: statement.currency },
        maintenanceCosts: { amountMinorUnits: data.maintenanceCosts, currency: statement.currency },
        otherExpenses: { amountMinorUnits: data.otherExpenses, currency: statement.currency },
        netIncome: { amountMinorUnits: netIncome, currency: statement.currency },
        transactions: data.transactions,
      };
    });

    return results.sort((a, b) => b.netIncome.amountMinorUnits - a.netIncome.amountMinorUnits);
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private formatPeriod(start: Date, end: Date): string {
    const startStr = start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const endStr = end.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    
    if (startStr === endStr) {
      return startStr;
    }
    return `${this.formatDate(start)} - ${this.formatDate(end)}`;
  }
}

/**
 * Factory function to create a StatementGenerator
 */
export function createStatementGenerator(deps: StatementGeneratorDeps): StatementGenerator {
  return new StatementGenerator(deps);
}
