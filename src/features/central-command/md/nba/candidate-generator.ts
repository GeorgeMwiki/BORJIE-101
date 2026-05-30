/**
 * Candidate generator — maps a BusinessSnapshot to ActionCandidates.
 *
 * Each template's triggers are evaluated against the snapshot. Matches
 * produce one or more candidates with contextual lifts (impact, confidence,
 * urgency). Lifts are bounded; baselines are never mutated.
 *
 * Pure: same input -> same output. No I/O.
 *
 * @module features/central-command/md/nba/candidate-generator
 */

import { ACTION_CATALOG } from "./action-catalog";
import { clamp } from "./ice-scorer";
import type {
  ActionCandidate,
  ActionTemplate,
  ActionTrigger,
  BusinessSnapshot,
} from "./types";

interface Match {
  readonly subjectRef?: string;
  readonly impactLift: number;
  readonly confidenceLift: number;
  readonly urgencyLift: number;
  readonly reason: string;
}

/** Build candidate actions from a snapshot. Pure. */
export function generateCandidates(
  snapshot: BusinessSnapshot,
  catalog: readonly ActionTemplate[] = ACTION_CATALOG,
): readonly ActionCandidate[] {
  const out: ActionCandidate[] = [];
  for (const tpl of catalog) {
    for (const trigger of tpl.triggers) {
      const matches = matchTrigger(trigger, snapshot);
      for (const match of matches) {
        out.push(
          Object.freeze({
            template: tpl,
            subjectRef: match.subjectRef,
            contextualImpactLift: clamp(match.impactLift, -5, 5),
            contextualConfidenceLift: clamp(match.confidenceLift, -0.5, 0.5),
            contextualUrgencyLift: clamp(match.urgencyLift, 0, 10),
            reason: match.reason,
          }),
        );
      }
    }
  }
  return Object.freeze(out);
}

function matchTrigger(
  trigger: ActionTrigger,
  s: BusinessSnapshot,
): readonly Match[] {
  switch (trigger.kind) {
    case "always":
      return [
        {
          impactLift: 0,
          confidenceLift: 0,
          urgencyLift: defaultUrgency(s),
          reason: "Always-on best practice",
        },
      ];
    case "nps-drop":
      return s.customers
        .filter(
          (c) =>
            c.npsScore !== undefined && c.npsScore <= (trigger.threshold ?? 6),
        )
        .map((c) => ({
          subjectRef: c.customerId,
          impactLift: c.npsScore !== undefined ? (6 - c.npsScore) * 0.4 : 0,
          confidenceLift: 0.05,
          urgencyLift: 7,
          reason: `NPS dropped to ${c.npsScore} for ${c.name}`,
        }));
    case "csat-drop":
      return s.customers
        .filter(
          (c) =>
            c.csatScore !== undefined &&
            c.csatScore <= (trigger.threshold ?? 4),
        )
        .map((c) => ({
          subjectRef: c.customerId,
          impactLift: 1,
          confidenceLift: 0.05,
          urgencyLift: 6,
          reason: `CSAT for ${c.name} = ${c.csatScore}`,
        }));
    case "pipeline-stalled":
      return s.pipeline
        .filter((p) => p.daysInStage >= (trigger.threshold ?? 14))
        .map((p) => ({
          subjectRef: p.leadId,
          impactLift: Math.min(2, p.valueUsd / 50000),
          confidenceLift: -0.05,
          urgencyLift: 7,
          reason: `Lead ${p.leadId} stuck ${p.daysInStage}d in ${p.stage}`,
        }));
    case "lead-aging":
      return s.pipeline
        .filter((p) => p.daysInStage >= (trigger.threshold ?? 30))
        .slice(0, 3)
        .map((p) => ({
          subjectRef: p.leadId,
          impactLift: -1,
          confidenceLift: 0.1,
          urgencyLift: 5,
          reason: `Lead ${p.leadId} aging for ${p.daysInStage} days`,
        }));
    case "contract-expiring":
      return s.suppliers
        .filter((sp) => sp.contractExpiresInDays <= (trigger.threshold ?? 30))
        .map((sp) => ({
          subjectRef: sp.supplierId,
          impactLift:
            sp.criticality === "high" ? 2 : sp.criticality === "medium" ? 1 : 0,
          confidenceLift: 0.05,
          urgencyLift: clamp(10 - sp.contractExpiresInDays / 4, 5, 10),
          reason: `${sp.name} contract expires in ${sp.contractExpiresInDays}d`,
        }));
    case "employee-1on1-overdue":
      return s.employees
        .filter((e) => e.daysSinceLast1on1 >= (trigger.threshold ?? 90))
        .map((e) => ({
          subjectRef: e.employeeId,
          impactLift: 0.5,
          confidenceLift: 0.05,
          urgencyLift: 6,
          reason: `${e.name} last 1-on-1: ${e.daysSinceLast1on1}d ago`,
        }));
    case "complaint-open":
      return s.customers
        .filter((c) => c.openComplaints >= (trigger.threshold ?? 1))
        .map((c) => ({
          subjectRef: c.customerId,
          impactLift: 1,
          confidenceLift: 0.05,
          urgencyLift: 8,
          reason: `${c.name} has ${c.openComplaints} open complaint(s)`,
        }));
    case "new-hire-onboarding":
      return s.employees
        .filter((e) => e.isNewHire && e.daysInRole <= 30)
        .map((e) => ({
          subjectRef: e.employeeId,
          impactLift: 1,
          confidenceLift: 0.05,
          urgencyLift: 6,
          reason: `${e.name} is a new hire (${e.daysInRole}d)`,
        }));
    case "cash-runway-low": {
      const runwayMonths =
        s.finance.monthlyBurnUsd > 0
          ? s.finance.cashUsd / s.finance.monthlyBurnUsd
          : Infinity;
      const threshold = trigger.threshold ?? 6;
      if (runwayMonths >= threshold) return [];
      return [
        {
          impactLift: 2,
          confidenceLift: 0.05,
          urgencyLift: clamp(10 - runwayMonths, 6, 10),
          reason: `Cash runway = ${runwayMonths.toFixed(1)} months`,
        },
      ];
    }
    case "invoice-overdue":
      if (s.finance.overdueInvoicesCount < (trigger.threshold ?? 1)) return [];
      return [
        {
          impactLift: Math.min(2, s.finance.overdueAmountUsd / 50000),
          confidenceLift: 0.1,
          urgencyLift: 7,
          reason: `${s.finance.overdueInvoicesCount} invoices overdue`,
        },
      ];
    case "supplier-renewal-due":
      return s.suppliers
        .filter((sp) => sp.contractExpiresInDays <= 45)
        .map((sp) => ({
          subjectRef: sp.supplierId,
          impactLift: sp.criticality === "high" ? 2 : 0,
          confidenceLift: 0,
          urgencyLift: 6,
          reason: `${sp.name} renewal due`,
        }));
    case "kpi-off-target":
      return [
        {
          impactLift: 1,
          confidenceLift: 0,
          urgencyLift: 5,
          reason: "KPI off-target",
        },
      ];
    case "training-completion-low":
      return s.learning
        .filter((l) => l.completionPercent <= (trigger.threshold ?? 50))
        .slice(0, 5)
        .map((l) => ({
          subjectRef: l.employeeId,
          impactLift: 0,
          confidenceLift: 0,
          urgencyLift: 4,
          reason: `Completion ${l.completionPercent}% on ${l.trackName}`,
        }));
    case "compliance-deadline":
      return s.compliance
        .filter((c) => c.dueInDays <= (trigger.threshold ?? 14))
        .map((c) => ({
          subjectRef: c.obligationId,
          impactLift: 2,
          confidenceLift: 0.1,
          urgencyLift: clamp(10 - c.dueInDays / 2, 6, 10),
          reason: `${c.description} due in ${c.dueInDays}d`,
        }));
  }
}

/** Background urgency for always-on actions — picks up macro stress. */
function defaultUrgency(s: BusinessSnapshot): number {
  const runwayMonths =
    s.finance.monthlyBurnUsd > 0
      ? s.finance.cashUsd / s.finance.monthlyBurnUsd
      : Infinity;
  if (runwayMonths < 3) return 7;
  if (runwayMonths < 6) return 5;
  return 3;
}
