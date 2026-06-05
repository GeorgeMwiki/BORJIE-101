/**
 * Pre-shipped Zod schemas for the most common forms we see in
 * mining estate document workflows. Each schema is paired with a
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
// Mining Licence (PML / PL / SML / ML) — Tanzanian Mining Commission.
//
// PML = Primary Mining Licence (artisanal), PL = Prospecting Licence,
// SML = Special Mining Licence, ML = Mining Licence (mid-tier). The
// licence-type token usually sits beside the licence number on the
// certificate, hence both a dedicated `licence_type` field AND a value
// keyword list that recognises the abbreviations and Swahili forms.
// ─────────────────────────────────────────────────────────────────────

export const miningLicenceSchema: NamedSchema = {
  id: 'mining_licence',
  label: 'Mining Licence',
  schema: z.object({
    licence_number: z.string().optional(),
    licence_type: z.string().optional(),
    holder_name: z.string().optional(),
    mineral: z.string().optional(),
    area_hectares: z.string().optional(),
    region: z.string().optional(),
    district: z.string().optional(),
    grant_date: z.string().optional(),
    expiry_date: z.string().optional(),
    annual_rent: z.string().optional(),
    coordinates: z.string().optional(),
  }),
  keywords: Object.freeze({
    licence_number: [
      'licence number:',
      'license number:',
      'licence no:',
      'license no:',
      'pml no:',
      'pl no:',
      'sml no:',
      'ml no:',
      'nambari ya leseni:',
    ],
    licence_type: [
      'licence type:',
      'license type:',
      'type of licence:',
      'aina ya leseni:',
    ],
    holder_name: [
      'holder:',
      'holder name:',
      'licensee:',
      'licence holder:',
      'mwenye leseni:',
    ],
    mineral: ['mineral:', 'minerals:', 'commodity:', 'madini:'],
    area_hectares: [
      'area (ha):',
      'area in hectares:',
      'area hectares:',
      'area:',
      'eneo (ha):',
      'eneo:',
    ],
    region: ['region:', 'mkoa:'],
    district: ['district:', 'wilaya:'],
    grant_date: [
      'grant date:',
      'date of grant:',
      'granted:',
      'tarehe ya kutolewa:',
    ],
    expiry_date: [
      'expiry date:',
      'expiry:',
      'expires:',
      'valid until:',
      'tarehe ya kumalizika:',
    ],
    annual_rent: [
      'annual rent:',
      'annual fee:',
      'ground rent:',
      'kodi ya mwaka:',
    ],
    coordinates: [
      'coordinates:',
      'co-ordinates:',
      'corner points:',
      'gps:',
      'viwianishi:',
    ],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// Mineral Royalty Return — Tanzania Revenue Authority (TRA).
//
// The royalty return declares the mineral, quantity, gross value and the
// statutory royalty rate/amount for an assessment period. These all
// appear as `Label: value` summary lines on the return, so the line-
// keyword heuristic captures them directly (no table walk required).
// ─────────────────────────────────────────────────────────────────────

export const royaltyReturnSchema: NamedSchema = {
  id: 'royalty_return',
  label: 'Mineral Royalty Return',
  schema: z.object({
    period: z.string().optional(),
    mineral: z.string().optional(),
    quantity: z.string().optional(),
    unit: z.string().optional(),
    gross_value: z.string().optional(),
    royalty_rate: z.string().optional(),
    royalty_amount: z.string().optional(),
    currency: z.string().optional(),
    assessment_number: z.string().optional(),
  }),
  keywords: Object.freeze({
    period: [
      'period:',
      'return period:',
      'assessment period:',
      'month:',
      'kipindi:',
    ],
    mineral: ['mineral:', 'minerals:', 'commodity:', 'madini:'],
    quantity: ['quantity:', 'qty:', 'volume:', 'weight:', 'kiasi:'],
    unit: ['unit:', 'unit of measure:', 'uom:', 'kipimo:'],
    gross_value: [
      'gross value:',
      'market value:',
      'value:',
      'thamani:',
      'thamani ghafi:',
    ],
    royalty_rate: ['royalty rate:', 'rate:', 'kiwango cha mrabaha:'],
    royalty_amount: [
      'royalty amount:',
      'royalty payable:',
      'royalty:',
      'mrabaha:',
    ],
    currency: ['currency:', 'tzs', 'kes', 'ugx', 'usd'],
    assessment_number: [
      'assessment number:',
      'assessment no:',
      'reference:',
      'ref:',
      'nambari ya makadirio:',
    ],
  }),
};

// ─────────────────────────────────────────────────────────────────────
// Accountant Export (Trial Balance) — financial export from the
// estate's bookkeeping (QuickBooks / Tally / Sage / Excel).
//
// IMPORTANT — this is a TABULAR document. The per-account debit / credit
// / balance rows live in an `ExtractedTable`, NOT in `Label: value`
// lines, so the line-keyword heuristic CANNOT recover the body rows.
// The keyword hints below only catch the document-level SUMMARY lines
// (period, reporting currency, total debits/credits) that some exports
// print above/below the grid. Callers that need the full account ledger
// MUST walk `ParsedDocument.pages[].tables` (the `ExtractedTable` path),
// mapping header columns → {account, debit, credit, balance}. The
// exported `ACCOUNTANT_EXPORT_TABULAR` flag and `accountantExportColumns`
// header-synonym map let the async-OCR worker drive that table walk; see
// `selectSchemaForDocument` in the api-gateway for the routing note.
// ─────────────────────────────────────────────────────────────────────

export const accountantExportSchema: NamedSchema = {
  id: 'accountant_export',
  label: 'Accountant Export (Trial Balance)',
  schema: z.object({
    period: z.string().optional(),
    account: z.string().optional(),
    debit: z.string().optional(),
    credit: z.string().optional(),
    balance: z.string().optional(),
    currency: z.string().optional(),
  }),
  keywords: Object.freeze({
    period: [
      'period:',
      'as at:',
      'for the period:',
      'reporting period:',
      'kipindi:',
    ],
    account: ['account:', 'account name:', 'ledger:', 'akaunti:'],
    debit: ['debit:', 'total debit:', 'total debits:', 'dr:', 'deni:'],
    credit: ['credit:', 'total credit:', 'total credits:', 'cr:', 'mkopo:'],
    balance: ['balance:', 'closing balance:', 'net balance:', 'salio:'],
    currency: ['currency:', 'reporting currency:', 'tzs', 'kes', 'ugx', 'usd'],
  }),
};

/**
 * Marks `accountant_export` as a tabular schema: its account-level
 * debit/credit/balance rows live in an `ExtractedTable`, so heuristic
 * line-keyword extraction only recovers summary fields. The async-OCR
 * worker should detect this flag and walk `ParsedDocument` tables for the
 * body rows rather than relying on `extractFormFields` alone.
 */
export const ACCOUNTANT_EXPORT_TABULAR = true as const;

/**
 * Header-cell synonyms (lower-cased, bilingual en/sw) used to map an
 * `ExtractedTable` header row onto the trial-balance columns when walking
 * the tabular accountant export. Consumed by the async-OCR table walker;
 * kept beside the schema so the column vocabulary has a single source.
 */
export const accountantExportColumns: Readonly<
  Record<'account' | 'debit' | 'credit' | 'balance', ReadonlyArray<string>>
> = Object.freeze({
  account: ['account', 'account name', 'ledger', 'description', 'akaunti'],
  debit: ['debit', 'dr', 'debits', 'deni'],
  credit: ['credit', 'cr', 'credits', 'mkopo'],
  balance: ['balance', 'closing balance', 'net', 'salio'],
});

// ─────────────────────────────────────────────────────────────────────
// Registry — all pre-shipped schemas in one place.
// ─────────────────────────────────────────────────────────────────────

export const PRESHIPPED_SCHEMAS: ReadonlyArray<NamedSchema> = Object.freeze([
  leaseAgreementSchema,
  bankStatementSchema,
  idCardSchema,
  receiptSchema,
  invoiceSchema,
  utilityBillSchema,
  miningLicenceSchema,
  royaltyReturnSchema,
  accountantExportSchema,
]);
