/**
 * ConditionalSurveyService (NEW 2)
 *
 * Workflow:
 *   scheduleSurvey  -> attachFinding(s)  -> compileReport
 *                                       -> approveActionPlan
 *
 * Note: AI narrative compilation is stubbed; see compileReport.
 */

import { randomHex } from '../../common/id-generator.js';
import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import { ok, err, getDefaultCurrency } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import { createEventEnvelope, generateEventId } from '../../common/events.js';
import type { InspectionId } from '../types.js';
import type {
  ConditionalSurvey,
  ConditionalSurveyId,
  ConditionalSurveyFinding,
  ConditionalSurveyFindingId,
  ConditionalSurveyActionPlan,
  ConditionalSurveyActionPlanId,
  ConditionalSurveyRepository,
  ConditionalSurveySeverity,
  ConditionalSurveyServiceErrorResult,
} from './types.js';
import {
  asConditionalSurveyId,
  asConditionalSurveyFindingId,
  asConditionalSurveyActionPlanId,
  ConditionalSurveyServiceError,
} from './types.js';

// ============================================================================
// Helpers
// ============================================================================

function nowIso(): ISOTimestamp {
  return new Date().toISOString() as ISOTimestamp;
}

function ensureTenant(
  survey: ConditionalSurvey,
  tenantId: TenantId
): ConditionalSurveyServiceErrorResult | null {
  if (survey.tenantId !== tenantId) {
    return {
      code: ConditionalSurveyServiceError.TENANT_MISMATCH,
      message: 'Survey belongs to a different tenant',
    };
  }
  return null;
}

// ============================================================================
// Service
// ============================================================================

export interface ScheduleSurveyInput {
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId?: UnitId | null;
  readonly scheduledAt: ISOTimestamp;
  readonly surveyorId?: UserId | null;
  readonly sourceInspectionId?: InspectionId | null;
  readonly createdBy: UserId;
  readonly correlationId?: string;
}

export interface AttachFindingInput {
  readonly surveyId: ConditionalSurveyId;
  readonly tenantId: TenantId;
  readonly area: string;
  readonly title: string;
  readonly description?: string;
  readonly severity?: ConditionalSurveySeverity;
  readonly photos?: readonly string[];
  readonly attachments?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly createdBy: UserId;
}

export interface ApproveActionPlanInput {
  readonly surveyId: ConditionalSurveyId;
  readonly actionPlanId: ConditionalSurveyActionPlanId;
  readonly tenantId: TenantId;
  readonly approvedBy: UserId;
}

export class ConditionalSurveyService {
  constructor(
    private repo: ConditionalSurveyRepository,
    private readonly eventBus: EventBus
  ) {}

  /** Additive Wave 3 hook — attach the live Postgres repo at runtime. */
  attachRepository(repo: ConditionalSurveyRepository): void {
    this.repo = repo;
  }

  async scheduleSurvey(
    input: ScheduleSurveyInput
  ): Promise<Result<ConditionalSurvey, ConditionalSurveyServiceErrorResult>> {
    if (!input.scheduledAt) {
      return err({
        code: ConditionalSurveyServiceError.INVALID_INPUT,
        message: 'scheduledAt is required',
      });
    }

    const id = asConditionalSurveyId(`csurv_${Date.now()}_${randomHex(4)}`);
    const now = nowIso();
    const survey: ConditionalSurvey = {
      id,
      tenantId: input.tenantId,
      propertyId: input.propertyId,
      unitId: input.unitId ?? null,
      sourceInspectionId: input.sourceInspectionId ?? null,
      surveyorId: input.surveyorId ?? null,
      status: 'scheduled',
      scheduledAt: input.scheduledAt,
      startedAt: null,
      compiledAt: null,
      approvedAt: null,
      narrative: null,
      summary: {},
      findings: [],
      actionPlans: [],
      createdAt: now,
      updatedAt: now,
      createdBy: input.createdBy,
      updatedBy: input.createdBy,
    };

    const saved = await this.repo.create(survey);

    const correlationId = input.correlationId ?? `corr_${Date.now()}`;
    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'ConditionalSurveyScheduled',
          timestamp: now,
          tenantId: input.tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            surveyId: saved.id,
            propertyId: saved.propertyId,
            unitId: saved.unitId,
            scheduledAt: saved.scheduledAt,
          },
        },
        saved.id,
        'ConditionalSurvey'
      )
    );

    return ok(saved);
  }

  async attachFinding(
    input: AttachFindingInput
  ): Promise<
    Result<ConditionalSurveyFinding, ConditionalSurveyServiceErrorResult>
  > {
    const survey = await this.repo.findById(input.surveyId, input.tenantId);
    if (!survey) {
      return err({
        code: ConditionalSurveyServiceError.SURVEY_NOT_FOUND,
        message: 'Survey not found',
      });
    }
    const tenantErr = ensureTenant(survey, input.tenantId);
    if (tenantErr) return err(tenantErr);

    if (survey.status === 'archived' || survey.status === 'cancelled') {
      return err({
        code: ConditionalSurveyServiceError.INVALID_STATUS,
        message: `Cannot attach findings to survey in status: ${survey.status}`,
      });
    }

    const findingId = asConditionalSurveyFindingId(
      `csfind_${Date.now()}_${randomHex(4)}`
    );
    const now = nowIso();
    const finding: ConditionalSurveyFinding = {
      id: findingId,
      surveyId: input.surveyId,
      tenantId: input.tenantId,
      area: input.area,
      title: input.title,
      description: input.description ?? null,
      severity: input.severity ?? 'medium',
      photos: input.photos ?? [],
      attachments: input.attachments ?? [],
      metadata: input.metadata ?? {},
      createdAt: now,
      createdBy: input.createdBy,
    };

    const saved = await this.repo.addFinding(finding);

    // Bump survey to in_progress on first finding if currently scheduled
    if (survey.status === 'scheduled' || survey.status === 'draft') {
      await this.repo.update({
        ...survey,
        status: 'in_progress',
        startedAt: survey.startedAt ?? now,
        updatedAt: now,
        updatedBy: input.createdBy,
      });
    }

    return ok(saved);
  }

  /**
   * Compile the survey's findings into a report + draft action plans.
   *
   * Follow-up KI-007 (#33): wire to AI persona — once the narrative-generation
   *   agent (packages/ai-copilot/src/personas/inspection-narrator.ts)
   *   is authored, call the persona here with the finding set to
   *   produce `narrative`. See Docs/KNOWN_ISSUES.md#ki-007.
   */
  async compileReport(
    surveyId: ConditionalSurveyId,
    tenantId: TenantId,
    compiledBy: UserId,
    options?: {
      correlationId?: string;
      /**
       * ISO 3166-1 alpha-2 tenant country code used to resolve the
       * action-plan currency. Callers should pass `tenant.countryCode`;
       * omitting it falls back to the neutral default (USD).
       */
      tenantCountryCode?: string;
    }
  ): Promise<Result<ConditionalSurvey, ConditionalSurveyServiceErrorResult>> {
    const survey = await this.repo.findById(surveyId, tenantId);
    if (!survey) {
      return err({
        code: ConditionalSurveyServiceError.SURVEY_NOT_FOUND,
        message: 'Survey not found',
      });
    }
    const tenantErr = ensureTenant(survey, tenantId);
    if (tenantErr) return err(tenantErr);

    if (
      survey.status !== 'in_progress' &&
      survey.status !== 'scheduled' &&
      survey.status !== 'draft'
    ) {
      return err({
        code: ConditionalSurveyServiceError.INVALID_STATUS,
        message: `Cannot compile survey in status: ${survey.status}`,
      });
    }

    const now = nowIso();
    // Currency resolves from tenant country code (falls back to USD when
    // caller omits `options.tenantCountryCode`). Never hardcode a country.
    const planCurrency = getDefaultCurrency(options?.tenantCountryCode ?? null);

    // Draft action plans from high/critical findings (one per finding).
    const newPlans: ConditionalSurveyActionPlan[] = [];
    for (const finding of survey.findings) {
      if (finding.severity === 'high' || finding.severity === 'critical') {
        const plan: ConditionalSurveyActionPlan = {
          id: asConditionalSurveyActionPlanId(
            `csact_${Date.now()}_${randomHex(4)}`
          ),
          surveyId: surveyId,
          findingId: finding.id,
          tenantId,
          title: `Remediate: ${finding.title}`,
          description: finding.description,
          priority: finding.severity === 'critical' ? 1 : 2,
          status: 'proposed',
          estimatedCostCents: null,
          currency: planCurrency,
          targetDate: null,
          approvedBy: null,
          approvedAt: null,
          createdAt: now,
          createdBy: compiledBy,
        };
        const saved = await this.repo.addActionPlan(plan);
        newPlans.push(saved);
      }
    }

    const summary = {
      findingCount: survey.findings.length,
      criticalCount: survey.findings.filter((f) => f.severity === 'critical')
        .length,
      highCount: survey.findings.filter((f) => f.severity === 'high').length,
      mediumCount: survey.findings.filter((f) => f.severity === 'medium')
        .length,
      lowCount: survey.findings.filter((f) => f.severity === 'low').length,
    };

    // Follow-up KI-007 (#33): wire to AI persona for narrative generation.
    //   See Docs/KNOWN_ISSUES.md#ki-007.
    const narrative =
      survey.narrative ??
      `Conditional survey compiled on ${now}. ${summary.findingCount} findings recorded.`;

    const updated: ConditionalSurvey = {
      ...survey,
      status: 'compiled',
      compiledAt: now,
      narrative,
      summary,
      actionPlans: [...survey.actionPlans, ...newPlans],
      updatedAt: now,
      updatedBy: compiledBy,
    };

    const saved = await this.repo.update(updated);

    const correlationId = options?.correlationId ?? `corr_${Date.now()}`;
    await this.eventBus.publish(
      createEventEnvelope(
        {
          eventId: generateEventId(),
          eventType: 'ConditionalSurveyCompiled',
          timestamp: now,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            surveyId: saved.id,
            findingCount: summary.findingCount,
            actionPlanCount: saved.actionPlans.length,
          },
        },
        saved.id,
        'ConditionalSurvey'
      )
    );

    return ok(saved);
  }

  async getReport(
    surveyId: ConditionalSurveyId,
    tenantId: TenantId
  ): Promise<Result<ConditionalSurvey, ConditionalSurveyServiceErrorResult>> {
    const survey = await this.repo.findById(surveyId, tenantId);
    if (!survey) {
      return err({
        code: ConditionalSurveyServiceError.SURVEY_NOT_FOUND,
        message: 'Survey not found',
      });
    }
    const tenantErr = ensureTenant(survey, tenantId);
    if (tenantErr) return err(tenantErr);
    return ok(survey);
  }

  async approveActionPlan(
    input: ApproveActionPlanInput
  ): Promise<
    Result<ConditionalSurveyActionPlan, ConditionalSurveyServiceErrorResult>
  > {
    const survey = await this.repo.findById(input.surveyId, input.tenantId);
    if (!survey) {
      return err({
        code: ConditionalSurveyServiceError.SURVEY_NOT_FOUND,
        message: 'Survey not found',
      });
    }
    const tenantErr = ensureTenant(survey, input.tenantId);
    if (tenantErr) return err(tenantErr);

    const plan = survey.actionPlans.find((p) => p.id === input.actionPlanId);
    if (!plan) {
      return err({
        code: ConditionalSurveyServiceError.ACTION_PLAN_NOT_FOUND,
        message: 'Action plan not found on this survey',
      });
    }
    if (plan.status !== 'proposed') {
      return err({
        code: ConditionalSurveyServiceError.INVALID_STATUS,
        message: `Cannot approve plan in status: ${plan.status}`,
      });
    }

    const now = nowIso();
    const updated: ConditionalSurveyActionPlan = {
      ...plan,
      status: 'approved',
      approvedBy: input.approvedBy,
      approvedAt: now,
    };
    const saved = await this.repo.updateActionPlan(updated);
    return ok(saved);
  }
}
