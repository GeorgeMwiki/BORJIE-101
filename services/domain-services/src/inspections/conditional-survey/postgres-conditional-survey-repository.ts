/**
 * Postgres-backed Conditional Survey Repository (Wave 3).
 *
 * Implements ConditionalSurveyRepository against the conditional-survey
 * tables (migration 0018). The survey object is denormalised from three
 * tables on read:
 *   - conditional_surveys        (the header record)
 *   - conditional_survey_findings
 *   - conditional_survey_action_plans
 *
 * Tenant isolation is enforced on every query via WHERE tenant_id = :ctx.
 * Findings are append-only; action plans are CRUD (status transitions).
 *
 * Spec: NEW 2.
 */

import { and, eq, lt } from 'drizzle-orm';
import {
  conditionalSurveys,
  conditionalSurveyFindings,
  conditionalSurveyActionPlans,
} from '@borjie/database';
import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  ISOTimestamp,
} from '@borjie/domain-models';
import { getDefaultCurrency } from '@borjie/domain-models';
import type {
  ConditionalSurvey,
  ConditionalSurveyId,
  ConditionalSurveyFinding,
  ConditionalSurveyFindingId,
  ConditionalSurveyActionPlan,
  ConditionalSurveyActionPlanId,
  ConditionalSurveyRepository,
  ConditionalSurveyStatus,
  ConditionalSurveySeverity,
  ConditionalSurveyActionStatus,
} from './types.js';
import {
  asConditionalSurveyId,
  asConditionalSurveyFindingId,
  asConditionalSurveyActionPlanId,
} from './types.js';
import type { InspectionId } from '../types.js';

export interface PostgresConditionalSurveyRepositoryClient {
  select: (...args: unknown[]) => any;
  insert: (...args: unknown[]) => any;
  update: (...args: unknown[]) => any;
}

export class PostgresConditionalSurveyRepository
  implements ConditionalSurveyRepository
{
  constructor(private readonly db: PostgresConditionalSurveyRepositoryClient) {}

  async findById(
    id: ConditionalSurveyId,
    tenantId: TenantId
  ): Promise<ConditionalSurvey | null> {
    const rows = await this.db
      .select()
      .from(conditionalSurveys)
      .where(
        and(
          eq(conditionalSurveys.id, id as unknown as string),
          eq(conditionalSurveys.tenantId, tenantId as unknown as string)
        )
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const findings = await this.loadFindings(id, tenantId);
    const actionPlans = await this.loadActionPlans(id, tenantId);
    return rowToSurvey(row, findings, actionPlans);
  }

  async create(survey: ConditionalSurvey): Promise<ConditionalSurvey> {
    await this.db.insert(conditionalSurveys).values(surveyToRow(survey));
    // Children (findings / action plans) created via their own add* methods.
    return survey;
  }

  async update(survey: ConditionalSurvey): Promise<ConditionalSurvey> {
    await this.db
      .update(conditionalSurveys)
      .set(surveyToRow(survey))
      .where(
        and(
          eq(conditionalSurveys.id, survey.id as unknown as string),
          eq(conditionalSurveys.tenantId, survey.tenantId as unknown as string)
        )
      );
    return survey;
  }

  async addFinding(
    finding: ConditionalSurveyFinding
  ): Promise<ConditionalSurveyFinding> {
    await this.db.insert(conditionalSurveyFindings).values(findingToRow(finding));
    return finding;
  }

  async addActionPlan(
    plan: ConditionalSurveyActionPlan
  ): Promise<ConditionalSurveyActionPlan> {
    await this.db.insert(conditionalSurveyActionPlans).values(planToRow(plan));
    return plan;
  }

  async updateActionPlan(
    plan: ConditionalSurveyActionPlan
  ): Promise<ConditionalSurveyActionPlan> {
    await this.db
      .update(conditionalSurveyActionPlans)
      .set(planToRow(plan))
      .where(
        and(
          eq(conditionalSurveyActionPlans.id, plan.id as unknown as string),
          eq(
            conditionalSurveyActionPlans.tenantId,
            plan.tenantId as unknown as string
          )
        )
      );
    return plan;
  }

  // -------------------------------------------------------------------------
  // Amendment operations (Wave 3) — SLA worker support
  // -------------------------------------------------------------------------

  async findOverdue(
    tenantId: TenantId,
    cutoffDate: ISOTimestamp
  ): Promise<readonly ConditionalSurvey[]> {
    const rows = await this.db
      .select()
      .from(conditionalSurveys)
      .where(
        and(
          eq(conditionalSurveys.tenantId, tenantId as unknown as string),
          lt(conditionalSurveys.scheduledAt, new Date(cutoffDate))
        )
      );

    const out: ConditionalSurvey[] = [];
    for (const row of rows) {
      const surveyId = asConditionalSurveyId(row.id);
      const findings = await this.loadFindings(surveyId, tenantId);
      const actionPlans = await this.loadActionPlans(surveyId, tenantId);
      out.push(rowToSurvey(row, findings, actionPlans));
    }
    return out;
  }

  private async loadFindings(
    surveyId: ConditionalSurveyId,
    tenantId: TenantId
  ): Promise<readonly ConditionalSurveyFinding[]> {
    const rows = await this.db
      .select()
      .from(conditionalSurveyFindings)
      .where(
        and(
          eq(conditionalSurveyFindings.surveyId, surveyId as unknown as string),
          eq(conditionalSurveyFindings.tenantId, tenantId as unknown as string)
        )
      );
    return rows.map(rowToFinding);
  }

  private async loadActionPlans(
    surveyId: ConditionalSurveyId,
    tenantId: TenantId
  ): Promise<readonly ConditionalSurveyActionPlan[]> {
    const rows = await this.db
      .select()
      .from(conditionalSurveyActionPlans)
      .where(
        and(
          eq(conditionalSurveyActionPlans.surveyId, surveyId as unknown as string),
          eq(conditionalSurveyActionPlans.tenantId, tenantId as unknown as string)
        )
      );
    return rows.map(rowToPlan);
  }
}

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toDate(v: ISOTimestamp | null | undefined): Date | null {
  if (!v) return null;
  return typeof v === 'string' ? new Date(v) : v;
}

function fromDate(v: Date | string | null | undefined): ISOTimestamp | null {
  if (!v) return null;
  return (v instanceof Date ? v.toISOString() : v) as ISOTimestamp;
}

function surveyToRow(survey: ConditionalSurvey): Record<string, unknown> {
  return {
    id: survey.id as unknown as string,
    tenantId: survey.tenantId as unknown as string,
    propertyId: survey.propertyId as unknown as string,
    unitId: (survey.unitId as unknown as string) ?? null,
    sourceInspectionId: (survey.sourceInspectionId as unknown as string) ?? null,
    surveyorId: (survey.surveyorId as unknown as string) ?? null,
    status: survey.status,
    scheduledAt: toDate(survey.scheduledAt ?? undefined),
    startedAt: toDate(survey.startedAt ?? undefined),
    compiledAt: toDate(survey.compiledAt ?? undefined),
    approvedAt: toDate(survey.approvedAt ?? undefined),
    narrative: survey.narrative,
    summary: survey.summary ?? {},
    createdAt: toDate(survey.createdAt) ?? new Date(),
    updatedAt: toDate(survey.updatedAt) ?? new Date(),
    createdBy: survey.createdBy as unknown as string,
    updatedBy: survey.updatedBy as unknown as string,
  };
}

function rowToSurvey(
  row: any,
  findings: readonly ConditionalSurveyFinding[],
  actionPlans: readonly ConditionalSurveyActionPlan[]
): ConditionalSurvey {
  return {
    id: asConditionalSurveyId(row.id),
    tenantId: row.tenantId as unknown as TenantId,
    propertyId: row.propertyId as unknown as PropertyId,
    unitId: row.unitId ? (row.unitId as unknown as UnitId) : null,
    sourceInspectionId: row.sourceInspectionId
      ? (row.sourceInspectionId as unknown as InspectionId)
      : null,
    surveyorId: row.surveyorId ? (row.surveyorId as unknown as UserId) : null,
    status: (row.status ?? 'draft') as ConditionalSurveyStatus,
    scheduledAt: fromDate(row.scheduledAt),
    startedAt: fromDate(row.startedAt),
    compiledAt: fromDate(row.compiledAt),
    approvedAt: fromDate(row.approvedAt),
    narrative: row.narrative ?? null,
    summary: (row.summary ?? {}) as Readonly<Record<string, unknown>>,
    findings,
    actionPlans,
    createdAt: fromDate(row.createdAt)! as ISOTimestamp,
    updatedAt: fromDate(row.updatedAt)! as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
    updatedBy: row.updatedBy as unknown as UserId,
  };
}

function findingToRow(
  finding: ConditionalSurveyFinding
): Record<string, unknown> {
  return {
    id: finding.id as unknown as string,
    surveyId: finding.surveyId as unknown as string,
    tenantId: finding.tenantId as unknown as string,
    area: finding.area,
    title: finding.title,
    description: finding.description,
    severity: finding.severity,
    photos: finding.photos ?? [],
    attachments: finding.attachments ?? [],
    metadata: finding.metadata ?? {},
    createdAt: toDate(finding.createdAt) ?? new Date(),
    updatedAt: toDate(finding.createdAt) ?? new Date(),
    createdBy: finding.createdBy as unknown as string,
    updatedBy: finding.createdBy as unknown as string,
  };
}

function rowToFinding(row: any): ConditionalSurveyFinding {
  return {
    id: asConditionalSurveyFindingId(row.id),
    surveyId: asConditionalSurveyId(row.surveyId),
    tenantId: row.tenantId as unknown as TenantId,
    area: row.area,
    title: row.title,
    description: row.description ?? null,
    severity: (row.severity ?? 'low') as ConditionalSurveySeverity,
    photos: Array.isArray(row.photos) ? row.photos : [],
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    metadata: (row.metadata ?? {}) as Readonly<Record<string, unknown>>,
    createdAt: fromDate(row.createdAt)! as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
  };
}

function planToRow(plan: ConditionalSurveyActionPlan): Record<string, unknown> {
  return {
    id: plan.id as unknown as string,
    surveyId: plan.surveyId as unknown as string,
    findingId: (plan.findingId as unknown as string) ?? null,
    tenantId: plan.tenantId as unknown as string,
    title: plan.title,
    description: plan.description,
    priority: plan.priority,
    status: plan.status,
    estimatedCost: plan.estimatedCostCents ?? null,
    currency: plan.currency,
    targetDate: toDate(plan.targetDate ?? undefined),
    approvedBy: (plan.approvedBy as unknown as string) ?? null,
    approvedAt: toDate(plan.approvedAt ?? undefined),
    createdAt: toDate(plan.createdAt) ?? new Date(),
    updatedAt: toDate(plan.createdAt) ?? new Date(),
    createdBy: plan.createdBy as unknown as string,
    updatedBy: plan.createdBy as unknown as string,
  };
}

function rowToPlan(row: any): ConditionalSurveyActionPlan {
  return {
    id: asConditionalSurveyActionPlanId(row.id),
    surveyId: asConditionalSurveyId(row.surveyId),
    findingId: row.findingId ? asConditionalSurveyFindingId(row.findingId) : null,
    tenantId: row.tenantId as unknown as TenantId,
    title: row.title,
    description: row.description ?? null,
    priority: (row.priority ?? 3) as ConditionalSurveyActionPlan['priority'],
    status: (row.status ?? 'proposed') as ConditionalSurveyActionStatus,
    estimatedCostCents: row.estimatedCost != null ? Number(row.estimatedCost) : null,
    // Prefer the stored value; only fall back to the neutral global default
    // when the row has no currency. Tenant-specific currency lives in the
    // tenant record, not here — this is a last-resort fallback.
    currency: row.currency ?? getDefaultCurrency(null),
    targetDate: fromDate(row.targetDate),
    approvedBy: row.approvedBy ? (row.approvedBy as unknown as UserId) : null,
    approvedAt: fromDate(row.approvedAt),
    createdAt: fromDate(row.createdAt)! as ISOTimestamp,
    createdBy: row.createdBy as unknown as UserId,
  };
}
