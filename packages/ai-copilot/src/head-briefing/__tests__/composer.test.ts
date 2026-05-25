import { describe, it, expect } from 'vitest';
import { createBriefingComposer } from '../composer.js';
import { renderMarkdown } from '../markdown-renderer.js';
import {
  narrateForVoice,
  estimateSecondsForVoice,
  MAX_NARRATION_SECONDS,
} from '../voice-narrator.js';
import type {
  AnomaliesSource,
  BriefingAnomaly,
  BriefingRecommendation,
  EscalationsSection,
  EscalationsSource,
  KpiDeltasSection,
  KpiSource,
  OvernightSection,
  OvernightSource,
  PendingApprovalsSection,
  PendingApprovalsSource,
  RecommendationsSource,
} from '../types.js';

const TENANT = 'tenant_head_1';

// ---------------------------------------------------------------------------
// Helpers — build a composer with configurable source stubs.
// ---------------------------------------------------------------------------

interface StubOptions {
  readonly overnight?: OvernightSection;
  readonly pendingApprovals?: PendingApprovalsSection;
  readonly escalations?: EscalationsSection;
  readonly kpis?: KpiDeltasSection;
  readonly recommendations?: readonly BriefingRecommendation[];
  readonly anomalies?: readonly BriefingAnomaly[];
  readonly overnightThrows?: boolean;
  readonly clock?: () => Date;
}

function buildComposer(opts: StubOptions = {}) {
  const overnightSource: OvernightSource = {
    summarize: async () => {
      if (opts.overnightThrows) throw new Error('overnight source down');
      return (
        opts.overnight ?? {
          totalAutonomousActions: 0,
          byDomain: {},
          notableActions: [],
        }
      );
    },
  };
  const pendingApprovalsSource: PendingApprovalsSource = {
    list: async () =>
      opts.pendingApprovals ?? { count: 0, items: [] },
  };
  const escalationsSource: EscalationsSource = {
    list: async () =>
      opts.escalations ?? {
        count: 0,
        byPriority: { P1: 0, P2: 0, P3: 0 },
        items: [],
      },
  };
  const kpiSource: KpiSource = {
    fetch: async () =>
      opts.kpis ?? {
        occupancyPct: { value: 92, delta7d: 0.5 },
        collectionsRate: { value: 95, delta7d: 0.3 },
        arrearsDays: { value: 18, delta7d: -0.8 },
        maintenanceSLA: { value: 88, delta7d: 1.2 },
        tenantSatisfaction: { value: 4.3, delta30d: 0.1 },
        noi: { value: 120_000, delta30d: 2_500 },
      },
  };
  const recommendationsSource: RecommendationsSource = {
    list: async () => opts.recommendations ?? [],
  };
  const anomaliesSource: AnomaliesSource = {
    list: async () => opts.anomalies ?? [],
  };

  return createBriefingComposer({
    overnightSource,
    pendingApprovalsSource,
    escalationsSource,
    kpiSource,
    recommendationsSource,
    anomaliesSource,
    clock: opts.clock,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BriefingComposer — compose', () => {
  it('1. happy path: every section populated and headline summarises the day', async () => {
    const composer = buildComposer({
      overnight: {
        totalAutonomousActions: 14,
        byDomain: { finance: 6, maintenance: 5, communications: 3 },
        notableActions: [
          {
            actionId: 'act_1',
            domain: 'finance',
            summary: 'waived a late fee of 1200',
            confidence: 0.92,
          },
        ],
      },
      pendingApprovals: {
        count: 2,
        items: [
          {
            approvalId: 'ap_1',
            kind: 'single',
            summary: 'Disbursement of 50k to vendor X',
            urgency: 'high',
          },
          {
            approvalId: 'ap_2',
            kind: 'standing',
            summary: 'Auto-send Q4 rent reminders',
            urgency: 'medium',
          },
        ],
      },
      escalations: {
        count: 3,
        byPriority: { P1: 1, P2: 1, P3: 1 },
        items: [
          {
            exceptionId: 'exc_1',
            priority: 'P1',
            summary: 'Chronic non-payer at Unit 12B',
            domain: 'finance',
          },
          {
            exceptionId: 'exc_2',
            priority: 'P2',
            summary: 'Compliance notice due Friday',
            domain: 'compliance',
          },
          {
            exceptionId: 'exc_3',
            priority: 'P3',
            summary: 'Minor maintenance backlog',
            domain: 'maintenance',
          },
        ],
      },
      recommendations: [
        {
          topic: 'Arrears tail',
          summary: 'Accelerate the arrears ladder on top offenders',
          rationale: 'Arrears ratio has crept past 14%',
          confidence: 0.78,
          suggestedAction: 'Issue formal demand letters this week',
        },
      ],
      anomalies: [
        {
          area: 'vendor payments',
          observation: 'Three invoices from Vendor Y deviate from the norm',
          possibleCause: 'Possible pricing shift or billing error',
          suggestedInvestigation: 'Pull the last 6 months of Vendor Y line items',
        },
      ],
    });
    const doc = await composer.compose(TENANT);
    expect(doc.tenantId).toBe(TENANT);
    expect(doc.overnight.totalAutonomousActions).toBe(14);
    expect(doc.pendingApprovals.count).toBe(2);
    expect(doc.escalations.count).toBe(3);
    expect(doc.recommendations).toHaveLength(1);
    expect(doc.anomalies).toHaveLength(1);
    expect(doc.headline).toMatch(/14 actions/);
    expect(doc.headline).toMatch(/P1/);
    expect(doc.headline).toMatch(/2 approvals/);
  });

  it('2. empty state (quiet day): every section reports zero, headline says so', async () => {
    const composer = buildComposer({
      kpis: {
        occupancyPct: { value: 0, delta7d: 0 },
        collectionsRate: { value: 0, delta7d: 0 },
        arrearsDays: { value: 0, delta7d: 0 },
        maintenanceSLA: { value: 0, delta7d: 0 },
        tenantSatisfaction: { value: 0, delta30d: 0 },
        noi: { value: 0, delta30d: 0 },
      },
    });
    const doc = await composer.compose(TENANT);
    expect(doc.overnight.totalAutonomousActions).toBe(0);
    expect(doc.pendingApprovals.count).toBe(0);
    expect(doc.escalations.count).toBe(0);
    expect(doc.recommendations).toHaveLength(0);
    expect(doc.anomalies).toHaveLength(0);
    expect(doc.headline.toLowerCase()).toContain('quiet');
  });

  it('3. escalation-heavy day: P1 count bubbles into headline first', async () => {
    const composer = buildComposer({
      escalations: {
        count: 5,
        byPriority: { P1: 4, P2: 1, P3: 0 },
        items: Array.from({ length: 5 }).map((_, i) => ({
          exceptionId: `exc_${i}`,
          priority: i < 4 ? 'P1' : 'P2',
          summary: `Escalation ${i}`,
          domain: 'finance',
        })),
      },
    });
    const doc = await composer.compose(TENANT);
    expect(doc.escalations.byPriority.P1).toBe(4);
    expect(doc.headline).toMatch(/4 P1 escalations/);
  });

  it('4. markdown output is stable and contains every section heading', async () => {
    const composer = buildComposer({
      overnight: {
        totalAutonomousActions: 3,
        byDomain: { finance: 3 },
        notableActions: [],
      },
      clock: () => new Date('2026-04-21T08:00:00.000Z'),
    });
    const doc = await composer.compose(TENANT);
    const md = renderMarkdown(doc);
    expect(md).toContain('# Morning briefing');
    expect(md).toContain('## Overnight');
    expect(md).toContain('## Pending approvals');
    expect(md).toContain('## Escalations');
    expect(md).toContain('## KPI deltas');
    expect(md).toContain('## Recommendations');
    expect(md).toContain('## Anomalies');
    // Determinism check — same doc rendered twice must match byte-for-byte.
    expect(renderMarkdown(doc)).toBe(md);
  });

  it('5. voice narration stays under the 90s TTS budget on a rich day', async () => {
    const composer = buildComposer({
      overnight: {
        totalAutonomousActions: 22,
        byDomain: { finance: 10, maintenance: 8, communications: 4 },
        notableActions: [
          {
            actionId: 'act_1',
            domain: 'finance',
            summary: 'processed a large rent reconciliation batch',
            confidence: 0.89,
          },
        ],
      },
      pendingApprovals: {
        count: 3,
        items: [
          {
            approvalId: 'ap_1',
            kind: 'single',
            summary: 'a vendor disbursement above the standing ceiling',
            urgency: 'high',
          },
        ],
      },
      escalations: {
        count: 4,
        byPriority: { P1: 2, P2: 1, P3: 1 },
        items: [
          {
            exceptionId: 'exc_1',
            priority: 'P1',
            summary: 'a tenant dispute entering its third week',
            domain: 'cases',
          },
        ],
      },
      recommendations: [
        {
          topic: 'Occupancy',
          summary: 'Launch a targeted referral campaign.',
          rationale: 'Occupancy drifting below 90%',
          confidence: 0.72,
          suggestedAction: 'Approve the draft campaign brief.',
        },
      ],
      anomalies: [
        {
          area: 'vendor payments',
          observation: 'Three invoices deviate from the norm.',
          possibleCause: 'Possible pricing shift.',
          suggestedInvestigation: 'Pull the last 6 months of line items.',
        },
      ],
    });
    const doc = await composer.compose(TENANT);
    const script = narrateForVoice(doc);
    const seconds = estimateSecondsForVoice(script);
    expect(seconds).toBeLessThan(MAX_NARRATION_SECONDS);
    expect(seconds).toBeGreaterThan(5);
  });

  it('6. a failing source degrades cleanly to an empty section instead of throwing', async () => {
    const composer = buildComposer({
      overnightThrows: true,
      pendingApprovals: {
        count: 1,
        items: [
          {
            approvalId: 'ap_1',
            kind: 'single',
            summary: 'Routine reimbursement',
            urgency: 'low',
          },
        ],
      },
    });
    const doc = await composer.compose(TENANT);
    expect(doc.overnight.totalAutonomousActions).toBe(0);
    // Other sections remain populated — one dead source does not black-screen.
    expect(doc.pendingApprovals.count).toBe(1);
  });
});
