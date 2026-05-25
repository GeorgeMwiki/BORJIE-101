/**
 * Statement domain model
 * Represents financial statements for owners and customers
 */
import { z } from 'zod';
import {
  TenantId,
  StatementId,
  AccountId,
  OwnerId,
  CustomerId,
  PropertyId,
  StatementPeriodType,
  StatementPeriodTypeSchema,
  StatementStatus,
  StatementStatusSchema,
  LedgerEntryType,
  TenantScopedEntity,
  CurrencyCodeSchema,
  CurrencyCode
} from '../common/types';
import { Money, MoneySchema } from '../common/money';

export const StatementTypeSchema = z.enum([
  'OWNER_STATEMENT',        // Monthly owner statement
  'CUSTOMER_STATEMENT',     // Customer account statement
  'PROPERTY_STATEMENT',     // Property-level financial summary
  'RECONCILIATION_REPORT'   // Bank reconciliation report
]);
export type StatementType = z.infer<typeof StatementTypeSchema>;

/**
 * Line item in a statement
 */
export const StatementLineItemSchema = z.object({
  date: z.date(),
  type: z.string(),
  description: z.string(),
  reference: z.string().optional(),
  debit: MoneySchema.optional(),
  credit: MoneySchema.optional(),
  balance: MoneySchema,
  propertyId: z.string().optional(),
  unitId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type StatementLineItemData = z.infer<typeof StatementLineItemSchema>;

export interface StatementLineItem extends Omit<StatementLineItemData, 'debit' | 'credit' | 'balance'> {
  debit?: Money;
  credit?: Money;
  balance: Money;
  propertyId?: PropertyId;
}

/**
 * Summary section in a statement
 */
export const StatementSummarySchema = z.object({
  label: z.string(),
  amount: MoneySchema,
  percentage: z.number().optional(),
  breakdown: z.array(z.object({
    label: z.string(),
    amount: MoneySchema
  })).optional()
});

export type StatementSummaryData = z.infer<typeof StatementSummarySchema>;

export interface StatementSummary {
  label: string;
  amount: Money;
  percentage?: number;
  breakdown?: Array<{ label: string; amount: Money }>;
}

/**
 * Main statement schema
 */
export const StatementSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  type: StatementTypeSchema,
  status: StatementStatusSchema,
  
  // Period
  periodType: StatementPeriodTypeSchema,
  periodStart: z.date(),
  periodEnd: z.date(),
  generatedAt: z.date(),
  
  // Associated entity (owner or customer)
  ownerId: z.string().optional(),
  customerId: z.string().optional(),
  propertyId: z.string().optional(),
  accountId: z.string().optional(),
  
  // Currency
  currency: CurrencyCodeSchema,
  
  // Balances
  openingBalance: MoneySchema,
  closingBalance: MoneySchema,
  totalDebits: MoneySchema,
  totalCredits: MoneySchema,
  netChange: MoneySchema,
  
  // Content
  lineItems: z.array(StatementLineItemSchema),
  summaries: z.array(StatementSummarySchema),
  
  // Delivery
  sentAt: z.date().optional(),
  viewedAt: z.date().optional(),
  recipientEmail: z.string().email().optional(),
  
  // Document storage
  documentUrl: z.string().url().optional(),
  documentFormat: z.enum(['PDF', 'HTML', 'CSV']).optional(),
  
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type StatementData = z.infer<typeof StatementSchema>;

export interface Statement extends Omit<StatementData, 
  'openingBalance' | 'closingBalance' | 'totalDebits' | 'totalCredits' | 'netChange' | 'lineItems' | 'summaries'
>, TenantScopedEntity {
  id: StatementId;
  tenantId: TenantId;
  ownerId?: OwnerId;
  customerId?: CustomerId;
  propertyId?: PropertyId;
  accountId?: AccountId;
  openingBalance: Money;
  closingBalance: Money;
  totalDebits: Money;
  totalCredits: Money;
  netChange: Money;
  lineItems: StatementLineItem[];
  summaries: StatementSummary[];
}

/**
 * Statement aggregate with business logic
 */
export class StatementAggregate {
  private data: Statement;

  constructor(data: Statement) {
    this.data = { ...data };
  }

  get id(): StatementId {
    return this.data.id;
  }

  get tenantId(): TenantId {
    return this.data.tenantId;
  }

  get status(): StatementStatus {
    return this.data.status;
  }

  get type(): StatementType {
    return this.data.type;
  }

  get periodStart(): Date {
    return this.data.periodStart;
  }

  get periodEnd(): Date {
    return this.data.periodEnd;
  }

  get openingBalance(): Money {
    return this.data.openingBalance;
  }

  get closingBalance(): Money {
    return this.data.closingBalance;
  }

  get netChange(): Money {
    return this.data.netChange;
  }

  get lineItems(): StatementLineItem[] {
    return [...this.data.lineItems];
  }

  get summaries(): StatementSummary[] {
    return [...this.data.summaries];
  }

  /**
   * Mark statement as generated
   */
  markGenerated(documentUrl?: string, documentFormat?: 'PDF' | 'HTML' | 'CSV'): void {
    if (this.data.status !== 'DRAFT') {
      throw new Error('Statement must be in DRAFT status to mark as generated');
    }
    this.data.status = 'GENERATED';
    if (documentUrl) {
      this.data.documentUrl = documentUrl;
      this.data.documentFormat = documentFormat;
    }
    this.data.updatedAt = new Date();
  }

  /**
   * Mark statement as sent
   */
  markSent(recipientEmail: string): void {
    if (this.data.status !== 'GENERATED') {
      throw new Error('Statement must be in GENERATED status to mark as sent');
    }
    this.data.status = 'SENT';
    this.data.sentAt = new Date();
    this.data.recipientEmail = recipientEmail;
    this.data.updatedAt = new Date();
  }

  /**
   * Mark statement as viewed
   */
  markViewed(): void {
    if (this.data.status === 'DRAFT') {
      throw new Error('Draft statements cannot be viewed');
    }
    if (!this.data.viewedAt) {
      this.data.viewedAt = new Date();
      this.data.status = 'VIEWED';
      this.data.updatedAt = new Date();
    }
  }

  /**
   * Get summary by label
   */
  getSummary(label: string): StatementSummary | undefined {
    return this.data.summaries.find(s => s.label === label);
  }

  /**
   * Get line items by type
   */
  getLineItemsByType(type: string): StatementLineItem[] {
    return this.data.lineItems.filter(item => item.type === type);
  }

  /**
   * Get line items for a specific property
   */
  getLineItemsByProperty(propertyId: PropertyId): StatementLineItem[] {
    return this.data.lineItems.filter(item => item.propertyId === propertyId);
  }

  /**
   * Calculate totals by entry type
   */
  getTotalsByType(): Map<string, { debits: Money; credits: Money }> {
    const totals = new Map<string, { debits: Money; credits: Money }>();
    
    for (const item of this.data.lineItems) {
      if (!totals.has(item.type)) {
        totals.set(item.type, {
          debits: Money.zero(this.data.currency),
          credits: Money.zero(this.data.currency)
        });
      }
      const current = totals.get(item.type)!;
      if (item.debit) {
        current.debits = current.debits.add(item.debit);
      }
      if (item.credit) {
        current.credits = current.credits.add(item.credit);
      }
    }
    
    return totals;
  }

  toData(): Statement {
    return { ...this.data };
  }
}

/**
 * Statement builder for constructing statements
 */
export class StatementBuilder {
  private data: Partial<Statement>;
  private lineItems: StatementLineItem[] = [];
  private summaries: StatementSummary[] = [];
  private runningBalance: Money;

  constructor(
    id: StatementId,
    tenantId: TenantId,
    type: StatementType,
    currency: CurrencyCode,
    openingBalance: Money
  ) {
    this.data = {
      id,
      tenantId,
      type,
      status: 'DRAFT',
      currency,
      openingBalance,
      generatedAt: new Date()
    };
    this.runningBalance = openingBalance;
  }

  setPeriod(periodType: StatementPeriodType, start: Date, end: Date): this {
    this.data.periodType = periodType;
    this.data.periodStart = start;
    this.data.periodEnd = end;
    return this;
  }

  setOwner(ownerId: OwnerId): this {
    this.data.ownerId = ownerId;
    return this;
  }

  setCustomer(customerId: CustomerId): this {
    this.data.customerId = customerId;
    return this;
  }

  setProperty(propertyId: PropertyId): this {
    this.data.propertyId = propertyId;
    return this;
  }

  setAccount(accountId: AccountId): this {
    this.data.accountId = accountId;
    return this;
  }

  addLineItem(
    date: Date,
    type: string,
    description: string,
    options: {
      debit?: Money;
      credit?: Money;
      reference?: string;
      propertyId?: PropertyId;
      unitId?: string;
      metadata?: Record<string, unknown>;
    }
  ): this {
    // Update running balance
    if (options.debit) {
      this.runningBalance = this.runningBalance.add(options.debit);
    }
    if (options.credit) {
      this.runningBalance = this.runningBalance.subtract(options.credit);
    }

    this.lineItems.push({
      date,
      type,
      description,
      reference: options.reference,
      debit: options.debit,
      credit: options.credit,
      balance: this.runningBalance,
      propertyId: options.propertyId,
      unitId: options.unitId,
      metadata: options.metadata
    });

    return this;
  }

  addSummary(
    label: string,
    amount: Money,
    options?: {
      percentage?: number;
      breakdown?: Array<{ label: string; amount: Money }>;
    }
  ): this {
    this.summaries.push({
      label,
      amount,
      percentage: options?.percentage,
      breakdown: options?.breakdown
    });
    return this;
  }

  build(createdBy: string): Statement {
    const now = new Date();
    
    // Calculate totals
    let totalDebits = Money.zero(this.data.currency!);
    let totalCredits = Money.zero(this.data.currency!);
    
    for (const item of this.lineItems) {
      if (item.debit) {
        totalDebits = totalDebits.add(item.debit);
      }
      if (item.credit) {
        totalCredits = totalCredits.add(item.credit);
      }
    }

    const netChange = totalDebits.subtract(totalCredits);
    const closingBalance = this.data.openingBalance!.add(netChange);

    return {
      ...this.data,
      closingBalance,
      totalDebits,
      totalCredits,
      netChange,
      lineItems: this.lineItems,
      summaries: this.summaries,
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: createdBy
    } as Statement;
  }
}
