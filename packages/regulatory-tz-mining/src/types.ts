/**
 * Zod schemas + types for the TZ mining regulator rule engine.
 *
 * Keep the input shape generic — we receive a structured "facts" bag
 * that the LMBM has already extracted, then each rule reads the
 * fields it cares about.
 */

import { z } from 'zod';

export const regulatorSchema = z.enum(['nemc', 'tumemadini', 'bot', 'tra', 'gepg']);
export type Regulator = z.infer<typeof regulatorSchema>;

export const licenceKindSchema = z.enum(['PML', 'PL', 'SML', 'ML']);
export type LicenceKind = z.infer<typeof licenceKindSchema>;

export const licenceSchema = z.object({
  id: z.string(),
  kind: licenceKindSchema,
  holder: z.string(),
  issuedISO: z.string(),
  expiresISO: z.string(),
  /** Annual fee owed in TZS — populate from gazette schedule (see gh-issue #31). */
  annualFeeTzs: z.number().nonnegative().default(0),
  status: z.enum(['active', 'lapsed', 'suspended', 'revoked']).default('active'),
});
export type Licence = z.infer<typeof licenceSchema>;

export const eiaApprovalSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  approvedISO: z.string(),
  expiresISO: z.string(),
  category: z.enum(['EPP', 'EIA-A', 'EIA-B']),
});
export type EiaApproval = z.infer<typeof eiaApprovalSchema>;

export const goldWindowReceiptSchema = z.object({
  id: z.string(),
  receivedISO: z.string(),
  /** Gold tonnes deposited into the BoT window. */
  tonnes: z.number().nonnegative(),
  /** USD proceeds credited. */
  proceedsUsd: z.number().nonnegative(),
});
export type GoldWindowReceipt = z.infer<typeof goldWindowReceiptSchema>;

export const taxFilingSchema = z.object({
  id: z.string(),
  kind: z.enum(['royalty', 'corporate', 'withholding', 'vat']),
  periodLabel: z.string(),
  dueISO: z.string(),
  filedISO: z.string().nullable(),
  amountTzs: z.number().nonnegative(),
  paidTzs: z.number().nonnegative().default(0),
});
export type TaxFiling = z.infer<typeof taxFilingSchema>;

export const gepgControlNumberSchema = z.object({
  controlNumber: z.string(),
  issuedISO: z.string(),
  expiresISO: z.string(),
  amountTzs: z.number().nonnegative(),
  paid: z.boolean(),
  paidISO: z.string().nullable().default(null),
});
export type GepgControlNumber = z.infer<typeof gepgControlNumberSchema>;

export const regulatoryFactsSchema = z.object({
  asOfISO: z.string(),
  licences: z.array(licenceSchema).default([]),
  eiaApprovals: z.array(eiaApprovalSchema).default([]),
  goldWindowReceipts: z.array(goldWindowReceiptSchema).default([]),
  taxFilings: z.array(taxFilingSchema).default([]),
  gepgControlNumbers: z.array(gepgControlNumberSchema).default([]),
  /** Tonnes of gold sold outside the BoT window in the current month. */
  goldSoldOutsideWindowTonnes: z.number().nonnegative().default(0),
  /** Annual production tonnes — used by some royalty rules. */
  annualProductionTonnes: z.number().nonnegative().default(0),
});
export type RegulatoryFacts = z.infer<typeof regulatoryFactsSchema>;

// ─── Verdict ──────────────────────────────────────────────────────

export const verdictSchema = z.enum(['compliant', 'warning', 'breach', 'unknown']);
export type Verdict = z.infer<typeof verdictSchema>;

export const evidenceRefSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'licence',
    'eia',
    'gold-window',
    'tax-filing',
    'gepg-cn',
    'fact',
  ]),
  pointer: z.string(),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

export const ruleResultSchema = z.object({
  ruleId: z.string(),
  regulator: regulatorSchema,
  title: z.string(),
  verdict: verdictSchema,
  message: z.string(),
  citation: z.string(),
  evidence: z.array(evidenceRefSchema).default([]),
});
export type RuleResult = z.infer<typeof ruleResultSchema>;

export const regulatoryAnalysisSchema = z.object({
  asOfISO: z.string(),
  results: z.array(ruleResultSchema),
  summary: z.object({
    compliantCount: z.number().int(),
    warningCount: z.number().int(),
    breachCount: z.number().int(),
    unknownCount: z.number().int(),
  }),
  computedAtISO: z.string(),
});
export type RegulatoryAnalysis = z.infer<typeof regulatoryAnalysisSchema>;

// ─── Recommendation ───────────────────────────────────────────────

export const regulatoryRecommendationSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  evidence: z.array(evidenceRefSchema).min(1),
});
export type RegulatoryRecommendation = z.infer<typeof regulatoryRecommendationSchema>;

export const regulatoryRecommendationContextSchema = z.object({
  analysis: regulatoryAnalysisSchema,
});
export type RegulatoryRecommendationContext = z.infer<
  typeof regulatoryRecommendationContextSchema
>;

// ─── Rule contract ────────────────────────────────────────────────

export interface RegulatoryRule {
  readonly id: string;
  readonly regulator: Regulator;
  readonly title: string;
  readonly citation: string;
  evaluate(facts: RegulatoryFacts): RuleResult;
}
