/**
 * Off-take Settlement Worksheet — data schema.
 *
 * A NEW doc type demonstrating the data-binding + Carbone XLSX path: a
 * mineral off-take settlement reconciles a provisional invoice against
 * assay results and computes the final balance per shipment. Carbone
 * renders one Office template → XLSX (editable worksheet) + PDF.
 *
 * Every monetary figure is bound via `formatCurrency` (data-binding
 * layer) and the document is single-language (EN/SW absolute toggle).
 *
 * MINING document class (Borjie mining-estate OS).
 */

import { z } from 'zod';
import { CitationSchema } from '../../types.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD');
const Iso4217 = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 currency code');

export const LocaleSchema = z.enum(['en', 'sw']);
export type DocLocale = z.infer<typeof LocaleSchema>;

export const SettlementLineSchema = z.object({
  shipmentRef: z.string().min(1),
  date: IsoDate,
  mineral: z.string().min(1),
  /** Net wet/dry mass in the stated unit. */
  quantity: z.number().nonnegative(),
  unit: z.string().min(1),
  /** Provisional unit price (per `unit`) at the time of advance. */
  provisionalUnitPrice: z.number().nonnegative(),
  /** Final assayed unit price after lab results. */
  finalUnitPrice: z.number().nonnegative(),
  /** Already advanced against this shipment (provisional payment). */
  advancePaid: z.number().nonnegative(),
});
export type SettlementLine = z.infer<typeof SettlementLineSchema>;

export const OfftakeSettlementDataSchema = z.object({
  locale: LocaleSchema,
  currencyCode: Iso4217,
  buyer: z.object({
    name: z.string().min(1),
    reference: z.string().min(1),
  }),
  producer: z.object({
    name: z.string().min(1),
    licenceNo: z.string().min(1),
  }),
  settlement: z.object({
    settlementNo: z.string().min(1),
    dateIssued: IsoDate,
  }),
  lines: z.array(SettlementLineSchema).min(1),
  citations: z.array(CitationSchema).default([]),
});
export type OfftakeSettlementData = z.infer<typeof OfftakeSettlementDataSchema>;
