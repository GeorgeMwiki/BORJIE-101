/**
 * Monthly Owner Report — data schema.
 *
 * The Carbone DOCX template addresses every field below by path
 * (e.g. `{d.summary.rentCollected}`). Zod validates the request data
 * before any external call is made; failure surfaces a structured
 * `ZodError` the caller can render in chat-ui.
 *
 * Refs:
 *   .audit/litfin-sota-2026-05-23/19-document-generation.md (doc #1 in catalog)
 */

import { z } from 'zod';

export const PeriodSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD'),
});

export const UnitLedgerRowSchema = z.object({
  unitNumber: z.string().min(1),
  tenantName: z.string().min(1),
  rentDue: z.number().nonnegative(),
  rentPaid: z.number().nonnegative(),
  notes: z.string().optional(),
});

export const PropertySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
});

export const OwnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  /** ISO-4217 currency the owner chose for display. Never inferred. */
  currencyPref: z.string().regex(/^[A-Z]{3}$/),
});

export const SummarySchema = z.object({
  rentCollected: z.number().nonnegative(),
  expenses: z.number().nonnegative(),
  netOwner: z.number(),
  occupancyPct: z.number().min(0).max(100),
});

export const MonthlyOwnerReportDataSchema = z.object({
  period: PeriodSchema,
  property: PropertySchema,
  owner: OwnerSchema,
  summary: SummarySchema,
  units: z.array(UnitLedgerRowSchema).min(1),
  /** AI-synthesised executive summary (markdown). Always cited. */
  narrative: z.string().optional(),
});

export type MonthlyOwnerReportData = z.infer<typeof MonthlyOwnerReportDataSchema>;
