/**
 * Mining Buyer Financial-Profile Service (Borjie mining domain).
 *
 * Bridges the legacy `/financial-profile` route surface to the REAL
 * mining buyer repositories. The route was authored for the retired
 * property-tenant "financial statement / litigation / risk report"
 * stack; this service re-maps each endpoint onto a mineral
 * buyer/off-taker's credit + AML + banking aggregate:
 *
 *   submitStatement      → derive a credit limit from the submitted
 *                          statement and persist it via the buyer
 *                          financial-profile repo (+ payment-track row).
 *   verifyBankReference  → read-only match of a claimed bank reference
 *                          against the banking already on file.
 *   recordLitigation     → adverse litigation against a buyer is a
 *                          counterparty-risk signal → AML flag.
 *
 * Tenant isolation: every repo call is passed `tenantId`; the repos bind
 * `app.current_tenant_id` and filter by it under RLS FORCE. This service
 * NEVER double-filters and NEVER mutates aggregates in place.
 */

import { z } from 'zod';
import { ok, err, type Result, type TenantId } from '@borjie/domain-models';
import type {
  BuyerFinancialProfileRepository,
  BuyerFinancialProfile,
} from '../buyer/postgres-buyer-financial-profile-repository.js';
import type {
  BuyerRiskReportRepository,
  BuyerRiskReport,
  BuyerRiskLevel,
} from '../buyer/postgres-buyer-risk-report-repository.js';
import {
  deriveCreditLimit,
  statementPaymentEntry,
  verifyBankReference as matchBankReference,
  litigationConcernReason,
  formatCurrency,
  type BankReferenceVerdict,
} from './mining-financial-profile-helpers.js';

// ---------------------------------------------------------------------------
// Minimal Pino-shaped logger (no console.log; injectable, defaults to no-op)
// ---------------------------------------------------------------------------

export interface ProfileLogger {
  info: (obj: Record<string, unknown>, msg?: string) => void;
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
}

const NOOP_LOGGER: ProfileLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export const MiningFinancialProfileError = {
  BUYER_NOT_FOUND: 'BUYER_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  PERSIST_FAILED: 'PERSIST_FAILED',
} as const;

export type MiningFinancialProfileErrorCode =
  (typeof MiningFinancialProfileError)[keyof typeof MiningFinancialProfileError];

// ---------------------------------------------------------------------------
// Inbound schemas — validate the route payloads (defence in depth on top of
// the router's zValidator) and re-map property-era field names to mining.
// ---------------------------------------------------------------------------

const incomeSourceSchema = z.object({
  kind: z.enum([
    'salary',
    'self_employment',
    'rental',
    'investments',
    'government',
    'other',
  ]),
  monthlyAmount: z.number().int().nonnegative(),
  description: z.string().max(500),
  verified: z.boolean().default(false),
});

export const submitStatementSchema = z.object({
  customerId: z.string().min(1),
  monthlyGrossIncome: z.number().int().nonnegative(),
  monthlyNetIncome: z.number().int().nonnegative(),
  otherIncome: z.number().int().nonnegative().optional(),
  incomeCurrency: z.string().min(3).max(4),
  incomeSources: z.array(incomeSourceSchema).max(50),
  monthlyExpenses: z.number().int().nonnegative(),
  monthlyDebtService: z.number().int().nonnegative(),
  existingArrears: z.number().int().nonnegative().optional(),
  employmentStatus: z.string().max(100).optional(),
  employerName: z.string().max(200).optional(),
  employmentStartDate: z.string().optional(),
  supportingDocumentIds: z.array(z.string()).max(50).optional(),
  consentGiven: z.literal(true),
  submittedBy: z.string().min(1),
});

export type SubmitStatementInput = z.infer<typeof submitStatementSchema>;

export const bankReferenceSchema = z.object({
  bankAccountLast4: z.string().length(4).optional(),
  bankName: z.string().max(200).optional(),
});

export type BankReferenceInput = z.infer<typeof bankReferenceSchema>;

export const recordLitigationSchema = z.object({
  customerId: z.string().min(1),
  kind: z.enum([
    'eviction',
    'judgment',
    'lawsuit_as_plaintiff',
    'lawsuit_as_defendant',
    'bankruptcy',
    'other',
  ]),
  outcome: z
    .enum(['pending', 'won', 'lost', 'settled', 'dismissed', 'withdrawn'])
    .optional(),
  caseNumber: z.string().max(100).optional(),
  court: z.string().max(200).optional(),
  jurisdiction: z.string().max(200).optional(),
  filedAt: z.string().optional(),
  resolvedAt: z.string().optional(),
  amountInvolved: z.number().int().nonnegative().optional(),
  currency: z.string().min(3).max(4).optional(),
  summary: z.string().max(2000).optional(),
  disclosedBySelf: z.boolean().default(false),
  evidenceDocumentIds: z.array(z.string()).max(50).optional(),
  recordedBy: z.string().min(1),
});

export type RecordLitigationInput = z.infer<typeof recordLitigationSchema>;

// ---------------------------------------------------------------------------
// Outbound shapes (route response bodies)
// ---------------------------------------------------------------------------

/** Buyer financial profile enriched with rendered money for display. */
export interface BuyerProfileView extends BuyerFinancialProfile {
  readonly creditLimitDisplay: string | null;
  readonly currencyCode: string | null;
}

export interface StatementSubmissionResult {
  readonly profile: BuyerProfileView;
  readonly derivedCreditLimit: number;
  readonly arrearsFlagged: boolean;
}

export interface LitigationRecordResult {
  readonly profile: BuyerProfileView;
  readonly amlStatus: BuyerFinancialProfile['amlStatus'];
  readonly riskReport: BuyerRiskReport | null;
}

export interface MiningFinancialProfileServiceError {
  readonly code: MiningFinancialProfileErrorCode;
  readonly message: string;
}

const COVERAGE_MONTHS = 6;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface MiningFinancialProfileServiceDeps {
  readonly financialProfileRepo: BuyerFinancialProfileRepository;
  readonly riskReportRepo: BuyerRiskReportRepository;
  readonly logger?: ProfileLogger;
  /** Override for deterministic timestamps/ids in tests. */
  readonly clock?: () => Date;
  /**
   * ISO-4217 code the buyer-profile repo's `*Tzs` money columns are
   * denominated in. Injected (never hard-coded in this service) — the
   * composition root sources it from the tenant's primary currency /
   * the canonical currency registry. When omitted, repo-only money is
   * returned as raw numbers with a `null` rendered display.
   */
  readonly storageCurrency?: string;
}

export class MiningFinancialProfileService {
  private readonly financialProfileRepo: BuyerFinancialProfileRepository;
  private readonly riskReportRepo: BuyerRiskReportRepository;
  private readonly logger: ProfileLogger;
  private readonly clock: () => Date;
  private readonly storageCurrency: string | null;

  constructor(deps: MiningFinancialProfileServiceDeps) {
    this.financialProfileRepo = deps.financialProfileRepo;
    this.riskReportRepo = deps.riskReportRepo;
    this.logger = deps.logger ?? NOOP_LOGGER;
    this.clock = deps.clock ?? (() => new Date());
    this.storageCurrency = deps.storageCurrency ?? null;
  }

  /**
   * Submit a financial statement for a mining buyer. Derives a credit
   * limit from disposable income, persists it, and appends a payment-
   * track row. Outstanding arrears raise an AML concern.
   */
  async submitStatement(
    tenantId: TenantId,
    rawInput: unknown,
    correlationId: string,
  ): Promise<Result<StatementSubmissionResult, MiningFinancialProfileServiceError>> {
    const parsed = submitStatementSchema.safeParse(rawInput);
    if (!parsed.success) {
      return err(invalidInput(parsed.error.message));
    }
    const input = parsed.data;
    const buyerId = input.customerId;
    const existingArrears = input.existingArrears ?? 0;
    const creditLimit = deriveCreditLimit({
      monthlyNetIncome: input.monthlyNetIncome,
      otherIncome: input.otherIncome ?? 0,
      monthlyExpenses: input.monthlyExpenses,
      monthlyDebtService: input.monthlyDebtService,
      existingArrears,
      coverageMonths: COVERAGE_MONTHS,
    });

    try {
      const existing = await this.financialProfileRepo.getFinancialProfile(
        buyerId,
        tenantId,
      );
      if (!existing) {
        return err(buyerNotFound(buyerId));
      }
      const profile = await this.persistStatement(tenantId, input, creditLimit);
      const arrearsFlagged = existingArrears > 0;
      this.logger.info(
        { tenantId, buyerId, creditLimit, arrearsFlagged, correlationId },
        'mining buyer financial statement submitted',
      );
      return ok({
        profile: toProfileView(profile, input.incomeCurrency),
        derivedCreditLimit: creditLimit,
        arrearsFlagged,
      });
    } catch (error) {
      this.logger.error(
        { tenantId, buyerId, correlationId, err: String(error) },
        'submitStatement failed',
      );
      return err(persistFailed('submitStatement', error));
    }
  }

  /**
   * Persist a validated statement: set the derived credit limit, append a
   * payment-track row, and flag AML when arrears were declared. Returns
   * the freshly-read profile aggregate (never patched in place).
   */
  private async persistStatement(
    tenantId: TenantId,
    input: SubmitStatementInput,
    creditLimit: number,
  ): Promise<BuyerFinancialProfile> {
    const buyerId = input.customerId;
    const submittedAt = this.clock().toISOString();
    const disposableMonthly =
      input.monthlyNetIncome +
      (input.otherIncome ?? 0) -
      input.monthlyExpenses -
      input.monthlyDebtService;

    await this.financialProfileRepo.updateCreditLimit(
      buyerId,
      tenantId,
      creditLimit,
    );
    await this.financialProfileRepo.recordPayment(
      buyerId,
      tenantId,
      statementPaymentEntry({
        statementId: `${buyerId}:${submittedAt}`,
        disposableMonthly,
        currencyCode: input.incomeCurrency,
        submittedAt,
      }),
    );

    const existingArrears = input.existingArrears ?? 0;
    if (existingArrears > 0) {
      return this.financialProfileRepo.flagAmlConcern(
        buyerId,
        tenantId,
        `Outstanding arrears of ${formatCurrency(existingArrears, input.incomeCurrency)} declared by ${input.submittedBy}.`,
      );
    }
    return this.requireProfile(buyerId, tenantId);
  }

  /**
   * Verify a claimed bank reference against the banking on file for the
   * buyer. Read-only: returns a structured match verdict, no mutation.
   * `buyerId` is the `:id` route param (the buyer the statement belongs to).
   */
  async verifyBankReference(
    buyerId: string,
    tenantId: TenantId,
    rawInput: unknown,
    correlationId: string,
  ): Promise<Result<BankReferenceVerdict, MiningFinancialProfileServiceError>> {
    const parsed = bankReferenceSchema.safeParse(rawInput);
    if (!parsed.success) {
      return err(invalidInput(parsed.error.message));
    }
    try {
      const profile = await this.financialProfileRepo.getFinancialProfile(
        buyerId,
        tenantId,
      );
      if (!profile) {
        return err(buyerNotFound(buyerId));
      }
      const verdict = matchBankReference(profile, parsed.data);
      this.logger.info(
        { tenantId, buyerId, verified: verdict.verified, correlationId },
        'mining buyer bank reference verified',
      );
      return ok(verdict);
    } catch (error) {
      this.logger.error(
        { tenantId, buyerId, correlationId, err: String(error) },
        'verifyBankReference failed',
      );
      return err(persistFailed('verifyBankReference', error));
    }
  }

  /**
   * Record adverse litigation against a mining buyer. Litigation is a
   * counterparty-risk signal, so it raises an AML concern on the buyer's
   * profile and emits a fresh risk report capturing the event.
   */
  async recordLitigation(
    tenantId: TenantId,
    rawInput: unknown,
    correlationId: string,
  ): Promise<Result<LitigationRecordResult, MiningFinancialProfileServiceError>> {
    const parsed = recordLitigationSchema.safeParse(rawInput);
    if (!parsed.success) {
      return err(invalidInput(parsed.error.message));
    }
    const input = parsed.data;
    const buyerId = input.customerId;
    try {
      const existing = await this.financialProfileRepo.getFinancialProfile(
        buyerId,
        tenantId,
      );
      if (!existing) {
        return err(buyerNotFound(buyerId));
      }
      const profile = await this.financialProfileRepo.flagAmlConcern(
        buyerId,
        tenantId,
        litigationConcernReason(input),
      );
      const riskReport = await this.emitLitigationRiskReport(
        tenantId,
        buyerId,
        input,
      );
      this.logger.warn(
        { tenantId, buyerId, kind: input.kind, correlationId },
        'mining buyer litigation recorded — AML concern raised',
      );
      const currencyCode = input.currency ?? this.storageCurrency;
      return ok({
        profile: toProfileView(profile, currencyCode),
        amlStatus: profile.amlStatus,
        riskReport,
      });
    } catch (error) {
      this.logger.error(
        { tenantId, buyerId, correlationId, err: String(error) },
        'recordLitigation failed',
      );
      return err(persistFailed('recordLitigation', error));
    }
  }

  /** Most-recent risk report for a buyer (read passthrough). */
  async getLatestRiskReport(
    buyerId: string,
    tenantId: TenantId,
  ): Promise<BuyerRiskReport | null> {
    return this.riskReportRepo.findLatestByBuyer(buyerId, tenantId);
  }

  private async emitLitigationRiskReport(
    tenantId: TenantId,
    buyerId: string,
    input: RecordLitigationInput,
  ): Promise<BuyerRiskReport> {
    const now = this.clock();
    const sanctionsHit = input.kind === 'bankruptcy' ? 1 : 0;
    const score = litigationRiskScore(input);
    return this.riskReportRepo.createReport(tenantId, {
      id: `brr_${now.getTime()}_${buyerId}`,
      buyerId,
      score0100: score,
      riskLevel: scoreToLevel(score),
      dimensions: {
        kyc: score,
        sanctions: sanctionsHit,
        refineryConcentration: 0,
        countryRisk: 0,
      },
      narrative: litigationConcernReason(input),
      recommendations: [
        {
          title: 'Review counterparty exposure',
          detail: `Litigation (${input.kind}) recorded; re-assess open positions and credit limit for buyer ${buyerId}.`,
          priority: scoreToLevel(score) === 'low' ? 'medium' : 'high',
        },
      ],
      expiresAt: null,
      generatedByModel: null,
    });
  }

  private async requireProfile(
    buyerId: string,
    tenantId: TenantId,
  ): Promise<BuyerFinancialProfile> {
    const profile = await this.financialProfileRepo.getFinancialProfile(
      buyerId,
      tenantId,
    );
    if (!profile) {
      throw new Error(`buyer ${buyerId} vanished mid-transaction`);
    }
    return profile;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createMiningFinancialProfileService(
  deps: MiningFinancialProfileServiceDeps,
): MiningFinancialProfileService {
  return new MiningFinancialProfileService(deps);
}

// ---------------------------------------------------------------------------
// Internal pure helpers
// ---------------------------------------------------------------------------

function toProfileView(
  profile: BuyerFinancialProfile,
  currencyCode: string | null,
): BuyerProfileView {
  return {
    ...profile,
    currencyCode,
    creditLimitDisplay:
      profile.creditLimitTzs == null || currencyCode == null
        ? null
        : formatCurrency(profile.creditLimitTzs, currencyCode),
  };
}

function litigationRiskScore(input: RecordLitigationInput): number {
  const base: Record<RecordLitigationInput['kind'], number> = {
    bankruptcy: 85,
    judgment: 70,
    lawsuit_as_defendant: 55,
    eviction: 45,
    lawsuit_as_plaintiff: 25,
    other: 30,
  };
  const unresolved = input.outcome == null || input.outcome === 'pending';
  const lost = input.outcome === 'lost';
  const delta = lost ? 10 : unresolved ? 5 : -10;
  return Math.max(0, Math.min(100, base[input.kind] + delta));
}

function scoreToLevel(score: number): BuyerRiskLevel {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

function invalidInput(message: string): MiningFinancialProfileServiceError {
  return { code: MiningFinancialProfileError.INVALID_INPUT, message };
}

function buyerNotFound(buyerId: string): MiningFinancialProfileServiceError {
  return {
    code: MiningFinancialProfileError.BUYER_NOT_FOUND,
    message: `Buyer ${buyerId} not found in this tenant.`,
  };
}

function persistFailed(
  op: string,
  error: unknown,
): MiningFinancialProfileServiceError {
  return {
    code: MiningFinancialProfileError.PERSIST_FAILED,
    message: `Mining financial-profile ${op} failed: ${String(error)}`,
  };
}
