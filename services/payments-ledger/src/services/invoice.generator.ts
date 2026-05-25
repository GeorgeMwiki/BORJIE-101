/**
 * Invoice Generator Service
 * 
 * Generates professional PDF invoices with:
 * - Line items with quantity and unit pricing
 * - Tax calculations and breakdowns
 * - Payment tracking
 * - Unique reference numbers
 * 
 * Note: This service generates invoice data structures.
 * Actual PDF rendering is delegated to a PDF renderer (e.g., puppeteer, PDFKit).
 */
import { v4 as uuidv4 } from 'uuid';
import { CurrencyCode } from '@borjie/domain-models';
import {
  Invoice,
  InvoiceId,
  InvoiceLineItem,
  InvoiceStatus,
  InvoiceType,
  TaxBreakdown,
  CreateInvoiceRequest,
  MoneyData,
  TenantId,
  CustomerId,
  PropertyId,
  UnitId,
  LeaseId,
  moneyFromMinorUnits,
  zeroMoney,
  formatMoney,
  addMoney,
} from '../types';

/**
 * Invoice numbering format configuration
 */
export interface InvoiceNumberConfig {
  prefix: string;
  separator: string;
  includeYear: boolean;
  includeMonth: boolean;
  padLength: number;
}

const DEFAULT_NUMBER_CONFIG: InvoiceNumberConfig = {
  prefix: 'INV',
  separator: '-',
  includeYear: true,
  includeMonth: true,
  padLength: 6,
};

/**
 * Invoice generator dependencies
 */
export interface InvoiceGeneratorDeps {
  getNextInvoiceNumber: (tenantId: TenantId) => Promise<number>;
  saveInvoice: (invoice: Invoice) => Promise<Invoice>;
  getInvoice: (invoiceId: InvoiceId, tenantId: TenantId) => Promise<Invoice | null>;
  updateInvoice: (invoice: Invoice) => Promise<Invoice>;
  logger: {
    info: (message: string, context?: Record<string, unknown>) => void;
    error: (message: string, context?: Record<string, unknown>) => void;
  };
}

/**
 * PDF generation options
 */
export interface PdfGenerationOptions {
  includeHeader: boolean;
  includeLogo: boolean;
  logoUrl?: string;
  companyName: string;
  companyAddress: string;
  companyEmail?: string;
  companyPhone?: string;
  footerText?: string;
  showPaymentInstructions: boolean;
  paymentInstructions?: string;
}

/**
 * Invoice PDF data structure for rendering
 */
export interface InvoicePdfData {
  invoice: Invoice;
  options: PdfGenerationOptions;
  formattedAmounts: {
    subtotal: string;
    totalTax: string;
    totalAmount: string;
    amountPaid: string;
    amountDue: string;
    lineItems: Array<{
      unitPrice: string;
      amount: string;
      taxAmount: string;
      totalAmount: string;
    }>;
  };
  qrCodeData?: string;
}

/**
 * Invoice Generator Service
 */
export class InvoiceGenerator {
  private deps: InvoiceGeneratorDeps;
  private numberConfig: InvoiceNumberConfig;

  constructor(deps: InvoiceGeneratorDeps, numberConfig?: Partial<InvoiceNumberConfig>) {
    this.deps = deps;
    this.numberConfig = { ...DEFAULT_NUMBER_CONFIG, ...numberConfig };
  }

  /**
   * Generate a new invoice
   */
  async generateInvoice(request: CreateInvoiceRequest): Promise<Invoice> {
    const invoiceId = `inv_${uuidv4()}` as InvoiceId;
    const now = new Date();

    // Generate invoice number
    const sequenceNumber = await this.deps.getNextInvoiceNumber(request.tenantId);
    const invoiceNumber = this.formatInvoiceNumber(sequenceNumber, request.issueDate || now);

    // Calculate line items with amounts
    const lineItems = this.calculateLineItems(request.lineItems, request.currency);

    // Calculate totals
    const { subtotal, taxBreakdown, totalTax, totalAmount } = this.calculateTotals(
      lineItems,
      request.currency
    );

    const invoice: Invoice = {
      id: invoiceId,
      tenantId: request.tenantId,
      invoiceNumber,
      type: request.type,
      status: 'DRAFT',
      customerId: request.customerId,
      customerName: request.customerName,
      customerEmail: request.customerEmail,
      customerAddress: request.customerAddress,
      propertyId: request.propertyId,
      propertyName: request.propertyName,
      unitId: request.unitId,
      unitName: request.unitName,
      leaseId: request.leaseId,
      currency: request.currency,
      issueDate: request.issueDate || now,
      dueDate: request.dueDate,
      lineItems,
      subtotal,
      taxBreakdown,
      totalTax,
      totalAmount,
      amountPaid: zeroMoney(request.currency),
      amountDue: totalAmount,
      payments: [],
      notes: request.notes,
      terms: request.terms,
      reference: request.reference,
      metadata: request.metadata,
      createdAt: now,
      createdBy: request.createdBy,
      updatedAt: now,
      updatedBy: request.createdBy,
    };

    const savedInvoice = await this.deps.saveInvoice(invoice);

    this.deps.logger.info('Invoice generated', {
      invoiceId: savedInvoice.id,
      invoiceNumber: savedInvoice.invoiceNumber,
      tenantId: savedInvoice.tenantId,
      customerId: savedInvoice.customerId,
      totalAmount: formatMoney(savedInvoice.totalAmount),
    });

    return savedInvoice;
  }

  /**
   * Issue an invoice (change from DRAFT to ISSUED)
   */
  async issueInvoice(invoiceId: InvoiceId, tenantId: TenantId): Promise<Invoice> {
    const invoice = await this.deps.getInvoice(invoiceId, tenantId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status !== 'DRAFT') {
      throw new Error(`Invoice ${invoiceId} is not in DRAFT status`);
    }

    const updatedInvoice: Invoice = {
      ...invoice,
      status: 'ISSUED',
      updatedAt: new Date(),
    };

    return this.deps.updateInvoice(updatedInvoice);
  }

  /**
   * Mark invoice as sent
   */
  async markAsSent(invoiceId: InvoiceId, tenantId: TenantId, recipientEmail: string): Promise<Invoice> {
    const invoice = await this.deps.getInvoice(invoiceId, tenantId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status === 'DRAFT') {
      throw new Error(`Invoice ${invoiceId} must be issued before sending`);
    }

    const updatedInvoice: Invoice = {
      ...invoice,
      status: 'SENT',
      sentAt: new Date(),
      updatedAt: new Date(),
    };

    return this.deps.updateInvoice(updatedInvoice);
  }

  /**
   * Record a payment against an invoice
   */
  async recordPayment(
    invoiceId: InvoiceId,
    tenantId: TenantId,
    amount: MoneyData,
    method: string,
    reference?: string,
    paymentIntentId?: string
  ): Promise<Invoice> {
    const invoice = await this.deps.getInvoice(invoiceId, tenantId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status === 'DRAFT' || invoice.status === 'CANCELLED' || invoice.status === 'VOIDED') {
      throw new Error(`Cannot record payment for invoice in ${invoice.status} status`);
    }

    if (amount.currency !== invoice.currency) {
      throw new Error(`Payment currency ${amount.currency} does not match invoice currency ${invoice.currency}`);
    }

    const payment = {
      id: uuidv4(),
      amount,
      paidAt: new Date(),
      method,
      reference,
      paymentIntentId,
    };

    const newAmountPaid = addMoney(invoice.amountPaid, amount);
    const newAmountDue = moneyFromMinorUnits(
      invoice.totalAmount.amountMinorUnits - newAmountPaid.amountMinorUnits,
      invoice.currency
    );

    let newStatus: InvoiceStatus = invoice.status;
    if (newAmountDue.amountMinorUnits <= 0) {
      newStatus = 'PAID';
    } else if (newAmountPaid.amountMinorUnits > 0) {
      newStatus = 'PARTIALLY_PAID';
    }

    const updatedInvoice: Invoice = {
      ...invoice,
      status: newStatus,
      amountPaid: newAmountPaid,
      amountDue: newAmountDue.amountMinorUnits < 0 ? zeroMoney(invoice.currency) : newAmountDue,
      payments: [...invoice.payments, payment],
      paidAt: newStatus === 'PAID' ? new Date() : invoice.paidAt,
      updatedAt: new Date(),
    };

    const saved = await this.deps.updateInvoice(updatedInvoice);

    this.deps.logger.info('Payment recorded', {
      invoiceId,
      paymentAmount: formatMoney(amount),
      newStatus: saved.status,
      amountDue: formatMoney(saved.amountDue),
    });

    return saved;
  }

  /**
   * Void an invoice (cannot be undone)
   */
  async voidInvoice(
    invoiceId: InvoiceId,
    tenantId: TenantId,
    reason: string
  ): Promise<Invoice> {
    const invoice = await this.deps.getInvoice(invoiceId, tenantId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status === 'PAID' || invoice.status === 'VOIDED') {
      throw new Error(`Cannot void invoice in ${invoice.status} status`);
    }

    if (invoice.amountPaid.amountMinorUnits > 0) {
      throw new Error('Cannot void invoice with payments recorded. Process refunds first.');
    }

    const updatedInvoice: Invoice = {
      ...invoice,
      status: 'VOIDED',
      voidedAt: new Date(),
      voidReason: reason,
      updatedAt: new Date(),
    };

    return this.deps.updateInvoice(updatedInvoice);
  }

  /**
   * Generate PDF data for an invoice
   */
  generatePdfData(invoice: Invoice, options: PdfGenerationOptions): InvoicePdfData {
    return {
      invoice,
      options,
      formattedAmounts: {
        subtotal: formatMoney(invoice.subtotal),
        totalTax: formatMoney(invoice.totalTax),
        totalAmount: formatMoney(invoice.totalAmount),
        amountPaid: formatMoney(invoice.amountPaid),
        amountDue: formatMoney(invoice.amountDue),
        lineItems: invoice.lineItems.map(item => ({
          unitPrice: formatMoney(item.unitPrice),
          amount: formatMoney(item.amount),
          taxAmount: item.taxAmount ? formatMoney(item.taxAmount) : '-',
          totalAmount: formatMoney(item.totalAmount),
        })),
      },
      qrCodeData: this.generatePaymentQrData(invoice),
    };
  }

  /**
   * Generate HTML template for invoice PDF
   */
  generateHtmlTemplate(pdfData: InvoicePdfData): string {
    const { invoice, options, formattedAmounts } = pdfData;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Invoice ${invoice.invoiceNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 12px; color: #333; }
    .invoice { max-width: 800px; margin: 0 auto; padding: 40px; }
    .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .company-info { text-align: left; }
    .company-name { font-size: 24px; font-weight: bold; color: #2563eb; margin-bottom: 8px; }
    .invoice-title { text-align: right; }
    .invoice-title h1 { font-size: 32px; color: #1f2937; margin-bottom: 8px; }
    .invoice-number { font-size: 14px; color: #6b7280; }
    .invoice-status { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: 600; text-transform: uppercase; font-size: 11px; margin-top: 8px; }
    .status-paid { background: #d1fae5; color: #059669; }
    .status-issued { background: #dbeafe; color: #2563eb; }
    .status-overdue { background: #fee2e2; color: #dc2626; }
    .status-draft { background: #f3f4f6; color: #6b7280; }
    .parties { display: flex; justify-content: space-between; margin-bottom: 40px; }
    .party { width: 45%; }
    .party-label { font-size: 10px; text-transform: uppercase; color: #9ca3af; margin-bottom: 8px; letter-spacing: 0.5px; }
    .party-name { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
    .dates { display: flex; gap: 40px; margin-bottom: 40px; }
    .date-item { }
    .date-label { font-size: 10px; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; }
    .date-value { font-weight: 600; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #f9fafb; padding: 12px; text-align: left; font-size: 10px; text-transform: uppercase; color: #6b7280; border-bottom: 2px solid #e5e7eb; }
    td { padding: 12px; border-bottom: 1px solid #e5e7eb; }
    .text-right { text-align: right; }
    .totals { margin-left: auto; width: 300px; }
    .totals-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .totals-row.total { font-size: 16px; font-weight: bold; border-bottom: none; border-top: 2px solid #1f2937; padding-top: 12px; }
    .amount-due { background: #f9fafb; padding: 16px; border-radius: 8px; margin-top: 20px; }
    .amount-due-label { font-size: 12px; color: #6b7280; margin-bottom: 4px; }
    .amount-due-value { font-size: 24px; font-weight: bold; color: #2563eb; }
    .notes { margin-top: 40px; padding: 20px; background: #f9fafb; border-radius: 8px; }
    .notes-title { font-weight: 600; margin-bottom: 8px; }
    .footer { margin-top: 40px; text-align: center; color: #9ca3af; font-size: 10px; }
    .payment-info { margin-top: 30px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; }
    .payment-info-title { font-weight: 600; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="invoice">
    <div class="header">
      <div class="company-info">
        ${options.includeLogo && options.logoUrl ? `<img src="${options.logoUrl}" alt="Logo" style="height: 50px; margin-bottom: 12px;">` : ''}
        <div class="company-name">${options.companyName}</div>
        <div>${options.companyAddress}</div>
        ${options.companyEmail ? `<div>${options.companyEmail}</div>` : ''}
        ${options.companyPhone ? `<div>${options.companyPhone}</div>` : ''}
      </div>
      <div class="invoice-title">
        <h1>INVOICE</h1>
        <div class="invoice-number">${invoice.invoiceNumber}</div>
        <span class="invoice-status status-${invoice.status.toLowerCase()}">${invoice.status}</span>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <div class="party-label">Bill To</div>
        <div class="party-name">${invoice.customerName}</div>
        ${invoice.customerAddress ? `<div>${invoice.customerAddress}</div>` : ''}
        ${invoice.customerEmail ? `<div>${invoice.customerEmail}</div>` : ''}
      </div>
      ${invoice.propertyName ? `
      <div class="party">
        <div class="party-label">Property</div>
        <div class="party-name">${invoice.propertyName}</div>
        ${invoice.unitName ? `<div>Unit: ${invoice.unitName}</div>` : ''}
      </div>
      ` : ''}
    </div>

    <div class="dates">
      <div class="date-item">
        <div class="date-label">Issue Date</div>
        <div class="date-value">${this.formatDate(invoice.issueDate)}</div>
      </div>
      <div class="date-item">
        <div class="date-label">Due Date</div>
        <div class="date-value">${this.formatDate(invoice.dueDate)}</div>
      </div>
      ${invoice.reference ? `
      <div class="date-item">
        <div class="date-label">Reference</div>
        <div class="date-value">${invoice.reference}</div>
      </div>
      ` : ''}
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Unit Price</th>
          <th class="text-right">Tax</th>
          <th class="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${invoice.lineItems.map((item, index) => `
        <tr>
          <td>${item.description}</td>
          <td class="text-right">${item.quantity}</td>
          <td class="text-right">${formattedAmounts.lineItems[index].unitPrice}</td>
          <td class="text-right">${item.taxRate ? `${item.taxRate}%` : '-'}</td>
          <td class="text-right">${formattedAmounts.lineItems[index].totalAmount}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>${formattedAmounts.subtotal}</span>
      </div>
      ${invoice.taxBreakdown.map(tax => `
      <div class="totals-row">
        <span>${tax.taxName} (${tax.taxRate}%)</span>
        <span>${formatMoney(tax.taxAmount)}</span>
      </div>
      `).join('')}
      <div class="totals-row total">
        <span>Total</span>
        <span>${formattedAmounts.totalAmount}</span>
      </div>
      ${invoice.amountPaid.amountMinorUnits > 0 ? `
      <div class="totals-row">
        <span>Paid</span>
        <span>- ${formattedAmounts.amountPaid}</span>
      </div>
      ` : ''}
      <div class="amount-due">
        <div class="amount-due-label">Amount Due</div>
        <div class="amount-due-value">${formattedAmounts.amountDue}</div>
      </div>
    </div>

    ${options.showPaymentInstructions && options.paymentInstructions ? `
    <div class="payment-info">
      <div class="payment-info-title">Payment Instructions</div>
      <div>${options.paymentInstructions}</div>
    </div>
    ` : ''}

    ${invoice.notes ? `
    <div class="notes">
      <div class="notes-title">Notes</div>
      <div>${invoice.notes}</div>
    </div>
    ` : ''}

    ${invoice.terms ? `
    <div class="notes">
      <div class="notes-title">Terms & Conditions</div>
      <div>${invoice.terms}</div>
    </div>
    ` : ''}

    ${options.footerText ? `
    <div class="footer">${options.footerText}</div>
    ` : ''}
  </div>
</body>
</html>`;
  }

  /**
   * Check for overdue invoices and update status
   */
  async checkAndMarkOverdue(invoice: Invoice): Promise<Invoice | null> {
    const now = new Date();
    if (
      invoice.status === 'ISSUED' || 
      invoice.status === 'SENT' || 
      invoice.status === 'PARTIALLY_PAID'
    ) {
      if (now > invoice.dueDate && invoice.amountDue.amountMinorUnits > 0) {
        const updatedInvoice: Invoice = {
          ...invoice,
          status: 'OVERDUE',
          updatedAt: now,
        };
        return this.deps.updateInvoice(updatedInvoice);
      }
    }
    return null;
  }

  /**
   * Create rent invoice from lease details
   */
  async createRentInvoice(params: {
    tenantId: TenantId;
    customerId: CustomerId;
    customerName: string;
    customerEmail?: string;
    propertyId?: PropertyId;
    propertyName?: string;
    unitId?: UnitId;
    unitName?: string;
    leaseId?: LeaseId;
    rentAmount: MoneyData;
    dueDate: Date;
    billingPeriod: { start: Date; end: Date };
    lateFee?: MoneyData;
    taxRate?: number;
    createdBy: string;
  }): Promise<Invoice> {
    const lineItems: CreateInvoiceRequest['lineItems'] = [
      {
        description: `Rent for ${this.formatDate(params.billingPeriod.start)} - ${this.formatDate(params.billingPeriod.end)}`,
        quantity: 1,
        unitPrice: params.rentAmount,
        taxRate: params.taxRate,
        propertyId: params.propertyId,
        unitId: params.unitId,
        leaseId: params.leaseId,
      },
    ];

    if (params.lateFee && params.lateFee.amountMinorUnits > 0) {
      lineItems.push({
        description: 'Late Payment Fee',
        quantity: 1,
        unitPrice: params.lateFee,
      });
    }

    return this.generateInvoice({
      tenantId: params.tenantId,
      type: 'RENT',
      customerId: params.customerId,
      customerName: params.customerName,
      customerEmail: params.customerEmail,
      propertyId: params.propertyId,
      propertyName: params.propertyName,
      unitId: params.unitId,
      unitName: params.unitName,
      leaseId: params.leaseId,
      currency: params.rentAmount.currency,
      dueDate: params.dueDate,
      lineItems,
      createdBy: params.createdBy,
    });
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private formatInvoiceNumber(sequenceNumber: number, date: Date): string {
    const parts: string[] = [this.numberConfig.prefix];
    
    if (this.numberConfig.includeYear) {
      parts.push(date.getFullYear().toString());
    }
    
    if (this.numberConfig.includeMonth) {
      parts.push((date.getMonth() + 1).toString().padStart(2, '0'));
    }
    
    parts.push(sequenceNumber.toString().padStart(this.numberConfig.padLength, '0'));
    
    return parts.join(this.numberConfig.separator);
  }

  private calculateLineItems(
    items: CreateInvoiceRequest['lineItems'],
    currency: CurrencyCode
  ): InvoiceLineItem[] {
    return items.map((item, index) => {
      const amount: MoneyData = {
        amountMinorUnits: item.unitPrice.amountMinorUnits * item.quantity,
        currency,
      };

      let taxAmount: MoneyData | undefined;
      if (item.taxRate && item.taxRate > 0) {
        taxAmount = {
          amountMinorUnits: Math.round(amount.amountMinorUnits * item.taxRate / 100),
          currency,
        };
      }

      const totalAmount: MoneyData = {
        amountMinorUnits: amount.amountMinorUnits + (taxAmount?.amountMinorUnits || 0),
        currency,
      };

      return {
        id: `li_${index + 1}`,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount,
        taxRate: item.taxRate,
        taxAmount,
        totalAmount,
        propertyId: item.propertyId,
        unitId: item.unitId,
        leaseId: item.leaseId,
        metadata: item.metadata,
      };
    });
  }

  private calculateTotals(
    lineItems: InvoiceLineItem[],
    currency: CurrencyCode
  ): {
    subtotal: MoneyData;
    taxBreakdown: TaxBreakdown[];
    totalTax: MoneyData;
    totalAmount: MoneyData;
  } {
    let subtotalMinor = 0;
    const taxByRate: Map<number, { taxable: number; tax: number }> = new Map();

    for (const item of lineItems) {
      subtotalMinor += item.amount.amountMinorUnits;

      if (item.taxRate && item.taxAmount) {
        const existing = taxByRate.get(item.taxRate) || { taxable: 0, tax: 0 };
        existing.taxable += item.amount.amountMinorUnits;
        existing.tax += item.taxAmount.amountMinorUnits;
        taxByRate.set(item.taxRate, existing);
      }
    }

    const taxBreakdown: TaxBreakdown[] = Array.from(taxByRate.entries()).map(([rate, totals]) => ({
      taxName: `VAT`,
      taxRate: rate,
      taxableAmount: { amountMinorUnits: totals.taxable, currency },
      taxAmount: { amountMinorUnits: totals.tax, currency },
    }));

    const totalTaxMinor = taxBreakdown.reduce((sum, t) => sum + t.taxAmount.amountMinorUnits, 0);

    return {
      subtotal: { amountMinorUnits: subtotalMinor, currency },
      taxBreakdown,
      totalTax: { amountMinorUnits: totalTaxMinor, currency },
      totalAmount: { amountMinorUnits: subtotalMinor + totalTaxMinor, currency },
    };
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  private generatePaymentQrData(invoice: Invoice): string {
    // Emit the amount in MINOR UNITS — never divide by a hard-coded 100.
    // Different ISO-4217 currencies have different exponents (UGX/TZS=0,
    // KES/USD/EUR/GBP=2, TND/JOD/KWD=3). The QR scanner on the payer side
    // is responsible for rendering the amount in major units using the
    // currency's published exponent. Dividing here would silently
    // produce wrong totals for zero-decimal currencies like UGX.
    return JSON.stringify({
      invoiceNumber: invoice.invoiceNumber,
      amountMinorUnits: invoice.amountDue.amountMinorUnits,
      currency: invoice.currency,
      reference: invoice.reference || invoice.invoiceNumber,
    });
  }
}

/**
 * Factory function to create an InvoiceGenerator with default config
 */
export function createInvoiceGenerator(
  deps: InvoiceGeneratorDeps,
  numberConfig?: Partial<InvoiceNumberConfig>
): InvoiceGenerator {
  return new InvoiceGenerator(deps, numberConfig);
}
