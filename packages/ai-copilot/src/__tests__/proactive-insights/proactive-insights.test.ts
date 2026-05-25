import { describe, it, expect } from 'vitest';
import {
  INSIGHT_RULES,
  evaluateInsights,
  prioritise,
  shouldShow,
  getProactiveInsights,
  predictNeeds,
  StallDetector,
  type InsightContext,
  type SessionInsightState,
} from '../../proactive-insights/index.js';

const T1 = 'tenant_alpha';
const U1 = 'user_one';

function emptySession(): SessionInsightState {
  return {
    shownInsightIds: [],
    dismissedInsightIds: [],
    dismissedCategories: [],
    insightsShownThisSession: 0,
    criticalInsightsShownToday: 0,
  };
}

function ctx(partial: Partial<InsightContext> = {}): InsightContext {
  return {
    tenantId: T1,
    userId: U1,
    role: 'manager',
    currentPage: '/manager/dashboard',
    ...partial,
  };
}

describe('ProactiveInsights: rules registry', () => {
  it('has at least 10 rules', () => {
    expect(INSIGHT_RULES.length).toBeGreaterThanOrEqual(10);
  });
  it('all rules expose an evaluate function', () => {
    for (const r of INSIGHT_RULES) {
      expect(typeof r.evaluate).toBe('function');
    }
  });
});

describe('ProactiveInsights: insight engine', () => {
  it('fires arrears_60_day_crossing on arrears page', () => {
    const results = evaluateInsights(
      ctx({ currentPage: '/manager/arrears/case_123', openArrearsCases: 1 }),
    );
    expect(results.some((r) => r.id === 'arrears_60_day_crossing')).toBe(true);
  });

  it('skips arrears rule when not on arrears page', () => {
    const results = evaluateInsights(ctx({ openArrearsCases: 3 }));
    expect(results.some((r) => r.id === 'arrears_60_day_crossing')).toBe(false);
  });

  it('renewal_window_90d fires when leasesExpiring90 > 0', () => {
    const results = evaluateInsights(ctx({ leasesExpiring90: 2 }));
    expect(results.some((r) => r.id === 'renewal_window_90d')).toBe(true);
  });

  it('compliance_expiry_nudge fires', () => {
    const results = evaluateInsights(ctx({ expiringCompliance: 1 }));
    expect(results.some((r) => r.id === 'compliance_expiry_nudge')).toBe(true);
  });

  it('workflow_unblock fires only within 2 minutes of stall', () => {
    const fresh = evaluateInsights(
      ctx({ lastStallAt: new Date().toISOString() }),
    );
    expect(fresh.some((r) => r.id === 'workflow_unblock')).toBe(true);
    const stale = evaluateInsights(
      ctx({
        lastStallAt: new Date(Date.now() - 300_000).toISOString(),
      }),
    );
    expect(stale.some((r) => r.id === 'workflow_unblock')).toBe(false);
  });

  it('prioritise orders by priority weight', () => {
    const items = [
      { id: 'a', category: 'arrears_followup', priority: 'low', title: '', body: '' },
      { id: 'b', category: 'arrears_followup', priority: 'high', title: '', body: '' },
    ] as any;
    expect(prioritise(items)[0].id).toBe('b');
  });

  it('shouldShow: respects already-shown list', () => {
    const insight = INSIGHT_RULES[0].evaluate(ctx({ openArrearsCases: 1, currentPage: '/manager/arrears/case_123' }))!;
    expect(insight).toBeTruthy();
    const session = { ...emptySession(), shownInsightIds: [insight.id] };
    expect(shouldShow(insight, session, new Date())).toBe(false);
  });

  it('shouldShow: rate limit kicks in after 3 shown', () => {
    const ins = {
      id: 'x',
      category: 'arrears_followup',
      priority: 'low',
      title: '',
      body: '',
    } as any;
    const session = { ...emptySession(), insightsShownThisSession: 3 };
    expect(shouldShow(ins, session, new Date())).toBe(false);
  });

  it('getProactiveInsights caps returned list', () => {
    const insights = getProactiveInsights(
      ctx({
        currentPage: '/manager/arrears/case_1',
        openArrearsCases: 5,
        leasesExpiring90: 4,
        overdueTickets: 6,
        expiringCompliance: 2,
      }),
      emptySession(),
    );
    expect(insights.length).toBeLessThanOrEqual(3);
  });
});

describe('ProactiveInsights: predictive needs', () => {
  it('arrears dominates when openArrearsCases is high', () => {
    const needs = predictNeeds(ctx({ openArrearsCases: 5 }));
    expect(needs[0].category).toBe('arrears_followup');
  });

  it('provides role-based fallback when no signals', () => {
    const needs = predictNeeds(ctx({ role: 'tenant', currentPage: '/me' }));
    expect(needs.length).toBeGreaterThan(0);
  });
});

describe('ProactiveInsights: stall detector', () => {
  it('marks stall after threshold', () => {
    const d = new StallDetector({ thresholdMs: 1_000 });
    d.record({
      tenantId: T1,
      userId: U1,
      at: new Date(Date.now() - 5_000).toISOString(),
      kind: 'click',
    });
    const state = d.check(T1, U1);
    expect(state?.stalled).toBe(true);
  });

  it('clears stall when activity resumes', () => {
    const d = new StallDetector({ thresholdMs: 1 });
    d.record({
      tenantId: T1,
      userId: U1,
      at: new Date(Date.now() - 5_000).toISOString(),
      kind: 'click',
    });
    d.check(T1, U1);
    d.record({
      tenantId: T1,
      userId: U1,
      at: new Date().toISOString(),
      kind: 'click',
    });
    const state = d.check(T1, U1);
    expect(state?.stalled).toBe(false);
  });

  it('returns null for unknown user', () => {
    const d = new StallDetector();
    expect(d.check(T1, 'unknown')).toBeNull();
  });
});
