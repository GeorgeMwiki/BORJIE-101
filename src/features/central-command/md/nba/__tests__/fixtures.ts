/**
 * Test fixtures shared across NBA tests.
 *
 * @module features/central-command/md/nba/__tests__/fixtures
 */

import type {
  ActionCandidate,
  ActionTemplate,
  BusinessSnapshot,
} from "../types";

export const sampleTemplate: ActionTemplate = Object.freeze({
  id: "test.sample",
  domain: "sales",
  title: "Test action",
  description: "Used in unit tests",
  baselineImpact: 7,
  baselineEase: 8,
  baselineConfidence: 0.7,
  baselineReach: 100,
  effortPersonDays: 2,
  effortBucket: "small",
  triggers: Object.freeze([{ kind: "always" } as const]),
  tags: Object.freeze(["test"]),
});

export const sampleCandidate: ActionCandidate = Object.freeze({
  template: sampleTemplate,
  contextualImpactLift: 1,
  contextualConfidenceLift: 0.1,
  contextualUrgencyLift: 5,
  reason: "test reason",
});

/** Healthy snapshot — light pressure, mostly always-on actions. */
export const healthySnapshot: BusinessSnapshot = Object.freeze({
  orgId: "org-1",
  generatedAt: "2026-05-17T00:00:00.000Z",
  customers: Object.freeze([
    {
      customerId: "c1",
      name: "Acme",
      npsScore: 9,
      csatScore: 5,
      lastContactDaysAgo: 7,
      openComplaints: 0,
      arrUsd: 50000,
    },
  ]),
  employees: Object.freeze([
    {
      employeeId: "e1",
      name: "Pat",
      daysSinceLast1on1: 14,
      engagementScore: 8,
      isNewHire: false,
      daysInRole: 365,
    },
  ]),
  pipeline: Object.freeze([
    {
      leadId: "l1",
      stage: "discovery",
      daysInStage: 3,
      valueUsd: 20000,
      probability: 0.4,
    },
  ]),
  suppliers: Object.freeze([
    {
      supplierId: "s1",
      name: "AWS",
      contractExpiresInDays: 200,
      criticality: "high" as const,
      annualSpendUsd: 24000,
    },
  ]),
  finance: Object.freeze({
    cashUsd: 1_200_000,
    monthlyBurnUsd: 80_000,
    overdueInvoicesCount: 0,
    overdueAmountUsd: 0,
  }),
  compliance: Object.freeze([]),
  learning: Object.freeze([]),
});

/** Stressed snapshot — many triggers fire (cash, contracts, NPS, etc). */
export const stressedSnapshot: BusinessSnapshot = Object.freeze({
  orgId: "org-2",
  generatedAt: "2026-05-17T00:00:00.000Z",
  customers: Object.freeze([
    {
      customerId: "c1",
      name: "Acme",
      npsScore: 3,
      csatScore: 2,
      lastContactDaysAgo: 90,
      openComplaints: 2,
      arrUsd: 120000,
    },
    {
      customerId: "c2",
      name: "Beta",
      npsScore: 8,
      csatScore: 5,
      lastContactDaysAgo: 14,
      openComplaints: 0,
      arrUsd: 40000,
    },
  ]),
  employees: Object.freeze([
    {
      employeeId: "e1",
      name: "Pat",
      daysSinceLast1on1: 120,
      engagementScore: 4,
      isNewHire: false,
      daysInRole: 540,
    },
    {
      employeeId: "e2",
      name: "Sam",
      daysSinceLast1on1: 7,
      engagementScore: 7,
      isNewHire: true,
      daysInRole: 14,
    },
  ]),
  pipeline: Object.freeze([
    {
      leadId: "l1",
      stage: "negotiation",
      daysInStage: 45,
      valueUsd: 150_000,
      probability: 0.6,
    },
    {
      leadId: "l2",
      stage: "discovery",
      daysInStage: 60,
      valueUsd: 20_000,
      probability: 0.2,
    },
  ]),
  suppliers: Object.freeze([
    {
      supplierId: "s1",
      name: "Vendor A",
      contractExpiresInDays: 10,
      criticality: "high" as const,
      annualSpendUsd: 120_000,
    },
  ]),
  finance: Object.freeze({
    cashUsd: 200_000,
    monthlyBurnUsd: 90_000,
    overdueInvoicesCount: 5,
    overdueAmountUsd: 75_000,
  }),
  compliance: Object.freeze([
    {
      obligationId: "ob1",
      description: "Annual tax filing",
      dueInDays: 7,
      status: "open" as const,
    },
  ]),
  learning: Object.freeze([
    {
      employeeId: "e2",
      trackName: "Onboarding 101",
      completionPercent: 20,
    },
  ]),
  ownerSentiment: Object.freeze({
    score: -0.4,
    recentTopics: Object.freeze(["cashflow", "customer"]),
  }),
  ownerStyle: Object.freeze({
    preferredMode: "bias-to-action" as const,
    easeBias: 0.8,
    impactBias: 0.6,
  }),
});
