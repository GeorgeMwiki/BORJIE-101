/**
 * Mineral Royalty Statement — data schema.
 *
 * Per-shipment mineral royalty computation under the Mining Act, 2010
 * (Tanzania). The CALLER supplies the raw shipment facts (gross value,
 * royalty rate, optional inspection-fee rate); the BUILDER computes the
 * royalty + inspection-fee per shipment and the statement totals, then
 * pre-formats every monetary figure via the project `formatCurrency`
 * convention (../../format.ts) and injects a single-language label set
 * (EN/SW absolute toggle — no mixing).
 *
 * MINING document class (Borjie mining-estate OS).
 */

import { z } from 'zod';
import { CitationSchema } from '../../types.js';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ISO date YYYY-MM-DD');
const Iso4217 = z.string().regex(/^[A-Z]{3}$/, 'ISO-4217 currency code');
const Pct = z.number().min(0).max(100);

export const LocaleSchema = z.enum(['en', 'sw']);
export type DocLocale = z.infer<typeof LocaleSchema>;

export const ProducerSchema = z.object({
  name: z.string().min(1),
  licenceNo: z.string().min(1),
  tin: z.string().min(1),
  address: z.string().min(1),
});

export const StatementMetaSchema = z.object({
  statementNo: z.string().min(1),
  periodStart: IsoDate,
  periodEnd: IsoDate,
  dateIssued: IsoDate,
  issuedBy: z.string().min(1),
});

export const ShipmentSchema = z.object({
  shipmentRef: z.string().min(1),
  date: IsoDate,
  mineral: z.string().min(1),
  quantity: z.number().nonnegative(),
  /** Unit of measure as supplied — 'kg', 'g', 'ct' (carats), 't' (tonnes)… */
  unit: z.string().min(1),
  grade: z.string().optional(),
  /** Gross/assessed value of the shipment, in the statement currency. */
  grossValue: z.number().nonnegative(),
  /** Statutory royalty rate (%) for this mineral — e.g. 6 for gold. */
  royaltyRatePct: Pct,
  /** Optional clearing/inspection-fee rate (%) at export — e.g. 1. */
  inspectionFeeRatePct: Pct.optional(),
});

export type Shipment = z.infer<typeof ShipmentSchema>;

export const RoyaltyStatementDataSchema = z.object({
  /** Absolute language toggle for the whole document. */
  locale: LocaleSchema,
  /** ISO-4217 currency for ALL monetary figures. Never inferred. */
  currencyCode: Iso4217,
  producer: ProducerSchema,
  statement: StatementMetaSchema,
  shipments: z.array(ShipmentSchema).min(1),
  citations: z.array(CitationSchema).default([]),
});

export type RoyaltyStatementData = z.infer<typeof RoyaltyStatementDataSchema>;
