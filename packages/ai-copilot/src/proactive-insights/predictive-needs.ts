/**
 * Predictive needs
 *
 * Predicts what the user is most likely to need next. Currently rule-based
 * (seeded from operator heuristics). If Agent E\u2019s decision-feedback schema
 * lands, this module can read telemetry and pick weights from learned data.
 */

import type { InsightContext, InsightCategory } from './types.js';

export interface PredictedNeed {
  readonly category: InsightCategory;
  readonly confidence: number;
  readonly hint: string;
}

const ROLE_BIAS: Readonly<
  Record<InsightContext['role'], readonly InsightCategory[]>
> = {
  owner: ['arrears_followup', 'renewal_opportunity', 'compliance_reminder'],
  manager: [
    'maintenance_escalation',
    'arrears_followup',
    'inspection_followup',
  ],
  tenant: ['tenant_satisfaction', 'workflow_unblock'],
  admin: ['compliance_reminder', 'vendor_swap'],
  agent: ['renewal_opportunity', 'tenant_satisfaction'],
};

export function predictNeeds(
  context: InsightContext,
): readonly PredictedNeed[] {
  const biased = ROLE_BIAS[context.role] ?? [];
  const scored: PredictedNeed[] = [];

  if (context.openArrearsCases && context.openArrearsCases > 0) {
    scored.push({
      category: 'arrears_followup',
      confidence: clamp(0.4 + context.openArrearsCases * 0.05, 0, 0.95),
      hint: `${context.openArrearsCases} open arrears case${context.openArrearsCases === 1 ? '' : 's'}`,
    });
  }
  if (context.leasesExpiring90 && context.leasesExpiring90 > 0) {
    scored.push({
      category: 'renewal_opportunity',
      confidence: clamp(0.3 + context.leasesExpiring90 * 0.04, 0, 0.9),
      hint: `${context.leasesExpiring90} lease${context.leasesExpiring90 === 1 ? '' : 's'} near expiry`,
    });
  }
  if (context.overdueTickets && context.overdueTickets > 0) {
    scored.push({
      category: 'maintenance_escalation',
      confidence: clamp(0.3 + context.overdueTickets * 0.07, 0, 0.95),
      hint: `${context.overdueTickets} overdue ticket${context.overdueTickets === 1 ? '' : 's'}`,
    });
  }
  if (context.expiringCompliance && context.expiringCompliance > 0) {
    scored.push({
      category: 'compliance_reminder',
      confidence: 0.8,
      hint: `${context.expiringCompliance} compliance notice${context.expiringCompliance === 1 ? '' : 's'} expiring`,
    });
  }

  // Role-based fallback so we always recommend at least something sensible.
  if (scored.length === 0) {
    for (const category of biased) {
      scored.push({
        category,
        confidence: 0.3,
        hint: 'default role bias',
      });
    }
  }

  return scored.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
