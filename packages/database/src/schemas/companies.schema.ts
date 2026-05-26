/**
 * Companies, directors, shareholders, bank accounts, authorities — Borjie mining domain.
 *
 * Per DATA_MODEL.md §3.1. Backs the corporate-structure side of every
 * mining licence. A `tenant` owns one or more `companies`; each company
 * holds licences, employs people, holds bank accounts and is registered
 * with TZ authorities (BRELA / TRA / TMAA / NEMC).
 *
 * RLS: every table tenant-scoped via `app.tenant_id` GUC. SQL policies
 * created in migration 0003_mining_domain.sql.
 */

import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenant.schema.js';

// ============================================================================
// companies — TZ-registered mining business entity
// ============================================================================

export const companies = pgTable(
  'companies',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** BRELA registration number. */
    registrationNo: text('registration_no'),
    /** Taxpayer Identification Number (TRA). */
    tin: text('tin'),
    /** VAT Registration Number (TRA). */
    vrn: text('vrn'),
    registeredAddress: text('registered_address'),
    /** ISO-3166-1 alpha-2; defaults to TZ. */
    // UNIV-4: column default = TZ launch beachhead; future jurisdictions write their own value. See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    country: text('country').notNull().default('TZ'),
    /** Free-form attributes (logo, contacts, ICO categories, etc.). */
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('companies_tenant_idx').on(t.tenantId),
    regNoIdx: uniqueIndex('companies_reg_no_idx').on(t.tenantId, t.registrationNo),
    tinIdx: index('companies_tin_idx').on(t.tin),
  }),
);

// ============================================================================
// directors — board / executive office holders
// ============================================================================

export const directors = pgTable(
  'directors',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    nidaId: text('nida_id'),
    role: text('role').notNull(),
    appointedOn: date('appointed_on'),
    resignedOn: date('resigned_on'),
    // UNIV-4: column default = TZ launch beachhead; future jurisdictions write their own value. See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    nationality: text('nationality').notNull().default('TZ'),
    /** Contact + KYC blob. */
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('directors_tenant_idx').on(t.tenantId),
    companyIdx: index('directors_company_idx').on(t.companyId),
  }),
);

// ============================================================================
// shareholders — equity holders
// ============================================================================

export const shareholders = pgTable(
  'shareholders',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    holderName: text('holder_name').notNull(),
    /** 'individual' | 'company' | 'trust'. */
    holderKind: text('holder_kind').notNull(),
    /** Percentage shareholding, 0-100, scaled to 4 decimal places. */
    sharePct: numeric('share_pct', { precision: 7, scale: 4 }).notNull(),
    shareClass: text('share_class').notNull().default('ordinary'),
    sharesIssued: numeric('shares_issued', { precision: 18, scale: 0 }),
    /** Nationality drives Local-Content reporting. */
    // UNIV-4: column default = TZ launch beachhead; future jurisdictions write their own value. See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    nationality: text('nationality').notNull().default('TZ'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('shareholders_tenant_idx').on(t.tenantId),
    companyIdx: index('shareholders_company_idx').on(t.companyId),
  }),
);

// ============================================================================
// bank_accounts — TZS + USD operating accounts
// ============================================================================

export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    bankName: text('bank_name').notNull(),
    branch: text('branch'),
    /** Encrypted at application layer; raw account number never logged. */
    accountNumber: text('account_number').notNull(),
    /** ISO-4217. */
    // UNIV-4: column default = TZ launch beachhead; future jurisdictions write their own value. See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
    currency: text('currency').notNull().default('TZS'),
    swiftBic: text('swift_bic'),
    purpose: text('purpose'),
    isActive: text('is_active').notNull().default('true'),
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('bank_accounts_tenant_idx').on(t.tenantId),
    companyIdx: index('bank_accounts_company_idx').on(t.companyId),
  }),
);

// ============================================================================
// authorities — TZ regulators relevant to a company
// ============================================================================

export const authorities = pgTable(
  'authorities',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    companyId: text('company_id').references(() => companies.id, {
      onDelete: 'cascade',
    }),
    /** 'BRELA'|'TRA'|'TMAA'|'NEMC'|'OSHA'|'MoM'|'BoT'|'LGA'|'village_council'. */
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    /** Reference number issued by the authority (registration, tax cert, etc.). */
    refNumber: text('ref_number'),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    /** JSON dump of obligations / due dates for this authority. */
    attributes: jsonb('attributes').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    tenantIdx: index('authorities_tenant_idx').on(t.tenantId),
    companyIdx: index('authorities_company_idx').on(t.companyId),
    kindIdx: index('authorities_kind_idx').on(t.kind),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Director = typeof directors.$inferSelect;
export type Shareholder = typeof shareholders.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type Authority = typeof authorities.$inferSelect;
