/**
 * Licence Agent — own the mineral-rights / tenement portfolio.
 *
 * Grounding: Docs/research/mining-estate-operating-model.md §1 (Tenement
 * / Licence Lifecycle & Land Management) and §6 (Royalty & Fiscal
 * Regime). The dossier's load-bearing rule: a mining cadastre is the
 * spatial system-of-record, and the MD must "track every licence's NEXT
 * obligation (annual fee, work-program report, relinquishment date,
 * renewal window) and never let one lapse — lapse = forfeiture"
 * (§1.2). FlexiCadastre/Landfolio (~60% of African jurisdictions) is the
 * world-class pattern this junior mirrors in software.
 *
 * Capabilities:
 *   - Per-jurisdiction obligation cadence packs (TZ launch · KE/UG/NG
 *     expansion) covering the licence ladder (§1.1) — each obligation
 *     carries its statutory citation.
 *   - NEXT-obligation resolver: the single soonest deadline across
 *     annual fee · work-program report · relinquishment · renewal,
 *     because that is the one that forfeits the tenement first.
 *   - Renewal calendar with T-90 / T-30 / T-7 milestones.
 *   - Deterministic forfeiture-risk score (0-100) + dormancy factors.
 *   - Payment-history pack (currency-agnostic — never hard-codes TZS).
 *
 * Design: the schedule, NEXT-obligation, and risk score are computed
 * DETERMINISTICALLY (pure functions, below). The injected Claude port
 * (`deps.claude`) is used only for the qualitative narrative — required
 * actions and rationale — never for the dates or the score. The brain
 * port is injected; we never call an SDK directly.
 *
 * Writes via typed `db.insert(licenceDormancyScores)` (migration 0011).
 * The formal `licences` / `licence_events` tables (licences.schema) are
 * populated by the licence portal, not this junior.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AuditedOutputBase,
  buildUniversalPrompt,
  defaultJuniorDeps,
  deterministicId,
  isoToday,
  loadJuniorSchemas,
  runClaudeJunior,
  withResolvedDb,
  type JuniorDeps,
} from './_shared.js';
import { resolveTierModelId } from '../model-resolution.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas — input
// ─────────────────────────────────────────────────────────────────────

export const LicenceKindSchema = z.enum(['PML', 'PL', 'ML', 'SML', 'DEALER', 'BROKER', 'PROCESSING']);
export type LicenceKind = z.infer<typeof LicenceKindSchema>;

/**
 * Jurisdiction the tenement sits in. TZ is the launch jurisdiction;
 * KE/UG/NG are the planned expansion markets (dossier §6.3). Each maps
 * to its own obligation cadence pack.
 */
export const JurisdictionSchema = z.enum(['TZ', 'KE', 'UG', 'NG']);
export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const LicenceAgentInputSchema = z.object({
  tenantId: z.string().min(1),
  licenceId: z.string().min(1),
  licenceNo: z.string().min(1),
  kind: LicenceKindSchema,
  /** Defaults to TZ (launch jurisdiction). */
  jurisdiction: JurisdictionSchema.default('TZ'),
  grantDate: z.string().regex(DATE_RE),
  expiryDate: z.string().regex(DATE_RE),
  lastPaymentDate: z.string().regex(DATE_RE).nullable(),
  lastWorkProgrammeReportDate: z.string().regex(DATE_RE).nullable(),
  /** Date the last relinquishment / area-reduction was filed, if any. */
  lastRelinquishmentDate: z.string().regex(DATE_RE).nullable().default(null),
  eppFiledAt: z.string().regex(DATE_RE).nullable(),
  areaUtilisationPct: z.number().min(0).max(100),
  /** Optional override for "today" — makes the agent deterministic in tests. */
  asOf: z.string().regex(DATE_RE).optional(),
});
export type LicenceAgentInput = z.infer<typeof LicenceAgentInputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Schemas — output
// ─────────────────────────────────────────────────────────────────────

export const ObligationKindSchema = z.enum([
  'annual_fee',
  'work_programme_report',
  'relinquishment',
  'renewal',
]);
export type ObligationKind = z.infer<typeof ObligationKindSchema>;

/** A single scheduled tenement obligation with its statutory citation. */
export const TenementObligation = z.object({
  kind: ObligationKindSchema,
  due_date: z.string().regex(DATE_RE),
  days_until_due: z.number().int(),
  status: z.enum(['upcoming', 'due', 'overdue', 'complete']),
  /** Statutory basis — the Act section / regulation that creates the deadline. */
  citation: z.string().min(1),
});
export type TenementObligation = z.infer<typeof TenementObligation>;

export const RenewalMilestone = z.object({
  label: z.enum(['T-90', 'T-30', 'T-7', 'expiry']),
  date: z.string().regex(DATE_RE),
  status: z.enum(['upcoming', 'due', 'overdue', 'complete']),
  required_actions: z.array(z.string()),
});
export type RenewalMilestone = z.infer<typeof RenewalMilestone>;

export const DormancyFactors = z.object({
  last_payment_age_days: z.number().int().min(0),
  last_report_age_days: z.number().int().min(0),
  work_programme_variance_pct: z.number(),
  area_utilisation_pct: z.number(),
  epp_filed: z.boolean(),
});
export type DormancyFactors = z.infer<typeof DormancyFactors>;

export const PaymentHistoryEntry = z.object({
  gepg_control_no: z.string().min(1),
  paid_at: z.string().regex(DATE_RE),
  /** Currency-agnostic — the surface renders via formatCurrency(amount, currency_code). */
  amount: z.number().nonnegative(),
  currency_code: z.string().length(3),
  kind: z.string(),
  receipt_evidence_id: z.string(),
});
export type PaymentHistoryEntry = z.infer<typeof PaymentHistoryEntry>;

export const LicenceRenewalOutput = AuditedOutputBase.extend({
  licence_id: z.string().min(1),
  jurisdiction: JurisdictionSchema,
  /** Every tracked obligation, soonest-first. */
  obligation_schedule: z.array(TenementObligation).min(1),
  /**
   * The single soonest unmet obligation — the one whose lapse forfeits
   * the tenement first. Null only if every obligation is complete.
   */
  next_obligation: TenementObligation.nullable(),
  renewal_calendar: z.array(RenewalMilestone).min(1),
  dormancy_score: z.number().int().min(0).max(100),
  /** 0-100; high = at risk of cancellation / revocation. */
  forfeiture_risk_score: z.number().int().min(0).max(100),
  forfeiture_risk_band: z.enum(['low', 'medium', 'high', 'critical']),
  dormancy_factors: DormancyFactors,
  payment_history_pack: z.array(PaymentHistoryEntry),
  dormancy_alert_level: z.enum(['green', 'amber', 'red']),
});
export type LicenceRenewalOutput = z.infer<typeof LicenceRenewalOutput>;

/** Narrative-only slice the LLM port returns; merged onto the deterministic core. */
const LicenceNarrativeSchema = AuditedOutputBase.extend({
  renewal_required_actions: z.record(z.string(), z.array(z.string())).default({}),
  payment_history_pack: z.array(PaymentHistoryEntry).default([]),
});
type LicenceNarrative = z.infer<typeof LicenceNarrativeSchema>;

// ─────────────────────────────────────────────────────────────────────
// Per-jurisdiction obligation cadence packs (dossier §1.1, §6.2–§6.3)
// ─────────────────────────────────────────────────────────────────────

interface ObligationCadence {
  /** Months between recurring annual-fee postings. */
  readonly annualFeeMonths: number;
  /** Months between work-programme reports. */
  readonly workProgrammeMonths: number;
  /** Months between scheduled relinquishment / area-reduction reviews. */
  readonly relinquishmentMonths: number;
  readonly citations: {
    readonly annualFee: string;
    readonly workProgramme: string;
    readonly relinquishment: string;
    readonly renewal: string;
  };
}

/**
 * Cadence packs are conservative defaults grounded in the dossier's
 * licence-ladder. TZ is verified (§6.2). KE has a verified statute
 * (Mining Act 2016, §6.3). UG/NG are flagged UNVERIFIED in §16 of the
 * dossier — we still schedule annual obligations but cite the gap so the
 * Auditor / owner knows the basis needs a jurisdiction deep-dive.
 */
const CADENCE_BY_JURISDICTION: Record<Jurisdiction, ObligationCadence> = {
  TZ: {
    annualFeeMonths: 12,
    workProgrammeMonths: 12,
    relinquishmentMonths: 24,
    citations: {
      annualFee:
        'Mining Act (TZ) — annual rent/fee per Tume ya Madini schedule (tumemadini.go.tz/publications/regulations).',
      workProgramme:
        'Mining (Mineral Rights) Regulations (TZ) — periodic work-programme reporting; dossier §1.2.',
      relinquishment:
        'Mining Act (TZ) — periodic area reduction / relinquishment obligation; dossier §1.1.',
      renewal:
        'Mining Act 2017 amendments (TZ) — renewal within the statutory window; dossier §6.2.',
    },
  },
  KE: {
    annualFeeMonths: 12,
    workProgrammeMonths: 12,
    relinquishmentMonths: 24,
    citations: {
      annualFee: 'Mining Act 2016 (KE) — annual mineral-right fees; dossier §6.3.',
      workProgramme: 'Mining Act 2016 (KE) — work-programme reporting; dossier §1.1.',
      relinquishment: 'Mining Act 2016 (KE) — area relinquishment on tenement progression; dossier §1.1.',
      renewal: 'Mining Act 2016 (KE) — renewal of large/small-scale rights; dossier §6.3.',
    },
  },
  UG: {
    annualFeeMonths: 12,
    workProgrammeMonths: 12,
    relinquishmentMonths: 24,
    citations: {
      annualFee:
        'Uganda Mining & Minerals Act 2022 — fee terms UNVERIFIED (dossier §16); deep-dive required before UG go-live.',
      workProgramme:
        'Uganda Mining & Minerals Act 2022 — reporting terms UNVERIFIED (dossier §16).',
      relinquishment:
        'Uganda Mining & Minerals Act 2022 — relinquishment terms UNVERIFIED (dossier §16).',
      renewal: 'Uganda Mining & Minerals Act 2022 — renewal terms UNVERIFIED (dossier §16).',
    },
  },
  NG: {
    annualFeeMonths: 12,
    workProgrammeMonths: 12,
    relinquishmentMonths: 24,
    citations: {
      annualFee:
        'Nigerian Minerals & Mining Act 2007 — fee terms UNVERIFIED (dossier §16); deep-dive required before NG go-live.',
      workProgramme:
        'Nigerian Minerals & Mining Act 2007 — reporting terms UNVERIFIED (dossier §16).',
      relinquishment:
        'Nigerian Minerals & Mining Act 2007 — relinquishment terms UNVERIFIED (dossier §16).',
      renewal: 'Nigerian Minerals & Mining Act 2007 — renewal terms UNVERIFIED (dossier §16).',
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// Pure date helpers
// ─────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function parseIsoDate(d: string): number {
  return Date.parse(`${d}T00:00:00.000Z`);
}

function addMonths(iso: string, months: number): string {
  const base = new Date(`${iso}T00:00:00.000Z`);
  base.setUTCMonth(base.getUTCMonth() + months);
  return base.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return new Date(parseIsoDate(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseIsoDate(toIso) - parseIsoDate(fromIso)) / MS_PER_DAY);
}

function ageDays(fromIso: string | null, todayIso: string): number {
  if (!fromIso) return 9_999; // never done → maximal age
  return Math.max(0, daysBetween(fromIso, todayIso));
}

/**
 * The soonest recurrence of a `cadenceMonths` obligation strictly on or
 * after `today`, anchored on the last time it was done (or grant date if
 * never). Pure + deterministic.
 */
function nextRecurrence(anchorIso: string, cadenceMonths: number, todayIso: string): string {
  let due = addMonths(anchorIso, cadenceMonths);
  let guard = 0;
  while (parseIsoDate(due) < parseIsoDate(todayIso) && guard < 240) {
    due = addMonths(due, cadenceMonths);
    guard += 1;
  }
  return due;
}

function obligationStatus(daysUntil: number): TenementObligation['status'] {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 7) return 'due';
  return 'upcoming';
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic core — schedule, NEXT obligation, forfeiture risk
// ─────────────────────────────────────────────────────────────────────

function buildObligation(
  kind: ObligationKind,
  dueIso: string,
  todayIso: string,
  citation: string,
): TenementObligation {
  const daysUntil = daysBetween(todayIso, dueIso);
  return {
    kind,
    due_date: dueIso,
    days_until_due: daysUntil,
    status: obligationStatus(daysUntil),
    citation,
  };
}

/** Compute the full obligation schedule (annual fee, WP report, relinquishment, renewal). */
export function computeObligationSchedule(input: LicenceAgentInput, todayIso: string): TenementObligation[] {
  const cadence = CADENCE_BY_JURISDICTION[input.jurisdiction];
  const feeAnchor = input.lastPaymentDate ?? input.grantDate;
  const wpAnchor = input.lastWorkProgrammeReportDate ?? input.grantDate;
  const relAnchor = input.lastRelinquishmentDate ?? input.grantDate;

  const schedule: TenementObligation[] = [
    buildObligation('annual_fee', nextRecurrence(feeAnchor, cadence.annualFeeMonths, todayIso), todayIso, cadence.citations.annualFee),
    buildObligation('work_programme_report', nextRecurrence(wpAnchor, cadence.workProgrammeMonths, todayIso), todayIso, cadence.citations.workProgramme),
    buildObligation('relinquishment', nextRecurrence(relAnchor, cadence.relinquishmentMonths, todayIso), todayIso, cadence.citations.relinquishment),
    buildObligation('renewal', input.expiryDate, todayIso, cadence.citations.renewal),
  ];

  return [...schedule].sort((a, b) => a.days_until_due - b.days_until_due);
}

/**
 * NEXT obligation = the soonest non-complete deadline. The lapse of THIS
 * one forfeits the tenement first (dossier §1.2). Returns null only when
 * the schedule is empty (never, given the renewal always present).
 */
export function resolveNextObligation(schedule: ReadonlyArray<TenementObligation>): TenementObligation | null {
  const pending = schedule.filter((o) => o.status !== 'complete');
  if (pending.length === 0) return null;
  return [...pending].sort((a, b) => a.days_until_due - b.days_until_due)[0] ?? null;
}

/** T-90 / T-30 / T-7 / expiry renewal milestones, deterministic. */
export function computeRenewalCalendar(expiryIso: string, todayIso: string): RenewalMilestone[] {
  const points: ReadonlyArray<{ label: RenewalMilestone['label']; date: string }> = [
    { label: 'T-90', date: addDays(expiryIso, -90) },
    { label: 'T-30', date: addDays(expiryIso, -30) },
    { label: 'T-7', date: addDays(expiryIso, -7) },
    { label: 'expiry', date: expiryIso },
  ];
  return points.map(({ label, date }) => ({
    label,
    date,
    status: milestoneStatus(date, todayIso),
    required_actions: [],
  }));
}

function milestoneStatus(dateIso: string, todayIso: string): RenewalMilestone['status'] {
  const d = daysBetween(todayIso, dateIso);
  if (d < 0) return 'overdue';
  if (d <= 7) return 'due';
  return 'upcoming';
}

/** Dormancy factors derived deterministically from the input. */
export function computeDormancyFactors(input: LicenceAgentInput, todayIso: string): DormancyFactors {
  const cadence = CADENCE_BY_JURISDICTION[input.jurisdiction];
  const expectedReportAge = cadence.workProgrammeMonths * 30;
  const reportAge = ageDays(input.lastWorkProgrammeReportDate, todayIso);
  const variance = expectedReportAge === 0 ? 0 : Math.round(((reportAge - expectedReportAge) / expectedReportAge) * 100);
  return {
    last_payment_age_days: ageDays(input.lastPaymentDate, todayIso),
    last_report_age_days: reportAge,
    work_programme_variance_pct: variance,
    area_utilisation_pct: input.areaUtilisationPct,
    epp_filed: input.eppFiledAt !== null,
  };
}

/**
 * Dormancy score (0-100): legacy inactivity signal. High = inactive.
 * Weighted blend of payment-age, report-age, work-programme variance,
 * area under-utilisation, and EPP-not-filed (dossier §1.2 forfeiture
 * drivers + §6.2 fiscal compliance).
 */
export function computeDormancyScore(f: DormancyFactors): number {
  const paymentPenalty = clamp01(f.last_payment_age_days / 365) * 30;
  const reportPenalty = clamp01(f.last_report_age_days / 365) * 25;
  const variancePenalty = clamp01(Math.max(0, f.work_programme_variance_pct) / 100) * 15;
  const utilisationPenalty = clamp01((100 - f.area_utilisation_pct) / 100) * 20;
  const eppPenalty = f.epp_filed ? 0 : 10;
  return clampScore(paymentPenalty + reportPenalty + variancePenalty + utilisationPenalty + eppPenalty);
}

/**
 * Forfeiture-risk score (0-100). Distinct from dormancy: it leads with
 * proximity to the NEXT obligation (the deadline that forfeits first)
 * and the count of overdue obligations, then layers dormancy as a
 * background signal. "Lapse = forfeiture" (§1.2) is the dominant term.
 */
export function computeForfeitureRisk(
  schedule: ReadonlyArray<TenementObligation>,
  next: TenementObligation | null,
  dormancyScore: number,
): number {
  const overdueCount = schedule.filter((o) => o.status === 'overdue').length;
  const overduePenalty = clamp01(overdueCount / schedule.length) * 45;
  const proximityPenalty = next ? proximityToPenalty(next.days_until_due) : 0;
  const dormancyContribution = clamp01(dormancyScore / 100) * 20;
  return clampScore(overduePenalty + proximityPenalty + dormancyContribution);
}

/** Closer the next deadline, the higher the penalty (max 35). Overdue caps it. */
function proximityToPenalty(daysUntil: number): number {
  if (daysUntil < 0) return 35;
  if (daysUntil <= 7) return 30;
  if (daysUntil <= 30) return 22;
  if (daysUntil <= 90) return 12;
  return 4;
}

export function forfeitureBand(score: number): LicenceRenewalOutput['forfeiture_risk_band'] {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

export function dormancyAlertLevel(score: number): LicenceRenewalOutput['dormancy_alert_level'] {
  if (score >= 60) return 'red';
  if (score >= 30) return 'amber';
  return 'green';
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function clampScore(x: number): number {
  return Math.min(100, Math.max(0, Math.round(x)));
}

// ─────────────────────────────────────────────────────────────────────
// Prompt — narrative only (dates + scores are deterministic)
// ─────────────────────────────────────────────────────────────────────

export const LICENCE_AGENT_SYSTEM_PROMPT = buildUniversalPrompt({
  juniorName: 'Licence Agent',
  mandate:
    'Given a pre-computed tenement obligation schedule and forfeiture-risk score, write the human-facing ' +
    'narrative: the required actions per renewal milestone and a concise rationale. Do NOT recompute dates or ' +
    'scores — they are authoritative. Treat the cadastre as system-of-record: the NEXT obligation is the one ' +
    'whose lapse forfeits the tenement first.',
  tools:
    'list_licences(tenant_id), compute_dormancy_score(licence_id), schedule_renewal_pack(licence_id, due), ' +
    'cadastre_overlap_check(polygon), generate_gepg_control_number(kind, amount, currency), citation_lookup(rule).',
  evidence:
    'Cite the Mining Act section / Tumemadini circular (or the per-jurisdiction statute) behind each obligation. ' +
    'Payment-history pack entries must reference the GePG control number AND the receipt evidence_id, and carry ' +
    'an explicit currency_code (never assume TZS).',
  outputSchema:
    '{ "renewal_required_actions": { "T-90": string[], "T-30": string[], "T-7": string[], "expiry": string[] }, ' +
    '"payment_history_pack": [{ gepg_control_no, paid_at, amount, currency_code, kind, receipt_evidence_id }], ' +
    '"confidence": number, "rationale": string, "evidence_ids": string[], "citations": string[] }',
  confidenceFloor: 0.8,
  autonomyDomain: 'advisory + scheduling — never files renewals automatically',
  hardRules: [
    'Never quote a royalty/fee rate from memory — always cite the dossier §6 or the Gazette.',
    'Never approve PML transfer to a non-citizen.',
    'Mining Commission dormancy revocation response must be assembled within 24 hours; flag if T-7 is past.',
    'All payments route through GePG control numbers against the tumemadini.go.tz portal.',
    'Never assume currency — every money figure carries an explicit currency_code.',
  ],
});

function buildUserPrompt(
  input: LicenceAgentInput,
  todayIso: string,
  schedule: ReadonlyArray<TenementObligation>,
  next: TenementObligation | null,
  forfeitureScore: number,
): string {
  return [
    `TENANT: ${input.tenantId}  JURISDICTION: ${input.jurisdiction}`,
    `LICENCE: ${input.licenceNo} (${input.kind}) — id ${input.licenceId}`,
    `GRANT: ${input.grantDate}  EXPIRY: ${input.expiryDate}  TODAY: ${todayIso}`,
    `LAST PAYMENT: ${input.lastPaymentDate ?? 'never'}  LAST WP REPORT: ${input.lastWorkProgrammeReportDate ?? 'never'}`,
    `EPP FILED AT: ${input.eppFiledAt ?? 'not yet'}  AREA UTILISATION: ${input.areaUtilisationPct.toFixed(1)}%`,
    `FORFEITURE-RISK SCORE (authoritative): ${forfeitureScore}/100`,
    `NEXT OBLIGATION (authoritative): ${next ? `${next.kind} due ${next.due_date} (${next.days_until_due}d)` : 'none pending'}`,
    `OBLIGATION SCHEDULE (authoritative — do not recompute):`,
    JSON.stringify(schedule, null, 2).slice(0, 3_000),
    `Write required actions per renewal milestone (T-90/T-30/T-7/expiry) and a concise rationale.`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Assembly — merge deterministic core with LLM narrative
// ─────────────────────────────────────────────────────────────────────

function applyNarrativeActions(
  calendar: ReadonlyArray<RenewalMilestone>,
  actions: Record<string, ReadonlyArray<string>>,
): RenewalMilestone[] {
  return calendar.map((m) => ({
    ...m,
    required_actions: [...(actions[m.label] ?? [])],
  }));
}

function assembleOutput(args: {
  readonly input: LicenceAgentInput;
  readonly schedule: ReadonlyArray<TenementObligation>;
  readonly next: TenementObligation | null;
  readonly calendar: ReadonlyArray<RenewalMilestone>;
  readonly factors: DormancyFactors;
  readonly dormancyScore: number;
  readonly forfeitureScore: number;
  readonly narrative: LicenceNarrative;
}): LicenceRenewalOutput {
  const { input, schedule, next, calendar, factors, dormancyScore, forfeitureScore, narrative } = args;
  const citations = mergeCitations(schedule, narrative.citations);
  return {
    licence_id: input.licenceId,
    jurisdiction: input.jurisdiction,
    obligation_schedule: [...schedule],
    next_obligation: next,
    renewal_calendar: applyNarrativeActions(calendar, narrative.renewal_required_actions),
    dormancy_score: dormancyScore,
    forfeiture_risk_score: forfeitureScore,
    forfeiture_risk_band: forfeitureBand(forfeitureScore),
    dormancy_factors: factors,
    payment_history_pack: [...narrative.payment_history_pack],
    dormancy_alert_level: dormancyAlertLevel(dormancyScore),
    confidence: narrative.confidence,
    rationale: narrative.rationale,
    evidence_ids: mergeEvidence(input, narrative.evidence_ids),
    citations,
  };
}

function mergeEvidence(input: LicenceAgentInput, narrativeEvidence: ReadonlyArray<string>): string[] {
  const base = `licence_${input.licenceId}`;
  return Array.from(new Set([base, ...narrativeEvidence]));
}

function mergeCitations(
  schedule: ReadonlyArray<TenementObligation>,
  narrativeCitations: ReadonlyArray<string>,
): string[] {
  const scheduleCitations = schedule.map((o) => o.citation);
  return Array.from(new Set([...scheduleCitations, ...narrativeCitations]));
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createLicenceAgent(deps: JuniorDeps) {
  return {
    async processInput(input: LicenceAgentInput): Promise<LicenceRenewalOutput> {
      const validated = LicenceAgentInputSchema.parse(input);
      const todayIso = validated.asOf ?? isoToday();

      // Deterministic core — authoritative dates + scores.
      const schedule = computeObligationSchedule(validated, todayIso);
      const next = resolveNextObligation(schedule);
      const calendar = computeRenewalCalendar(validated.expiryDate, todayIso);
      const factors = computeDormancyFactors(validated, todayIso);
      const dormancyScore = computeDormancyScore(factors);
      const forfeitureScore = computeForfeitureRisk(schedule, next, dormancyScore);

      // LLM port — narrative only (required actions + rationale).
      const narrative = await runClaudeJunior({
        claude: deps.claude,
        logger: deps.logger,
        juniorName: 'licence-agent',
        schema: LicenceNarrativeSchema,
        systemPrompt: LICENCE_AGENT_SYSTEM_PROMPT,
        userPrompt: buildUserPrompt(validated, todayIso, schedule, next, forfeitureScore),
        model: resolveTierModelId('cheap'),
        maxTokens: 2500,
      });

      const output = assembleOutput({
        input: validated,
        schedule,
        next,
        calendar,
        factors,
        dormancyScore,
        forfeitureScore,
        narrative,
      });

      await persistDormancy(deps, validated, output);
      return output;
    },
  };
}
export type LicenceAgent = ReturnType<typeof createLicenceAgent>;

async function persistDormancy(
  deps: JuniorDeps,
  input: LicenceAgentInput,
  output: LicenceRenewalOutput,
): Promise<void> {
  if (!deps.db) return;
  try {
    const schemas = await loadJuniorSchemas();
    const licenceDormancyScores = schemas?.licenceDormancyScores as unknown;
    if (!licenceDormancyScores) return;
    await deps.db
      .insert(licenceDormancyScores)
      .values({
        id: deterministicId('licdorm', input.tenantId, input.licenceId, output.next_obligation?.due_date ?? randomUUID()),
        tenantId: input.tenantId,
        licenceId: input.licenceId,
        score: String(output.dormancy_score),
        alertLevel: output.dormancy_alert_level,
        factors: {
          ...output.dormancy_factors,
          forfeiture_risk_score: output.forfeiture_risk_score,
          forfeiture_risk_band: output.forfeiture_risk_band,
          next_obligation: output.next_obligation,
          jurisdiction: output.jurisdiction,
        },
      })
      .onConflictDoNothing();
  } catch (err) {
    deps.logger?.warn('licence-agent: dormancy write skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createDefaultLicenceAgent(): LicenceAgent {
  let cached: LicenceAgent | null = null;
  const get = async () => {
    if (cached) return cached;
    const deps = await withResolvedDb(defaultJuniorDeps());
    cached = createLicenceAgent(deps);
    return cached;
  };
  return {
    async processInput(input) {
      return (await get()).processInput(input);
    },
  };
}
