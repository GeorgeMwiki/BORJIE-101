/**
 * Pre-shipped Zod schemas for the most common forms we see in
 * property management workflows. Each schema is paired with a
 * `keywords` array that the extractor uses for term-matching when no
 * brain is available, and that the brain uses to label fields in its
 * structured output.
 */

import { z } from 'zod';

export interface NamedSchema<S extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly id: string;
  readonly schema: S;
  /** Field-by-field keyword hints to drive heuristic extraction. */
  readonly keywords: Readonly<Record<string, ReadonlyArray<string>>>;
  /** Human-readable label. */
  readonly label: string;
}

// ─────────────────────────────────────────────────────────────────────
// Lease Agreement
// ─────────────────────────────────────────────────────────────────────

export const leaseAgreementSchema: NamedSchema = {
  id: 'lease_agreement',
  label: 'Lease Agreement',
  schema: z.object({
    landlord_name: z.string().optional(),
    tenant_name: z.string().optional(),
    property_address: z.string().optional(),
    monthly_rent: z.string().optional(),
    deposit_amount: z.string().optional(),
    term_months: z.number().int().positive().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    currency: z.string().optional(),
  }),
  keywords: Object.freeze({
    landlord_name: ['landlord:', 'lessor:', 'mwenye nyumba:'],
    tenant_name: ['tenant:', 'lessee:', 'mpangaji:'],
    property_address: ['property:', 'premises:', 'address:'],
    monthly_rent: ['monthly rent:', 'rent:', 'kodi:'],
    deposit_amount: ['deposit:', 'security deposit:', 'amana:'],
    term_months: ['term:', 'duration:', 'muda:'],
    start_date: ['start date:', 'commencement:', 'tarehe ya kuanza:'],
    end_date: ['end date:', 'expiry:', 'tarehe ya kumalizika:'],
    currency: ['currency:', 'tzs', 'kes', 'ugx', 'usd'],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// Bank Statement
// ─────────────────────────────────────────────────────────────────────

export const bankStatementSchema: NamedSchema = {
  id: 'bank_statement',
  label: 'Bank Statement',
  schema: z.object({
    account_holder: z.string().optional(),
    account_number: z.string().optional(),
    bank_name: z.string().optional(),
    statement_period: z.string().optional(),
    opening_balance: z.string().optional(),
    closing_balance: z.string().optional(),
    total_credits: z.string().optional(),
    total_debits: z.string().optional(),
    currency: z.string().optional(),
  }),
  keywords: Object.freeze({
    account_holder: ['account name:', 'holder:', 'name:'],
    account_number: ['account number:', 'a/c no:', 'acct:'],
    bank_name: ['bank:', 'institution:'],
    statement_period: ['period:', 'from:', 'statement period:'],
    opening_balance: ['opening balance:', 'b/f:', 'brought forward:'],
    closing_balance: ['closing balance:', 'c/f:', 'closing:'],
    total_credits: ['total credits:', 'credits:', 'deposits:'],
    total_debits: ['total debits:', 'debits:', 'withdrawals:'],
    currency: ['currency:', 'tzs', 'kes', 'ugx', 'usd'],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// ID Card
// ─────────────────────────────────────────────────────────────────────

export const idCardSchema: NamedSchema = {
  id: 'id_card',
  label: 'National ID / Passport',
  schema: z.object({
    full_name: z.string().optional(),
    id_number: z.string().optional(),
    date_of_birth: z.string().optional(),
    nationality: z.string().optional(),
    sex: z.enum(['M', 'F', 'X']).optional(),
    issued_date: z.string().optional(),
    expiry_date: z.string().optional(),
    place_of_issue: z.string().optional(),
    document_type: z.enum(['national_id', 'passport', 'driving_license']).optional(),
  }),
  keywords: Object.freeze({
    full_name: ['name:', 'full name:', 'jina:'],
    id_number: ['id no:', 'id number:', 'passport no:', 'nambari ya kitambulisho:'],
    date_of_birth: ['date of birth:', 'dob:', 'tarehe ya kuzaliwa:'],
    nationality: ['nationality:', 'utaifa:'],
    sex: ['sex:', 'gender:', 'jinsia:'],
    issued_date: ['issued:', 'date of issue:'],
    expiry_date: ['expires:', 'expiry:'],
    place_of_issue: ['place of issue:', 'issued at:'],
    document_type: ['national id', 'passport', 'driving license'],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// Receipt
// ─────────────────────────────────────────────────────────────────────

export const receiptSchema: NamedSchema = {
  id: 'receipt',
  label: 'Receipt',
  schema: z.object({
    vendor: z.string().optional(),
    receipt_number: z.string().optional(),
    date: z.string().optional(),
    subtotal: z.string().optional(),
    tax_amount: z.string().optional(),
    total: z.string().optional(),
    payment_method: z.string().optional(),
    currency: z.string().optional(),
    items: z
      .array(z.object({ description: z.string(), amount: z.string() }))
      .optional(),
  }),
  keywords: Object.freeze({
    vendor: ['vendor:', 'merchant:', 'from:'],
    receipt_number: ['receipt no:', 'ref:', 'transaction id:'],
    date: ['date:', 'tarehe:'],
    subtotal: ['subtotal:', 'sub-total:'],
    tax_amount: ['tax:', 'vat:', 'kodi:'],
    total: ['total:', 'amount:', 'grand total:', 'jumla:'],
    payment_method: ['payment method:', 'paid by:', 'method:'],
    currency: ['currency:', 'tzs', 'kes', 'ugx', 'usd'],
    items: ['items', 'description', 'amount'],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// Invoice
// ─────────────────────────────────────────────────────────────────────

export const invoiceSchema: NamedSchema = {
  id: 'invoice',
  label: 'Invoice',
  schema: z.object({
    invoice_number: z.string().optional(),
    issue_date: z.string().optional(),
    due_date: z.string().optional(),
    bill_to: z.string().optional(),
    bill_from: z.string().optional(),
    subtotal: z.string().optional(),
    tax_amount: z.string().optional(),
    total: z.string().optional(),
    currency: z.string().optional(),
    line_items: z
      .array(
        z.object({
          description: z.string(),
          quantity: z.number().optional(),
          unit_price: z.string().optional(),
          amount: z.string(),
        })
      )
      .optional(),
  }),
  keywords: Object.freeze({
    invoice_number: ['invoice no:', 'invoice number:', 'ankara:'],
    issue_date: ['issue date:', 'date:', 'tarehe ya ankara:'],
    due_date: ['due date:', 'payment due:', 'tarehe ya malipo:'],
    bill_to: ['bill to:', 'customer:', 'to:'],
    bill_from: ['bill from:', 'vendor:', 'from:', 'supplier:'],
    subtotal: ['subtotal:', 'sub-total:'],
    tax_amount: ['vat:', 'tax:', 'kodi ya ongezeko la thamani:'],
    total: ['total:', 'grand total:', 'jumla:'],
    currency: ['currency:', 'tzs', 'kes', 'ugx', 'usd'],
    line_items: ['description', 'quantity', 'unit price', 'amount'],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// Utility Bill
// ─────────────────────────────────────────────────────────────────────

export const utilityBillSchema: NamedSchema = {
  id: 'utility_bill',
  label: 'Utility Bill',
  schema: z.object({
    utility_type: z.enum(['electricity', 'water', 'gas', 'internet']).optional(),
    account_number: z.string().optional(),
    customer_name: z.string().optional(),
    service_address: z.string().optional(),
    billing_period: z.string().optional(),
    units_consumed: z.string().optional(),
    amount_due: z.string().optional(),
    due_date: z.string().optional(),
    currency: z.string().optional(),
    provider: z.string().optional(),
  }),
  keywords: Object.freeze({
    utility_type: ['electricity', 'water', 'gas', 'internet'],
    account_number: ['account number:', 'a/c:', 'customer id:'],
    customer_name: ['customer:', 'name:', 'jina:'],
    service_address: ['service address:', 'address:', 'anwani:'],
    billing_period: ['billing period:', 'period:'],
    units_consumed: ['units:', 'kwh:', 'consumption:'],
    amount_due: ['amount due:', 'total:', 'kiasi cha kulipa:'],
    due_date: ['due date:', 'pay by:', 'tarehe ya malipo:'],
    currency: ['currency:', 'tzs', 'kes', 'ugx', 'usd'],
    provider: ['provider:', 'utility:', 'tanesco', 'kplc', 'umeme'],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// Registry — all six pre-shipped schemas in one place.
// ─────────────────────────────────────────────────────────────────────

export const PRESHIPPED_SCHEMAS: ReadonlyArray<NamedSchema> = Object.freeze([
  leaseAgreementSchema,
  bankStatementSchema,
  idCardSchema,
  receiptSchema,
  invoiceSchema,
  utilityBillSchema,
]);
