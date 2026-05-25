/**
 * Statement Generation Service
 * Generates financial statements for owners and customers
 */
import { v4 as uuidv4 } from 'uuid';
import {
  Money,
  Statement,
  StatementAggregate,
  StatementBuilder,
  StatementId,
  StatementType,
  StatementPeriodType,
  TenantId,
  OwnerId,
  CustomerId,
  AccountId,
  PropertyId,
  LedgerEntryType,
  CurrencyCode
} from '@borjie/domain-models';
import { createId } from '../domain-extensions';
import { ILedgerRepository } from '../repositories/ledger.repository';
import { IAccountRepository } from '../repositories/account.repository';
import { IStatementRepository } from '../repositories/statement.repository';
import { IEventPublisher, createEvent } from '../events/event-publisher';
import { StatementGeneratedEvent, StatementSentEvent } from '../events/payment-events';
import { ILogger } from './payment-orchestration.service';

/**
 * Statement generation request
 */
export interface GenerateStatementRequest {
  tenantId: TenantId;
  type: StatementType;
  periodType: StatementPeriodType;
  periodStart: Date;
  periodEnd: Date;
  accountId: AccountId;
  ownerId?: OwnerId;
  customerId?: CustomerId;
  propertyId?: PropertyId;
  includeDetails?: boolean;
}

/**
 * Statement delivery request
 */
export interface DeliverStatementRequest {
  statementId: StatementId;
  tenantId: TenantId;
  recipientEmail: string;
  method: 'EMAIL' | 'DOWNLOAD';
}

export interface StatementGenerationServiceDeps {
  ledgerRepository: ILedgerRepository;
  accountRepository: IAccountRepository;
  statementRepository: IStatementRepository;
  eventPublisher: IEventPublisher;
  logger: ILogger;
}

/**
 * Entry type display names for statements.
 * Uses a string-keyed record because the ledger may contain entry types
 * beyond the core LedgerEntryType enum (e.g. maintenance, utility, etc.).
 */
const ENTRY_TYPE_LABELS: Record<string, string> = {
  RENT_CHARGE: 'Rent Charge',
  RENT_PAYMENT: 'Rent Payment',
  DEPOSIT_CHARGE: 'Security Deposit Charge',
  DEPOSIT_PAYMENT: 'Security Deposit Payment',
  DEPOSIT_REFUND: 'Security Deposit Refund',
  LATE_FEE: 'Late Fee',
  MAINTENANCE_CHARGE: 'Maintenance Charge',
  UTILITY_CHARGE: 'Utility Charge',
  OWNER_CONTRIBUTION: 'Owner Contribution',
  OWNER_DISBURSEMENT: 'Owner Disbursement',
  PLATFORM_FEE: 'Platform Fee',
  PAYMENT_PROCESSING_FEE: 'Processing Fee',
  REFUND: 'Refund',
  ADJUSTMENT: 'Adjustment',
  WRITE_OFF: 'Write-Off',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out'
};

/**
 * Statement Generation Service
 */
export class StatementGenerationService {
  private ledgerRepository: ILedgerRepository;
  private accountRepository: IAccountRepository;
  private statementRepository: IStatementRepository;
  private eventPublisher: IEventPublisher;
  private logger: ILogger;

  constructor(deps: StatementGenerationServiceDeps) {
    this.ledgerRepository = deps.ledgerRepository;
    this.accountRepository = deps.accountRepository;
    this.statementRepository = deps.statementRepository;
    this.eventPublisher = deps.eventPublisher;
    this.logger = deps.logger;
  }

  /**
   * Generate a financial statement
   */
  async generateStatement(request: GenerateStatementRequest): Promise<Statement> {
    // Check if statement already exists for this period
    const exists = await this.statementRepository.existsForPeriod(
      request.tenantId,
      request.accountId,
      request.type,
      request.periodStart,
      request.periodEnd
    );

    if (exists) {
      throw new Error(
        `Statement already exists for account ${request.accountId} ` +
        `for period ${request.periodStart.toISOString()} to ${request.periodEnd.toISOString()}`
      );
    }

    // Get account
    const account = await this.accountRepository.findById(request.accountId, request.tenantId);
    if (!account) {
      throw new Error(`Account ${request.accountId} not found`);
    }

    // Get opening balance (balance just before period start)
    const openingBalanceResult = await this.ledgerRepository.calculateAccountBalance(
      request.accountId,
      request.tenantId,
      new Date(request.periodStart.getTime() - 1)
    );
    const openingBalance = openingBalanceResult
      ? Money.fromMinorUnits(openingBalanceResult.balance, account.currency)
      : Money.zero(account.currency);

    // Get ledger entries for the period
    const entries = await this.ledgerRepository.findForStatement(
      request.accountId,
      request.tenantId,
      request.periodStart,
      request.periodEnd
    );

    // Create statement using builder
    const statementId = createId<StatementId>(`stmt_${uuidv4()}`);
    const builder = new StatementBuilder(
      statementId,
      request.tenantId,
      request.type,
      account.currency,
      openingBalance
    );

    builder
      .setPeriod(request.periodType, request.periodStart, request.periodEnd)
      .setAccount(request.accountId);

    if (request.ownerId) {
      builder.setOwner(request.ownerId);
    }
    if (request.customerId) {
      builder.setCustomer(request.customerId);
    }
    if (request.propertyId) {
      builder.setProperty(request.propertyId);
    }

    // Add line items from ledger entries
    for (const entry of entries) {
      const label = ENTRY_TYPE_LABELS[entry.type] || entry.type;
      builder.addLineItem(
        entry.effectiveDate,
        entry.type,
        entry.description || label,
        {
          debit: entry.direction === 'DEBIT' ? entry.amount : undefined,
          credit: entry.direction === 'CREDIT' ? entry.amount : undefined,
          reference: entry.journalId,
          propertyId: entry.propertyId,
          unitId: entry.unitId,
          metadata: { ledgerEntryId: entry.id }
        }
      );
    }

    // Calculate and add summaries
    const totalsByType = await this.ledgerRepository.getTotalsByType(
      request.accountId,
      request.tenantId,
      request.periodStart,
      request.periodEnd
    );

    // Add summary by entry type
    for (const [type, totals] of totalsByType) {
      const label = ENTRY_TYPE_LABELS[type] || type;
      const netAmount = Money.fromMinorUnits(
        totals.debits - totals.credits,
        account.currency
      );
      builder.addSummary(`${label} (Net)`, netAmount);
    }

    // Build and save statement
    const statement = builder.build('system');
    await this.statementRepository.create(statement);

    // Mark as generated
    const aggregate = new StatementAggregate(statement);
    aggregate.markGenerated();
    await this.statementRepository.update(aggregate.toData());

    // Publish event
    await this.eventPublisher.publish(
      createEvent<StatementGeneratedEvent>(
        'STATEMENT_GENERATED',
        'Statement',
        statementId,
        request.tenantId,
        {
          statementId,
          type: request.type,
          ownerId: request.ownerId,
          customerId: request.customerId,
          periodStart: request.periodStart,
          periodEnd: request.periodEnd,
          openingBalance: openingBalance.toData(),
          closingBalance: statement.closingBalance.toData()
        }
      )
    );

    this.logger.info('Statement generated', {
      statementId,
      tenantId: request.tenantId,
      type: request.type,
      periodStart: request.periodStart,
      periodEnd: request.periodEnd
    });

    return aggregate.toData();
  }

  /**
   * Generate monthly owner statement
   */
  async generateOwnerMonthlyStatement(
    tenantId: TenantId,
    ownerId: OwnerId,
    year: number,
    month: number
  ): Promise<Statement> {
    // Get owner's operating account
    const account = await this.accountRepository.findByOwnerAndType(
      tenantId,
      ownerId,
      'OWNER_OPERATING'
    );
    if (!account) {
      throw new Error(`Owner operating account not found for owner ${ownerId}`);
    }

    const periodStart = new Date(year, month - 1, 1);
    const periodEnd = new Date(year, month, 0, 23, 59, 59, 999);

    return this.generateStatement({
      tenantId,
      type: 'OWNER_STATEMENT',
      periodType: 'MONTHLY',
      periodStart,
      periodEnd,
      accountId: account.id,
      ownerId
    });
  }

  /**
   * Generate customer account statement
   */
  async generateCustomerStatement(
    tenantId: TenantId,
    customerId: CustomerId,
    periodStart: Date,
    periodEnd: Date
  ): Promise<Statement> {
    // Get customer's liability account
    const account = await this.accountRepository.findByCustomerAndType(
      tenantId,
      customerId,
      'CUSTOMER_LIABILITY'
    );
    if (!account) {
      throw new Error(`Customer liability account not found for customer ${customerId}`);
    }

    return this.generateStatement({
      tenantId,
      type: 'CUSTOMER_STATEMENT',
      periodType: 'CUSTOM',
      periodStart,
      periodEnd,
      accountId: account.id,
      customerId
    });
  }

  /**
   * Deliver statement to recipient
   */
  async deliverStatement(request: DeliverStatementRequest): Promise<void> {
    const statement = await this.statementRepository.findById(
      request.statementId,
      request.tenantId
    );
    if (!statement) {
      throw new Error(`Statement ${request.statementId} not found`);
    }

    const aggregate = new StatementAggregate(statement);
    aggregate.markSent(request.recipientEmail);
    await this.statementRepository.update(aggregate.toData());

    try {
      const notificationsUrl = process.env.NOTIFICATIONS_SERVICE_URL || process.env.API_URL;
      if (notificationsUrl) {
        await fetch(`${notificationsUrl}/api/v1/notifications/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': process.env.INTERNAL_API_KEY || '' },
          body: JSON.stringify({
            channel: 'email',
            to: request.recipientEmail,
            template: 'statement_delivery',
            data: { statementId: request.statementId, tenantId: request.tenantId },
          }),
          signal: AbortSignal.timeout(5000),
        });
      }
    } catch {
      this.logger?.warn?.('Failed to send statement email notification', { statementId: request.statementId });
    }

    // Publish event
    await this.eventPublisher.publish(
      createEvent<StatementSentEvent>(
        'STATEMENT_SENT',
        'Statement',
        request.statementId,
        request.tenantId,
        {
          statementId: request.statementId,
          recipientEmail: request.recipientEmail,
          sentAt: new Date()
        }
      )
    );

    this.logger.info('Statement delivered', {
      statementId: request.statementId,
      recipientEmail: request.recipientEmail
    });
  }

  /**
   * Get statement by ID
   */
  async getStatement(
    statementId: StatementId,
    tenantId: TenantId
  ): Promise<Statement | null> {
    return this.statementRepository.findById(statementId, tenantId);
  }

  /**
   * Get owner statements
   */
  async getOwnerStatements(
    tenantId: TenantId,
    ownerId: OwnerId,
    page?: number,
    pageSize?: number
  ) {
    return this.statementRepository.find(
      {
        tenantId,
        ownerId,
        type: 'OWNER_STATEMENT'
      },
      page,
      pageSize
    );
  }

  /**
   * Get customer statements
   */
  async getCustomerStatements(
    tenantId: TenantId,
    customerId: CustomerId,
    page?: number,
    pageSize?: number
  ) {
    return this.statementRepository.find(
      {
        tenantId,
        customerId,
        type: 'CUSTOMER_STATEMENT'
      },
      page,
      pageSize
    );
  }

  /**
   * Mark statement as viewed
   */
  async markStatementViewed(
    statementId: StatementId,
    tenantId: TenantId
  ): Promise<void> {
    const statement = await this.statementRepository.findById(statementId, tenantId);
    if (!statement) {
      throw new Error(`Statement ${statementId} not found`);
    }

    const aggregate = new StatementAggregate(statement);
    aggregate.markViewed();
    await this.statementRepository.update(aggregate.toData());
  }

  // ===========================================================================
  // Export Format Support (PDF / Excel / CSV)
  // ===========================================================================

  /**
   * Export statement as HTML (for PDF rendering via puppeteer / wkhtmltopdf).
   * Returns the full HTML document string ready for conversion.
   */
  async exportAsPdfHtml(
    statementId: StatementId,
    tenantId: TenantId,
    options?: {
      companyName?: string;
      companyAddress?: string;
      companyEmail?: string;
      companyLogo?: string;
    }
  ): Promise<string> {
    const statement = await this.statementRepository.findById(statementId, tenantId);
    if (!statement) {
      throw new Error(`Statement ${statementId} not found`);
    }

    const companyName = options?.companyName || 'BORJIE';
    const companyAddress = options?.companyAddress || '';

    const periodLabel = `${this.formatDate(statement.periodStart)} – ${this.formatDate(statement.periodEnd)}`;
    const lineRows = statement.lineItems
      .map(item => {
        const label = ENTRY_TYPE_LABELS[item.type] || item.type;
        const debit = item.debit ? this.formatMoney(item.debit) : '';
        const credit = item.credit ? this.formatMoney(item.credit) : '';
        return `<tr>
          <td>${this.formatDate(item.date)}</td>
          <td>${item.description || label}</td>
          <td>${item.reference || ''}</td>
          <td class="text-right debit">${debit}</td>
          <td class="text-right credit">${credit}</td>
          <td class="text-right">${this.formatMoney(item.balance)}</td>
        </tr>`;
      })
      .join('\n');

    const summaryRows = statement.summaries
      .map(s => `<tr><td>${s.label}</td><td class="text-right">${this.formatMoney(s.amount)}</td><td class="text-right">${s.percentage != null ? s.percentage.toFixed(1) + '%' : ''}</td></tr>`)
      .join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Statement – ${periodLabel}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11px; color: #333; line-height: 1.5; }
    .page { max-width: 800px; margin: 0 auto; padding: 30px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 24px; border-bottom: 2px solid #2563eb; padding-bottom: 16px; }
    .company-name { font-size: 20px; font-weight: bold; color: #2563eb; }
    h1 { font-size: 22px; text-align: right; }
    .period { color: #6b7280; text-align: right; }
    .summary { display: flex; gap: 12px; margin-bottom: 24px; }
    .summary-box { flex: 1; background: #f9fafb; border-radius: 8px; padding: 12px; text-align: center; }
    .summary-box .label { font-size: 9px; text-transform: uppercase; color: #6b7280; }
    .summary-box .value { font-size: 16px; font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { background: #f3f4f6; padding: 8px; text-align: left; font-size: 9px; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; }
    td { padding: 8px; border-bottom: 1px solid #f3f4f6; }
    .text-right { text-align: right; }
    .debit { color: #059669; }
    .credit { color: #dc2626; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 9px; color: #9ca3af; text-align: center; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        ${options?.companyLogo ? `<img src="${options.companyLogo}" alt="" style="height:36px;margin-bottom:6px;">` : ''}
        <div class="company-name">${companyName}</div>
        <div>${companyAddress}</div>
        ${options?.companyEmail ? `<div>${options.companyEmail}</div>` : ''}
      </div>
      <div>
        <h1>${statement.type === 'OWNER_STATEMENT' ? 'OWNER STATEMENT' : 'ACCOUNT STATEMENT'}</h1>
        <div class="period">${periodLabel}</div>
      </div>
    </div>

    <div class="summary">
      <div class="summary-box"><div class="label">Opening Balance</div><div class="value">${this.formatMoney(statement.openingBalance)}</div></div>
      <div class="summary-box"><div class="label">Total Debits</div><div class="value debit">${this.formatMoney(statement.totalDebits)}</div></div>
      <div class="summary-box"><div class="label">Total Credits</div><div class="value credit">${this.formatMoney(statement.totalCredits)}</div></div>
      <div class="summary-box"><div class="label">Closing Balance</div><div class="value">${this.formatMoney(statement.closingBalance)}</div></div>
    </div>

    <h3 style="margin-bottom:8px;">Transaction Details</h3>
    <table>
      <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th class="text-right">Debit</th><th class="text-right">Credit</th><th class="text-right">Balance</th></tr></thead>
      <tbody>${lineRows}</tbody>
    </table>

    ${statement.summaries.length > 0 ? `
    <h3 style="margin-bottom:8px;">Summary by Category</h3>
    <table>
      <thead><tr><th>Category</th><th class="text-right">Amount</th><th class="text-right">%</th></tr></thead>
      <tbody>${summaryRows}</tbody>
    </table>` : ''}

    <div class="footer">
      <div>Generated on ${this.formatDate(new Date())} by ${companyName}</div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Export statement as CSV (for Excel import / download).
   * Returns a CSV string with statement line items.
   */
  async exportAsCsv(
    statementId: StatementId,
    tenantId: TenantId
  ): Promise<string> {
    const statement = await this.statementRepository.findById(statementId, tenantId);
    if (!statement) {
      throw new Error(`Statement ${statementId} not found`);
    }

    const headers = ['Date', 'Type', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'];
    const rows = statement.lineItems.map(item => [
      this.formatDate(item.date),
      item.type,
      `"${(item.description || '').replace(/"/g, '""')}"`,
      item.reference || '',
      item.debit ? (item.debit.amountMinorUnits / 100).toFixed(2) : '',
      item.credit ? (item.credit.amountMinorUnits / 100).toFixed(2) : '',
      (item.balance.amountMinorUnits / 100).toFixed(2)
    ]);

    // Add header row with statement metadata
    const metaRows = [
      [`Statement: ${statementId}`],
      [`Period: ${this.formatDate(statement.periodStart)} to ${this.formatDate(statement.periodEnd)}`],
      [`Currency: ${statement.currency}`],
      [`Opening Balance: ${(statement.openingBalance.amountMinorUnits / 100).toFixed(2)}`],
      [`Closing Balance: ${(statement.closingBalance.amountMinorUnits / 100).toFixed(2)}`],
      [], // blank line
      headers,
      ...rows,
      [], // blank line
      ['Category', 'Amount', 'Percentage'],
      ...statement.summaries.map(s => [
        s.label,
        (s.amount.amountMinorUnits / 100).toFixed(2),
        s.percentage != null ? s.percentage.toFixed(1) + '%' : ''
      ])
    ];

    return metaRows.map(row => row.join(',')).join('\n');
  }

  /**
   * Export statement in the requested format.
   * @param format - 'pdf' for HTML-based PDF, 'csv' for CSV/Excel, 'json' for raw data
   */
  async exportStatement(
    statementId: StatementId,
    tenantId: TenantId,
    format: 'pdf' | 'csv' | 'json',
    pdfOptions?: {
      companyName?: string;
      companyAddress?: string;
      companyEmail?: string;
      companyLogo?: string;
    }
  ): Promise<{ content: string; contentType: string; filename: string }> {
    const statement = await this.statementRepository.findById(statementId, tenantId);
    if (!statement) {
      throw new Error(`Statement ${statementId} not found`);
    }

    const periodLabel = `${statement.periodStart.getFullYear()}-${String(statement.periodStart.getMonth() + 1).padStart(2, '0')}`;
    const baseFilename = `statement-${statementId}-${periodLabel}`;

    switch (format) {
      case 'pdf': {
        const html = await this.exportAsPdfHtml(statementId, tenantId, pdfOptions);
        return {
          content: html,
          contentType: 'text/html',
          filename: `${baseFilename}.html`
        };
      }
      case 'csv': {
        const csv = await this.exportAsCsv(statementId, tenantId);
        return {
          content: csv,
          contentType: 'text/csv',
          filename: `${baseFilename}.csv`
        };
      }
      case 'json': {
        return {
          content: JSON.stringify(statement, null, 2),
          contentType: 'application/json',
          filename: `${baseFilename}.json`
        };
      }
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private formatMoney(money: Money | { amountMinorUnits: number; currency: string }): string {
    const minor = money.amountMinorUnits;
    const curr = 'currency' in money ? money.currency : '';
    return `${curr} ${(minor / 100).toFixed(2)}`;
  }

  /**
   * Get period dates for monthly statement
   */
  static getMonthlyPeriod(year: number, month: number): { start: Date; end: Date } {
    return {
      start: new Date(year, month - 1, 1),
      end: new Date(year, month, 0, 23, 59, 59, 999)
    };
  }

  /**
   * Get period dates for quarterly statement
   */
  static getQuarterlyPeriod(year: number, quarter: number): { start: Date; end: Date } {
    const startMonth = (quarter - 1) * 3;
    return {
      start: new Date(year, startMonth, 1),
      end: new Date(year, startMonth + 3, 0, 23, 59, 59, 999)
    };
  }

  /**
   * Get period dates for annual statement
   */
  static getAnnualPeriod(year: number): { start: Date; end: Date } {
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59, 999)
    };
  }
}
