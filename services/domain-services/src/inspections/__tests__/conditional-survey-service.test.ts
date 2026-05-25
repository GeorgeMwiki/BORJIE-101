/**
 * ConditionalSurveyService — happy path + cross-tenant isolation.
 */

import { describe, it, expect, vi } from 'vitest';
import type { TenantId, UserId } from '@borjie/domain-models';
import { asTenantId, asUserId } from '@borjie/domain-models';
import type { EventBus } from '../../common/events.js';
import {
  ConditionalSurveyService,
  ConditionalSurveyServiceError,
  asConditionalSurveyId,
  asConditionalSurveyFindingId,
  asConditionalSurveyActionPlanId,
  type ConditionalSurvey,
  type ConditionalSurveyFinding,
  type ConditionalSurveyActionPlan,
  type ConditionalSurveyRepository,
} from '../conditional-survey/index.js';

const tenantA = asTenantId('tnt_a');
const tenantB = asTenantId('tnt_b');
const propertyId = 'prop_1' as any;
const userId = asUserId('usr_1');

function createInMemoryRepo(): ConditionalSurveyRepository {
  const store = new Map<string, ConditionalSurvey>();
  const findings = new Map<string, ConditionalSurveyFinding[]>();
  const plans = new Map<string, ConditionalSurveyActionPlan[]>();

  return {
    async findById(id, tenantId) {
      const s = store.get(id);
      if (!s || s.tenantId !== tenantId) return null;
      return {
        ...s,
        findings: findings.get(id) ?? [],
        actionPlans: plans.get(id) ?? [],
      };
    },
    async create(survey) {
      store.set(survey.id, survey);
      findings.set(survey.id, []);
      plans.set(survey.id, []);
      return survey;
    },
    async update(survey) {
      store.set(survey.id, survey);
      return {
        ...survey,
        findings: findings.get(survey.id) ?? survey.findings,
        actionPlans: plans.get(survey.id) ?? survey.actionPlans,
      };
    },
    async addFinding(f) {
      const list = findings.get(f.surveyId) ?? [];
      list.push(f);
      findings.set(f.surveyId, list);
      return f;
    },
    async addActionPlan(p) {
      const list = plans.get(p.surveyId) ?? [];
      list.push(p);
      plans.set(p.surveyId, list);
      return p;
    },
    async updateActionPlan(p) {
      const list = plans.get(p.surveyId) ?? [];
      const idx = list.findIndex((x) => x.id === p.id);
      if (idx >= 0) list[idx] = p;
      plans.set(p.surveyId, list);
      return p;
    },
  };
}

function createEventBus(): EventBus {
  return {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };
}

describe('ConditionalSurveyService', () => {
  it('schedules, attaches findings, compiles, and approves', async () => {
    const repo = createInMemoryRepo();
    const svc = new ConditionalSurveyService(repo, createEventBus());

    const scheduled = await svc.scheduleSurvey({
      tenantId: tenantA,
      propertyId,
      scheduledAt: new Date().toISOString() as any,
      createdBy: userId,
    });
    expect(scheduled.success).toBe(true);
    if (!scheduled.success) return;
    const surveyId = scheduled.data.id;

    const findingRes = await svc.attachFinding({
      surveyId,
      tenantId: tenantA,
      area: 'Roof',
      title: 'Missing tiles',
      severity: 'critical',
      createdBy: userId,
    });
    expect(findingRes.success).toBe(true);

    const compiled = await svc.compileReport(surveyId, tenantA, userId);
    expect(compiled.success).toBe(true);
    if (!compiled.success) return;
    expect(compiled.data.status).toBe('compiled');
    expect(compiled.data.actionPlans.length).toBeGreaterThan(0);

    const planId = compiled.data.actionPlans[0]!.id;
    const approved = await svc.approveActionPlan({
      surveyId,
      actionPlanId: planId,
      tenantId: tenantA,
      approvedBy: userId,
    });
    expect(approved.success).toBe(true);
    if (!approved.success) return;
    expect(approved.data.status).toBe('approved');
  });

  it('enforces cross-tenant isolation', async () => {
    const repo = createInMemoryRepo();
    const svc = new ConditionalSurveyService(repo, createEventBus());

    const res = await svc.scheduleSurvey({
      tenantId: tenantA,
      propertyId,
      scheduledAt: new Date().toISOString() as any,
      createdBy: userId,
    });
    expect(res.success).toBe(true);
    if (!res.success) return;

    const leak = await svc.getReport(res.data.id, tenantB);
    expect(leak.success).toBe(false);
    if (leak.success) return;
    expect(leak.error.code).toBe(
      ConditionalSurveyServiceError.SURVEY_NOT_FOUND
    );
  });
});
