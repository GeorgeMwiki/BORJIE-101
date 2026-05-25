/**
 * Tests for PostgresConditionalSurveyRepository using an in-memory drizzle fake.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresConditionalSurveyRepository } from './postgres-conditional-survey-repository.js';
import type {
  ConditionalSurvey,
  ConditionalSurveyFinding,
  ConditionalSurveyActionPlan,
} from './types.js';
import {
  asConditionalSurveyId,
  asConditionalSurveyFindingId,
  asConditionalSurveyActionPlanId,
} from './types.js';
import type {
  TenantId,
  UserId,
  PropertyId,
  ISOTimestamp,
} from '@borjie/domain-models';

type Row = Record<string, unknown>;

vi.mock('drizzle-orm', () => ({
  and: (...parts: any[]) => (row: Row) =>
    parts.every((p) => (p ? p(row) : true)),
  eq: (col: any, val: unknown) => (row: Row) => row[col.name] === val,
  lt: (col: any, val: any) => (row: Row) => {
    const left = row[col.name];
    if (left instanceof Date && val instanceof Date) return left < val;
    return (left as any) < val;
  },
}));

vi.mock('@borjie/database', () => {
  const col = (name: string) => ({ name, _table: '' });
  return {
    conditionalSurveys: {
      _table: 'conditional_surveys',
      id: col('id'),
      tenantId: col('tenantId'),
      scheduledAt: col('scheduledAt'),
    },
    conditionalSurveyFindings: {
      _table: 'conditional_survey_findings',
      id: col('id'),
      surveyId: col('surveyId'),
      tenantId: col('tenantId'),
    },
    conditionalSurveyActionPlans: {
      _table: 'conditional_survey_action_plans',
      id: col('id'),
      surveyId: col('surveyId'),
      tenantId: col('tenantId'),
    },
  };
});

function makeFakeDb() {
  const tables: Record<string, Row[]> = {
    conditional_surveys: [],
    conditional_survey_findings: [],
    conditional_survey_action_plans: [],
  };
  const toPred = (p: any) => (typeof p === 'function' ? p : () => true);

  return {
    tables,
    select: () => {
      let predicate: (r: Row) => boolean = () => true;
      let limit = Infinity;
      let currentTable: Row[] = [];
      const chain: any = {
        from: (t: any) => {
          currentTable = tables[t._table] ?? [];
          return chain;
        },
        where: (p: any) => ((predicate = toPred(p)), chain),
        limit: (n: number) => ((limit = n), chain),
        then: (resolve: (r: Row[]) => void) =>
          resolve(currentTable.filter(predicate).slice(0, limit)),
      };
      return chain;
    },
    insert: (t: any) => ({
      values(v: Row) {
        tables[t._table].push({ ...v });
      },
    }),
    update: (t: any) => {
      let patch: Row = {};
      const chain: any = {
        set: (p: Row) => ((patch = p), chain),
        where: (p: any) => {
          const pred = toPred(p);
          for (const row of tables[t._table]) if (pred(row)) Object.assign(row, patch);
          return Promise.resolve();
        },
      };
      return chain;
    },
  };
}

const TENANT = 'tenant_1' as TenantId;
const ACTOR = 'u_1' as UserId;
const PROPERTY = 'prop_1' as PropertyId;

function makeSurvey(id: string): ConditionalSurvey {
  const now = new Date().toISOString() as ISOTimestamp;
  return {
    id: asConditionalSurveyId(id),
    tenantId: TENANT,
    propertyId: PROPERTY,
    unitId: null,
    sourceInspectionId: null,
    surveyorId: null,
    status: 'scheduled',
    scheduledAt: now,
    startedAt: null,
    compiledAt: null,
    approvedAt: null,
    narrative: null,
    summary: {},
    findings: [],
    actionPlans: [],
    createdAt: now,
    updatedAt: now,
    createdBy: ACTOR,
    updatedBy: ACTOR,
  };
}

describe('PostgresConditionalSurveyRepository', () => {
  let db: ReturnType<typeof makeFakeDb>;
  let repo: PostgresConditionalSurveyRepository;

  beforeEach(() => {
    db = makeFakeDb();
    repo = new PostgresConditionalSurveyRepository(db as any);
  });

  it('create + findById returns survey with empty children', async () => {
    const s = makeSurvey('s1');
    await repo.create(s);
    const found = await repo.findById(s.id, TENANT);
    expect(found?.id).toBe('s1');
    expect(found?.findings).toHaveLength(0);
    expect(found?.actionPlans).toHaveLength(0);
  });

  it('addFinding persists a finding visible via findById', async () => {
    const s = makeSurvey('s2');
    await repo.create(s);
    const finding: ConditionalSurveyFinding = {
      id: asConditionalSurveyFindingId('f1'),
      surveyId: s.id,
      tenantId: TENANT,
      area: 'Roof',
      title: 'Leak',
      description: null,
      severity: 'high',
      photos: [],
      attachments: [],
      metadata: {},
      createdAt: new Date().toISOString() as ISOTimestamp,
      createdBy: ACTOR,
    };
    await repo.addFinding(finding);
    const found = await repo.findById(s.id, TENANT);
    expect(found?.findings).toHaveLength(1);
    expect(found?.findings[0].title).toBe('Leak');
  });

  it('addActionPlan + updateActionPlan flow', async () => {
    const s = makeSurvey('s3');
    await repo.create(s);
    const plan: ConditionalSurveyActionPlan = {
      id: asConditionalSurveyActionPlanId('ap1'),
      surveyId: s.id,
      findingId: null,
      tenantId: TENANT,
      title: 'Fix roof',
      description: null,
      priority: 1,
      status: 'proposed',
      estimatedCostCents: null,
      currency: 'KES',
      targetDate: null,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date().toISOString() as ISOTimestamp,
      createdBy: ACTOR,
    };
    await repo.addActionPlan(plan);
    await repo.updateActionPlan({ ...plan, status: 'approved', approvedBy: ACTOR });
    const found = await repo.findById(s.id, TENANT);
    expect(found?.actionPlans[0].status).toBe('approved');
  });

  it('findOverdue returns surveys with scheduled_at before cutoff', async () => {
    const s = makeSurvey('s4');
    await repo.create(s);
    const cutoff = new Date(Date.now() + 24 * 3600_000).toISOString() as ISOTimestamp;
    const overdue = await repo.findOverdue(TENANT, cutoff);
    expect(overdue.length).toBeGreaterThanOrEqual(1);
  });
});
