/**
 * Financial Profile Service
 *
 * SCAFFOLDED-5: Tenant financial statement intake.
 *
 *  - `submitStatement`     — persists a financial statement record and emits
 *                            `FinancialStatementSubmitted`.
 *  - `verifyBankReference` — delegates to a pluggable
 *                            `IBankReferenceProvider` (e.g. Plaid, Equity Bank
 *                            API, manual upload); updates status + score.
 *  - `recordLitigation`    — appends to `tenant_litigation_history`.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import type { EventBus, DomainEvent } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';
import { randomHex } from '../common/id-generator.js';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type FinancialStatementStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'expired';

export type BankReferenceStatus =
  | 'not_requested'
  | 'pending'
  | 'verified'
  | 'failed'
  | 'manual_override';

export type LitigationKind =
  | 'eviction'
  | 'judgment'
  | 'lawsuit_as_plaintiff'
  | 'lawsuit_as_defendant'
  | 'bankruptcy'
  | 'other';

export type LitigationOutcome =
  | 'pending'
  | 'won'
  | 'lost'
  | 'settled'
  | 'dismissed'
  | 'withdrawn';

export interface IncomeSource {
  readonly kind:
    | 'salary'
    | 'self_employment'
    | 'rental'
    | 'investments'
    | 'government'
    | 'other';
  readonly monthlyAmount: number;
  readonly description: string;
  readonly verified: boolean;
}

export interface FinancialStatement {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly customerId: string;
  readonly status: FinancialStatementStatus;
  readonly monthlyGrossIncome: number;
  readonly monthlyNetIncome: number;
  readonly otherIncome: number;
  readonly incomeCurrency: string;
  readonly incomeSources: readonly IncomeSource[];
  readonly monthlyExpenses: number;
  readonly monthlyDebtService: number;
  readonly existingArrears: number;
  readonly employmentStatus: string | null;
  readonly employerName: string | null;
  readonly employmentStartDate: ISOTimestamp | null;
  readonly bankReferenceStatus: BankReferenceStatus;
  readonly bankReferenceProvider: string | null;
  readonly bankReferenceScore: number | null;
  readonly supportingDocumentIds: readonly string[];
  readonly consentGiven: boolean;
  readonly consentGivenAt: ISOTimestamp | null;
  readonly submittedAt: ISOTimestamp | null;
  readonly submittedBy: UserId | null;
  readonly verifiedAt: ISOTimestamp | null;
  readonly verifiedBy: UserId | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export interface LitigationRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly customerId: string;
  readonly kind: LitigationKind;
  readonly outcome: LitigationOutcome;
  readonly caseNumber: string | null;
  readonly court: string | null;
  readonly jurisdiction: string | null;
  readonly filedAt: ISOTimestamp | null;
  readonly resolvedAt: ISOTimestamp | null;
  readonly amountInvolved: number | null;
  readonly currency: string | null;
  readonly summary: string | null;
  readonly disclosedBySelf: boolean;
  readonly evidenceDocumentIds: readonly string[];
  readonly createdAt: ISOTimestamp;
  readonly createdBy: UserId;
}

// ---------------------------------------------------------------------------
// Repository + provider interfaces
// ---------------------------------------------------------------------------

export interface FinancialStatementRepository {
  create(stmt: FinancialStatement): Promise<FinancialStatement>;
  update(stmt: FinancialStatement): Promise<FinancialStatement>;
  findById(
    id: string,
    tenantId: TenantId,
  ): Promise<FinancialStatement | null>;
  findLatestByCustomer(
    customerId: string,
    tenantId: TenantId,
  ): Promise<FinancialStatement | null>;
}

export interface LitigationRepository {
  create(record: LitigationRecord): Promise<LitigationRecord>;
  findByCustomer(
    customerId: string,
    tenantId: TenantId,
  ): Promise<LitigationRecord[]>;
}

export interface BankReferenceQuery {
  readonly customerId: string;
  readonly tenantId: TenantId;
  readonly statementId: string;
  readonly bankAccountLast4?: string;
  readonly bankName?: string;
}

export interface BankReferenceResult {
  readonly status: Exclude<
    BankReferenceStatus,
    'not_requested' | 'pending'
  >;
  readonly provider: string;
  /** 0..100; higher = better. Null on failure. */
  readonly score: number | null;
  readonly details: Record<string, unknown>;
  readonly receivedAt: ISOTimestamp;
}

export interface IBankReferenceProvider {
  readonly name: string;
  fetch(query: BankReferenceQuery): Promise<BankReferenceResult>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const FinancialProfileError = {
  NOT_FOUND: 'NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  CONSENT_REQUIRED: 'CONSENT_REQUIRED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;

export type FinancialProfileErrorCode =
  (typeof FinancialProfileError)[keyof typeof FinancialProfileError];

export interface FinancialProfileErrorResult {
  code: FinancialProfileErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface FinancialStatementSubmittedEvent extends DomainEvent {
  readonly eventType: 'FinancialStatementSubmitted';
  readonly payload: {
    readonly statementId: string;
    readonly customerId: string;
    readonly monthlyNetIncome: number;
    readonly incomeCurrency: string;
  };
}

export interface BankReferenceVerifiedEvent extends DomainEvent {
  readonly eventType: 'BankReferenceVerified';
  readonly payload: {
    readonly statementId: string;
    readonly customerId: string;
    readonly provider: string;
    readonly status: BankReferenceStatus;
    readonly score: number | null;
  };
}

export interface LitigationRecordedEvent extends DomainEvent {
  readonly eventType: 'LitigationRecorded';
  readonly payload: {
    readonly recordId: string;
    readonly customerId: string;
    readonly kind: LitigationKind;
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SubmitStatementInput {
  readonly customerId: string;
  readonly monthlyGrossIncome: number;
  readonly monthlyNetIncome: number;
  readonly otherIncome?: number;
  readonly incomeCurrency: string;
  readonly incomeSources: readonly IncomeSource[];
  readonly monthlyExpenses: number;
  readonly monthlyDebtService: number;
  readonly existingArrears?: number;
  readonly employmentStatus?: string;
  readonly employerName?: string;
  readonly employmentStartDate?: ISOTimestamp;
  readonly supportingDocumentIds?: readonly string[];
  readonly consentGiven: boolean;
  readonly submittedBy: UserId;
}

export interface RecordLitigationInput {
  readonly customerId: string;
  readonly kind: LitigationKind;
  readonly outcome?: LitigationOutcome;
  readonly caseNumber?: string;
  readonly court?: string;
  readonly jurisdiction?: string;
  readonly filedAt?: ISOTimestamp;
  readonly resolvedAt?: ISOTimestamp;
  readonly amountInvolved?: number;
  readonly currency?: string;
  readonly summary?: string;
  readonly disclosedBySelf: boolean;
  readonly evidenceDocumentIds?: readonly string[];
  readonly recordedBy: UserId;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class FinancialProfileService {
  constructor(
    private readonly statementRepo: FinancialStatementRepository,
    private readonly litigationRepo: LitigationRepository,
    private readonly eventBus: EventBus,
    private readonly bankProvider: IBankReferenceProvider | null = null,
  ) {}

  async submitStatement(
    tenantId: TenantId,
    input: SubmitStatementInput,
    correlationId: string,
  ): Promise<Result<FinancialStatement, FinancialProfileErrorResult>> {
    if (!input.consentGiven) {
      return this.fail('CONSENT_REQUIRED', 'Consent must be granted');
    }
    if (input.monthlyGrossIncome < 0 || input.monthlyNetIncome < 0) {
      return this.fail('INVALID_INPUT', 'Income cannot be negative');
    }
    if (input.monthlyNetIncome > input.monthlyGrossIncome) {
      return this.fail(
        'INVALID_INPUT',
        'Net income cannot exceed gross income',
      );
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const statement: FinancialStatement = {
      id: `fin_${Date.now()}_${randomHex(4)}`,
      tenantId,
      customerId: input.customerId,
      status: 'submitted',
      monthlyGrossIncome: input.monthlyGrossIncome,
      monthlyNetIncome: input.monthlyNetIncome,
      otherIncome: input.otherIncome ?? 0,
      incomeCurrency: input.incomeCurrency,
      incomeSources: input.incomeSources,
      monthlyExpenses: input.monthlyExpenses,
      monthlyDebtService: input.monthlyDebtService,
      existingArrears: input.existingArrears ?? 0,
      employmentStatus: input.employmentStatus ?? null,
      employerName: input.employerName ?? null,
      employmentStartDate: input.employmentStartDate ?? null,
      bankReferenceStatus: 'not_requested',
      bankReferenceProvider: null,
      bankReferenceScore: null,
      supportingDocumentIds: input.supportingDocumentIds ?? [],
      consentGiven: true,
      consentGivenAt: now,
      submittedAt: now,
      submittedBy: input.submittedBy,
      verifiedAt: null,
      verifiedBy: null,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.statementRepo.create(statement);

    const event: FinancialStatementSubmittedEvent = {
      eventId: generateEventId(),
      eventType: 'FinancialStatementSubmitted',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        statementId: saved.id,
        customerId: saved.customerId,
        monthlyNetIncome: saved.monthlyNetIncome,
        incomeCurrency: saved.incomeCurrency,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, saved.id, 'FinancialStatement'),
    );
    return { success: true, data: saved } as Result<
      FinancialStatement,
      FinancialProfileErrorResult
    >;
  }

  async verifyBankReference(
    statementId: string,
    tenantId: TenantId,
    query: Omit<BankReferenceQuery, 'statementId' | 'tenantId'>,
    correlationId: string,
  ): Promise<Result<FinancialStatement, FinancialProfileErrorResult>> {
    if (!this.bankProvider) {
      return this.fail(
        'PROVIDER_ERROR',
        'No bank reference provider configured',
      );
    }
    const statement = await this.statementRepo.findById(statementId, tenantId);
    if (!statement) {
      return this.fail('NOT_FOUND', 'Statement not found');
    }

    let providerResult: BankReferenceResult;
    try {
      providerResult = await this.bankProvider.fetch({
        ...query,
        customerId: statement.customerId,
        tenantId,
        statementId,
      });
    } catch (providerError) {
      const msg =
        providerError instanceof Error
          ? providerError.message
          : 'Bank provider error';
      return this.fail('PROVIDER_ERROR', msg);
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const updated: FinancialStatement = {
      ...statement,
      bankReferenceStatus: providerResult.status,
      bankReferenceProvider: providerResult.provider,
      bankReferenceScore: providerResult.score,
      updatedAt: now,
    };
    const saved = await this.statementRepo.update(updated);

    const event: BankReferenceVerifiedEvent = {
      eventId: generateEventId(),
      eventType: 'BankReferenceVerified',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        statementId: saved.id,
        customerId: saved.customerId,
        provider: providerResult.provider,
        status: providerResult.status,
        score: providerResult.score,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, saved.id, 'FinancialStatement'),
    );
    return { success: true, data: saved } as Result<
      FinancialStatement,
      FinancialProfileErrorResult
    >;
  }

  async recordLitigation(
    tenantId: TenantId,
    input: RecordLitigationInput,
    correlationId: string,
  ): Promise<Result<LitigationRecord, FinancialProfileErrorResult>> {
    const now = new Date().toISOString() as ISOTimestamp;
    const record: LitigationRecord = {
      id: `lit_${Date.now()}_${randomHex(4)}`,
      tenantId,
      customerId: input.customerId,
      kind: input.kind,
      outcome: input.outcome ?? 'pending',
      caseNumber: input.caseNumber ?? null,
      court: input.court ?? null,
      jurisdiction: input.jurisdiction ?? null,
      filedAt: input.filedAt ?? null,
      resolvedAt: input.resolvedAt ?? null,
      amountInvolved: input.amountInvolved ?? null,
      currency: input.currency ?? null,
      summary: input.summary ?? null,
      disclosedBySelf: input.disclosedBySelf,
      evidenceDocumentIds: input.evidenceDocumentIds ?? [],
      createdAt: now,
      createdBy: input.recordedBy,
    };
    const saved = await this.litigationRepo.create(record);

    const event: LitigationRecordedEvent = {
      eventId: generateEventId(),
      eventType: 'LitigationRecorded',
      timestamp: now,
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        recordId: saved.id,
        customerId: saved.customerId,
        kind: saved.kind,
      },
    };
    await this.eventBus.publish(
      createEventEnvelope(event, saved.id, 'LitigationRecord'),
    );
    return { success: true, data: saved } as Result<
      LitigationRecord,
      FinancialProfileErrorResult
    >;
  }

  private fail<T>(
    code: FinancialProfileErrorCode,
    message: string,
  ): Result<T, FinancialProfileErrorResult> {
    return { success: false, error: { code, message } } as Result<
      T,
      FinancialProfileErrorResult
    >;
  }
}
