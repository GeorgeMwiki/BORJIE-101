// @ts-nocheck — TODO(borjie-hard-fork): property-domain repository pending mining-equivalent rewrite.
/**
 * Postgres-backed Risk Report Repository (NEW-13)
 *
 * Implements RiskReportRepository against `tenant_risk_reports`. Tenant
 * isolation is enforced on every query (WHERE tenant_id = :ctx).
 *
 * Also ships a deterministic Inputs Provider (`PostgresRiskReportInputsProvider`)
 * and a no-LLM narrator fallback (`DeterministicRiskNarrator`) so the
 * service produces a non-empty report even without Anthropic creds.
 */

import { and, count, desc, eq } from 'drizzle-orm';
import {
  tenantRiskReports,
  tenantFinancialStatements,
  tenantLitigationHistory,
} from '@borjie/database';
import type { TenantId, ISOTimestamp, UserId } from '@borjie/domain-models';
import type {
  TenantRiskReport,
  RiskReportRepository,
  RiskReportInputsProvider,
  RiskReportSnapshot,
  RiskReportStatus,
  RiskReportRecommendation,
  RiskNarrator,
} from './risk-report-service.js';

export interface DrizzleLike {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
}

function toIso(d: Date | string | null | undefined): ISOTimestamp | null {
  if (!d) return null;
  return (d instanceof Date ? d.toISOString() : String(d)) as ISOTimestamp;
}

function rowToReport(row: Record<string, any>): TenantRiskReport {
  return {
    id: row.id,
    tenantId: row.tenantId as TenantId,
    customerId: row.customerId,
    status: (row.status ?? 'generated') as RiskReportStatus,
    reportVersion: String(row.reportVersion ?? 'v1'),
    paymentRiskScore: Number(row.paymentRiskScore ?? 0),
    paymentRiskLevel: String(row.paymentRiskLevel ?? 'unknown'),
    churnRiskScore: Number(row.churnRiskScore ?? 0),
    churnRiskLevel: String(row.churnRiskLevel ?? 'unknown'),
    financialStatementId: row.financialStatementId ?? null,
    litigationCount: Number(row.litigationCount ?? 0),
    snapshot: (row.snapshot ?? {
      payment: { score: 0, level: 'unknown', subScores: {} },
      churn: { score: 0, level: 'unknown', subScores: {} },
      financial: {
        statementId: null,
        monthlyNetIncome: 0,
        existingArrears: 0,
        bankReferenceStatus: 'not_requested',
      },
      litigation: { count: 0, evictions: 0, judgments: 0 },
    }) as RiskReportSnapshot,
    narrative: row.narrative ?? null,
    recommendations: (row.recommendations ?? []) as readonly RiskReportRecommendation[],
    generatedAt: toIso(row.generatedAt),
    generatedBy: (row.generatedBy ?? null) as UserId | null,
    generatedByModel: row.generatedByModel ?? null,
    createdAt: toIso(row.createdAt) ?? ('' as ISOTimestamp),
    updatedAt: toIso(row.updatedAt) ?? ('' as ISOTimestamp),
  };
}

export class PostgresRiskReportRepository implements RiskReportRepository {
  constructor(private readonly db: DrizzleLike) {}

  async create(report: TenantRiskReport): Promise<TenantRiskReport> {
    await this.db.insert(tenantRiskReports).values({
      id: report.id,
      tenantId: report.tenantId as unknown as string,
      customerId: report.customerId,
      status: report.status,
      reportVersion: report.reportVersion,
      paymentRiskScore: report.paymentRiskScore,
      paymentRiskLevel: report.paymentRiskLevel,
      churnRiskScore: report.churnRiskScore,
      churnRiskLevel: report.churnRiskLevel,
      financialStatementId: report.financialStatementId,
      litigationCount: report.litigationCount,
      snapshot: report.snapshot,
      narrative: report.narrative,
      recommendations: report.recommendations,
      generatedAt: report.generatedAt ? new Date(report.generatedAt) : null,
      generatedBy: report.generatedBy,
      generatedByModel: report.generatedByModel,
      createdAt: new Date(report.createdAt ?? Date.now()),
      updatedAt: new Date(report.updatedAt ?? Date.now()),
    });
    return report;
  }

  async findLatestByCustomer(
    customerId: string,
    tenantId: TenantId
  ): Promise<TenantRiskReport | null> {
    const rows = await this.db
      .select()
      .from(tenantRiskReports)
      .where(
        and(
          eq(tenantRiskReports.customerId, customerId),
          eq(tenantRiskReports.tenantId, tenantId as unknown as string)
        )
      )
      .orderBy(desc(tenantRiskReports.generatedAt))
      .limit(1);
    return rows[0] ? rowToReport(rows[0]) : null;
  }
}

/** Deterministic narrator used when no LLM backend is configured. */
export class DeterministicRiskNarrator implements RiskNarrator {
  async narrate(params: {
    readonly customerId: string;
    readonly snapshot: RiskReportSnapshot;
  }): Promise<{
    readonly narrative: string;
    readonly recommendations: readonly RiskReportRecommendation[];
    readonly modelId: string;
  }> {
    const paymentLevel = params.snapshot.payment.level;
    const churnLevel = params.snapshot.churn.level;
    const narrative =
      `Customer ${params.customerId}: payment risk ${paymentLevel} ` +
      `(score ${params.snapshot.payment.score}/100), churn risk ${churnLevel} ` +
      `(score ${params.snapshot.churn.score}/100). Financial profile on file: ` +
      `${params.snapshot.financial.statementId ? 'yes' : 'no'}. ` +
      `Litigation history: ${params.snapshot.litigation.count} record(s).`;

    const recs: RiskReportRecommendation[] = [];
    if (
      params.snapshot.payment.score >= 60 ||
      params.snapshot.churn.score >= 60
    ) {
      recs.push({
        title: 'Flag for proactive outreach',
        detail:
          'Combined payment and/or churn scores exceed 60. Schedule a tenant relationship check-in within 30 days.',
        priority: 'high',
      });
    }
    if (params.snapshot.litigation.evictions > 0) {
      recs.push({
        title: 'Review eviction history',
        detail:
          'Customer has prior eviction records. Verify current compliance and consider enhanced monitoring.',
        priority: 'critical',
      });
    }

    return {
      narrative,
      recommendations: recs,
      modelId: 'deterministic-risk-narrator-v1',
    };
  }
}

/** Deterministic inputs provider — composes snapshot from DB tables. */
export class PostgresRiskReportInputsProvider
  implements RiskReportInputsProvider
{
  constructor(private readonly db: DrizzleLike) {}

  async collect(params: {
    readonly tenantId: TenantId;
    readonly customerId: string;
  }): Promise<RiskReportSnapshot> {
    // Latest financial statement
    const stmtRows = await this.db
      .select()
      .from(tenantFinancialStatements)
      .where(
        and(
          eq(tenantFinancialStatements.customerId, params.customerId),
          eq(
            tenantFinancialStatements.tenantId,
            params.tenantId as unknown as string
          )
        )
      )
      .orderBy(desc(tenantFinancialStatements.createdAt))
      .limit(1);
    const stmt = stmtRows[0] ?? null;

    // Litigation counts
    const litRows = await this.db
      .select()
      .from(tenantLitigationHistory)
      .where(
        and(
          eq(tenantLitigationHistory.customerId, params.customerId),
          eq(
            tenantLitigationHistory.tenantId,
            params.tenantId as unknown as string
          )
        )
      );
    const litigationCount = litRows.length;
    const evictions = litRows.filter(
      (r: any) => String(r.kind) === 'eviction'
    ).length;
    const judgments = litRows.filter(
      (r: any) => String(r.kind) === 'judgment'
    ).length;

    // Deterministic payment-risk computation — simple rule engine.
    const existingArrears = Number(stmt?.existingArrears ?? 0);
    const monthlyNet = Number(stmt?.monthlyNetIncome ?? 0);
    const monthlyDebtService = Number(stmt?.monthlyDebtService ?? 0);
    let paymentScore = 20;
    if (existingArrears > 0) paymentScore += 30;
    if (monthlyNet > 0 && monthlyDebtService / Math.max(1, monthlyNet) > 0.4) {
      paymentScore += 25;
    }
    if (evictions > 0) paymentScore += 25;
    paymentScore = Math.max(0, Math.min(100, paymentScore));
    const paymentLevel =
      paymentScore >= 75 ? 'high' : paymentScore >= 50 ? 'medium' : 'low';

    // Churn: baseline score, influenced by no financial statement on file.
    let churnScore = 25;
    if (!stmt) churnScore += 20;
    if (litigationCount > 0) churnScore += 15;
    churnScore = Math.max(0, Math.min(100, churnScore));
    const churnLevel =
      churnScore >= 75 ? 'high' : churnScore >= 50 ? 'medium' : 'low';

    return {
      payment: {
        score: paymentScore,
        level: paymentLevel,
        subScores: {
          arrears: existingArrears > 0 ? 30 : 0,
          debtService: monthlyDebtService,
          evictionHistory: evictions * 25,
        },
      },
      churn: {
        score: churnScore,
        level: churnLevel,
        subScores: {
          missingProfile: stmt ? 0 : 20,
          litigation: litigationCount * 5,
        },
      },
      financial: {
        statementId: stmt?.id ?? null,
        monthlyNetIncome: monthlyNet,
        existingArrears,
        bankReferenceStatus: String(stmt?.bankReferenceStatus ?? 'not_requested'),
      },
      litigation: {
        count: litigationCount,
        evictions,
        judgments,
      },
    };
  }
}