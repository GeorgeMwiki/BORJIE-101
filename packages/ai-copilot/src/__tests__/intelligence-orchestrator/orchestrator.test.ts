/**
 * Intelligence Orchestrator — structural tests.
 */

import { describe, it, expect } from 'vitest';
import {
  createIntelligenceOrchestrator,
  createMockFetchers,
  generateCrossModuleInsights,
  generateProactiveAlerts,
  runPortfolioHealthCheck,
  createDecisionFeedbackService,
  InMemoryDecisionFeedbackRepository,
  routeAdminQuery,
  createCrossPersonaMemoryService,
  InMemoryCrossPersonaRepository,
  getRegionalEstateContext,
  DEFAULT_INTELLIGENCE_CONFIG,
} from '../../intelligence-orchestrator/index.js';

describe('IntelligenceOrchestrator.generateContext', () => {
  it('rejects empty tenantId', async () => {
    const o = createIntelligenceOrchestrator({
      fetchers: createMockFetchers({}),
    });
    await expect(
      o.generateContext({ scopeKind: 'unit', scopeId: 'u1', tenantId: '' }),
    ).rejects.toThrow(/tenantId/);
  });

  it('produces a unified context with null-safe snapshots', async () => {
    const o = createIntelligenceOrchestrator({
      fetchers: createMockFetchers({}),
    });
    const ctx = await o.generateContext({
      scopeKind: 'unit',
      scopeId: 'u1',
      tenantId: 't1',
    });
    expect(ctx.scopeKind).toBe('unit');
    expect(ctx.tenantId).toBe('t1');
    expect(ctx.payments).toBeNull();
    expect(ctx.crossModuleInsights).toEqual([]);
    expect(ctx.synthesizedRecommendation.action).toBe('insufficient_data');
  });

  it('generates an intervene recommendation when signals stack', async () => {
    const o = createIntelligenceOrchestrator({
      fetchers: createMockFetchers({
        payments: {
          arrearsCents: 250_000_00,
          consecutiveLateMonths: 3,
          arrearsBuckets: {
            '0_30': 0,
            '31_60': 50_000_00,
            '61_90': 100_000_00,
            '91_plus': 100_000_00,
          },
        },
        maintenance: {
          openCases: 4,
          criticalCases: 2,
          costMomYoYPct: 40,
        },
        compliance: { criticalBreaches: 1, overdueItems: 2 },
        leasing: { churnProbability: 0.75, leaseEndWithin60d: 1 },
        occupancy: { occupancyPct: 70, vacancyCount: 3 },
        tenantRisk: { riskGrade: 'D', complaintsLast90d: 3 },
      }),
    });
    const ctx = await o.generateContext({
      scopeKind: 'property',
      scopeId: 'p1',
      tenantId: 't1',
    });
    expect(['intervene', 'escalate_to_manager']).toContain(
      ctx.synthesizedRecommendation.action,
    );
    expect(ctx.proactiveAlerts.length).toBeGreaterThan(0);
    expect(ctx.crossModuleInsights.length).toBeGreaterThan(0);
  });
});

describe('cross-module reasoner', () => {
  it('returns empty when nothing is wired', () => {
    const out = generateCrossModuleInsights({
      payments: null,
      maintenance: null,
      compliance: null,
      leasing: null,
      inspection: null,
      far: null,
      tenantRisk: null,
      occupancy: null,
    });
    expect(out).toEqual([]);
  });

  it('detects arrears + maintenance spike', () => {
    const insights = generateCrossModuleInsights({
      payments: {
        totalInvoicedCents: 0,
        totalPaidCents: 0,
        arrearsCents: 50_000_00,
        arrearsBuckets: { '0_30': 0, '31_60': 0, '61_90': 0, '91_plus': 0 },
        avgDaysLateTrend30d: 0,
        consecutiveLateMonths: 3,
        computedAt: new Date().toISOString(),
      },
      maintenance: {
        openCases: 2,
        criticalCases: 0,
        avgResolutionDays: 5,
        costLast90dCents: 50_000_00,
        costMomYoYPct: 50,
        topCategories: [],
        repeatCaseRate: 0,
        computedAt: new Date().toISOString(),
      },
      compliance: null,
      leasing: null,
      inspection: null,
      far: null,
      tenantRisk: null,
      occupancy: null,
    });
    expect(
      insights.some(
        (i) => i.type === 'arrears_rising_with_maintenance_cost_spike',
      ),
    ).toBe(true);
  });
});

describe('proactive alert engine', () => {
  it('sorts alerts by priority ascending', () => {
    const alerts = generateProactiveAlerts(
      {
        payments: {
          totalInvoicedCents: 0,
          totalPaidCents: 0,
          arrearsCents: 90_00_000,
          arrearsBuckets: {
            '0_30': 0,
            '31_60': 0,
            '61_90': 0,
            '91_plus': 90_00_000,
          },
          avgDaysLateTrend30d: 0,
          consecutiveLateMonths: 4,
          computedAt: new Date().toISOString(),
        },
        maintenance: null,
        compliance: null,
        leasing: null,
        inspection: null,
        tenantRisk: null,
        occupancy: null,
        crossModuleInsights: [],
      },
      0.5,
    );
    expect(alerts.length).toBeGreaterThan(0);
    for (let i = 1; i < alerts.length; i += 1) {
      expect(alerts[i].priority).toBeGreaterThanOrEqual(alerts[i - 1].priority);
    }
  });
});

describe('portfolio early warning', () => {
  it('classifies red when breaches exist', () => {
    const health = runPortfolioHealthCheck('port1', 't1', {
      propertyCount: 2,
      totalUnits: 20,
      occupiedUnits: 18,
      propertySnapshots: [
        {
          propertyId: 'p1',
          district: 'DAR-KINONDONI',
          payments: null,
          maintenance: null,
          compliance: {
            openItems: 2,
            overdueItems: 2,
            criticalBreaches: 1,
            lastInspectionDate: null,
            pendingNoticesToTenants: 0,
            pendingRegulatorFilings: 0,
          },
          leasing: null,
          occupancy: null,
        },
        {
          propertyId: 'p2',
          district: 'DAR-ILALA',
          payments: null,
          maintenance: null,
          compliance: null,
          leasing: null,
          occupancy: null,
        },
      ],
    });
    expect(health.overallHealth).toBe('red');
  });
});

describe('decision feedback service', () => {
  it('rejects empty tenantId', async () => {
    const svc = createDecisionFeedbackService(
      new InMemoryDecisionFeedbackRepository(),
    );
    await expect(
      svc.processDecisionFeedback({
        tenantId: '',
        turnId: 't',
        personaId: 'p',
        proposedAction: { verb: 'v', object: 'o', riskLevel: 'LOW' },
        operatorVerdict: 'approved',
      }),
    ).rejects.toThrow(/tenantId/);
  });

  it('computes persona risk offset from history', async () => {
    const repo = new InMemoryDecisionFeedbackRepository();
    const svc = createDecisionFeedbackService(repo);
    for (let i = 0; i < 5; i += 1) {
      await svc.processDecisionFeedback({
        tenantId: 't1',
        turnId: `turn-${i}`,
        personaId: 'manager',
        proposedAction: { verb: 'issue_notice', object: 'unit-1', riskLevel: 'HIGH' },
        operatorVerdict: i < 4 ? 'rejected' : 'approved',
      });
    }
    const offset = await svc.computePersonaRiskOffset('t1', 'manager');
    expect(offset).toBeGreaterThan(0.5);
  });
});

describe('intelligent routing', () => {
  it('routes arrears language to collector', () => {
    const d = routeAdminQuery('unit 4B is in arrears again — prepare a demand letter');
    expect(d.destination).toBe('collector');
    expect(d.fetchersToPrime).toContain('payments');
  });

  it('routes plumbing language to maintenance_coordinator', () => {
    const d = routeAdminQuery('the bathroom in unit 4B has been leaking for 3 weeks');
    expect(d.destination).toBe('maintenance_coordinator');
  });

  it('falls back to default on empty text', () => {
    const d = routeAdminQuery('');
    expect(d.destination).toBe('manager');
  });
});

describe('cross-persona memory', () => {
  it('isolates tenants', async () => {
    const svc = createCrossPersonaMemoryService(new InMemoryCrossPersonaRepository());
    await svc.remember({
      tenantId: 't1',
      sessionId: 's1',
      personaId: 'manager',
      key: 'subject_unit',
      value: '4B',
    });
    const t1 = await svc.recall('t1', 's1');
    const t2 = await svc.recall('t2', 's1');
    expect(t1.length).toBe(1);
    expect(t2.length).toBe(0);
  });

  it('renders handoff context', async () => {
    const svc = createCrossPersonaMemoryService(new InMemoryCrossPersonaRepository());
    await svc.remember({
      tenantId: 't1',
      sessionId: 's1',
      personaId: 'manager',
      key: 'subject_unit',
      value: '4B',
      confidence: 0.9,
    });
    const ctx = await svc.generateHandoffContext('t1', 's1', 'owner_advisor');
    expect(ctx).toContain('owner_advisor');
    expect(ctx).toContain('subject_unit');
  });
});

describe('regional estate learning', () => {
  it('resolves TZ default profile', () => {
    const ctx = getRegionalEstateContext('TZ-DAR-KINONDONI', 1);
    expect(ctx).not.toBeNull();
    expect(ctx?.profile.country).toBe('TZ');
    expect(ctx?.currentSeasonalMultiplier).toBeGreaterThan(1);
  });

  it('returns null for unknown country', () => {
    const ctx = getRegionalEstateContext('ZW-DEFAULT');
    expect(ctx).toBeNull();
  });
});

describe('orchestrator config', () => {
  it('exposes sensible defaults', () => {
    expect(DEFAULT_INTELLIGENCE_CONFIG.enableCrossModuleReasoning).toBe(true);
    expect(DEFAULT_INTELLIGENCE_CONFIG.timeoutMs).toBeGreaterThan(0);
  });
});
