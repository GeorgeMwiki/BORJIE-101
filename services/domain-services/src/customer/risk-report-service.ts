/**
 * Risk Report Service
 *
 * NEW-13: Generates composite tenant risk reports combining:
 *   - Deterministic payment risk score
 *   - Deterministic churn baseline
 *   - Latest financial statement summary
 *   - Litigation history count
 *
 * The LLM is invoked ONLY to narrate the already-computed scores and produce
 * human-readable recommendations — it never overrides the numbers.
 */

import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import { randomHex } from '../common/id-generator.js';

export type RiskReportStatus = 'draft' | 'generated' | 'archived';

export interface RiskReportSnapshot {
  readonly payment: {
    readonly score: number;
    readonly level: string;
    readonly subScores: Record<string, number>;
  };
  readonly churn: {
    readonly score: number;
    readonly level: string;
    readonly subScores: Record<string, number>;
  };
  readonly financial: {
    readonly statementId: string | null;
    readonly monthlyNetIncome: number;
    readonly existingArrears: number;
    readonly bankReferenceStatus: string;
  };
  readonly litigation: {
    readonly count: number;
    readonly evictions: number;
    readonly judgments: number;
  };
}

export interface RiskReportRecommendation {
  readonly title: string;
  readonly detail: string;
  readonly priority: 'critical' | 'high' | 'medium' | 'low';
}

export interface TenantRiskReport {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly customerId: string;
  readonly status: RiskReportStatus;
  readonly reportVersion: string;
  readonly paymentRiskScore: number;
  readonly paymentRiskLevel: string;
  readonly churnRiskScore: number;
  readonly churnRiskLevel: string;
  readonly financialStatementId: string | null;
  readonly litigationCount: number;
  readonly snapshot: RiskReportSnapshot;
  readonly narrative: string | null;
  readonly recommendations: readonly RiskReportRecommendation[];
  readonly generatedAt: ISOTimestamp | null;
  readonly generatedBy: UserId | null;
  readonly generatedByModel: string | null;
  readonly createdAt: ISOTimestamp;
  readonly updatedAt: ISOTimestamp;
}

export interface RiskReportRepository {
  create(report: TenantRiskReport): Promise<TenantRiskReport>;
  findLatestByCustomer(
    customerId: string,
    tenantId: TenantId,
  ): Promise<TenantRiskReport | null>;
}

/** Narrator contract — thin wrapper so the service doesn't import Anthropic directly. */
export interface RiskNarrator {
  narrate(params: {
    readonly customerId: string;
    readonly snapshot: RiskReportSnapshot;
  }): Promise<{
    readonly narrative: string;
    readonly recommendations: readonly RiskReportRecommendation[];
    readonly modelId: string;
  }>;
}

/** Provider for the deterministic inputs the service composes. */
export interface RiskReportInputsProvider {
  collect(params: {
    readonly tenantId: TenantId;
    readonly customerId: string;
  }): Promise<RiskReportSnapshot>;
}

export const RiskReportError = {
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  NARRATION_FAILED: 'NARRATION_FAILED',
} as const;

export type RiskReportErrorCode =
  (typeof RiskReportError)[keyof typeof RiskReportError];

export interface RiskReportErrorResult {
  code: RiskReportErrorCode;
  message: string;
}

export class RiskReportService {
  constructor(
    private readonly repo: RiskReportRepository,
    private readonly inputs: RiskReportInputsProvider,
    private readonly narrator: RiskNarrator,
  ) {}

  async generate(
    tenantId: TenantId,
    customerId: string,
    generatedBy: UserId,
  ): Promise<Result<TenantRiskReport, RiskReportErrorResult>> {
    const snapshot = await this.inputs.collect({ tenantId, customerId });

    let narration: Awaited<ReturnType<RiskNarrator['narrate']>>;
    try {
      narration = await this.narrator.narrate({ customerId, snapshot });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Narration failed';
      return {
        success: false,
        error: { code: 'NARRATION_FAILED', message: msg },
      } as Result<TenantRiskReport, RiskReportErrorResult>;
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const report: TenantRiskReport = {
      id: `risk_${Date.now()}_${randomHex(4)}`,
      tenantId,
      customerId,
      status: 'generated',
      reportVersion: 'v1',
      paymentRiskScore: snapshot.payment.score,
      paymentRiskLevel: snapshot.payment.level,
      churnRiskScore: snapshot.churn.score,
      churnRiskLevel: snapshot.churn.level,
      financialStatementId: snapshot.financial.statementId,
      litigationCount: snapshot.litigation.count,
      snapshot,
      narrative: narration.narrative,
      recommendations: narration.recommendations,
      generatedAt: now,
      generatedBy,
      generatedByModel: narration.modelId,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repo.create(report);
    return { success: true, data: saved } as Result<
      TenantRiskReport,
      RiskReportErrorResult
    >;
  }

  async getLatest(
    tenantId: TenantId,
    customerId: string,
  ): Promise<Result<TenantRiskReport, RiskReportErrorResult>> {
    const found = await this.repo.findLatestByCustomer(customerId, tenantId);
    if (!found) {
      return {
        success: false,
        error: { code: 'NOT_FOUND', message: 'No risk report found' },
      } as Result<TenantRiskReport, RiskReportErrorResult>;
    }
    return { success: true, data: found } as Result<
      TenantRiskReport,
      RiskReportErrorResult
    >;
  }
}
