/**
 * Routing → recommendation projector (thin, read-only wire).
 *
 * Turns a `DataRoutingDecision` into the EXISTING `Recommendation` shape
 * the proactive-triggers worker already publishes through its
 * notification sink + the chat tab-spawn path. ADDITIVE — it feeds the
 * existing surface; it does not modify the worker or the composer.
 *
 * Only decisions that warrant the owner's attention project to a
 * recommendation: anything gated, low-confidence, no-match, or carrying a
 * dated follow-up/reminder. A clean auto-eligible 'nothing' decision
 * produces no recommendation (file-and-forget — no notification noise).
 *
 * CONSTITUTIONAL: a gated decision projects an APPROVAL dialog (the owner
 * must act); it is never framed as an already-done action.
 */
import type { Recommendation } from '../recommendations/recommendation-types.js';
import type { AgUiApprovalDialogPart } from '../recommendations/recommendation-types.js';
import type { Confidence, Severity } from '../contracts/events.js';
import type { DataRoutingDecision } from './routing-types.js';

/**
 * Project a routing decision into a recommendation, or `null` when no
 * owner-facing surface is warranted.
 */
export function recommendationFromRouting(
  decision: DataRoutingDecision,
): Recommendation | null {
  if (!warrantsSurface(decision)) return null;

  const correlationId = `route:${decision.datumId}`;
  const severity = severityFor(decision);
  const confidence = confidenceFor(decision);
  const summary = decision.rationale.summary;

  const { approveLabel, declineLabel, approvalAsk, suggestedAction } =
    copyFor(decision);

  const agUiPart: AgUiApprovalDialogPart = {
    kind: 'ag-ui.ApprovalDialog.v1',
    title: titleFor(severity, summary),
    body: `${summary} ${approvalAsk}`,
    approveLabel,
    declineLabel,
    correlationId,
  };

  return {
    // A routed datum is surfaced as a compliance-shaped anomaly so it
    // rides the EXISTING anomaly recommendation rendering. The `kind`
    // 'compliance-deadline-near' is reused for dated obligations; other
    // routings ride 'churn-risk' as the generic owner-attention bucket.
    type: 'anomaly',
    kind:
      decision.obligation !== null
        ? 'compliance-deadline-near'
        : 'churn-risk',
    id: correlationId,
    tenantId: decision.tenantId,
    scope: decision.tenantId === null ? 'platform-internal' : 'tenant',
    confidence,
    severity,
    projectedImpactUsdCents: 0,
    suggestedAction,
    approvalAsk,
    summary,
    agUiPart,
    createdAt: decision.decidedAt,
    sourceEventId: decision.datumId,
  };
}

function warrantsSurface(decision: DataRoutingDecision): boolean {
  if (decision.requiresHumanApproval) return true;
  if (decision.need === 'follow-up' || decision.need === 'reminder') return true;
  if (decision.need === 'workflow') return true;
  return false; // clean auto-eligible 'nothing' — no noise
}

function severityFor(decision: DataRoutingDecision): Severity {
  const days = decision.obligation?.daysUntilDue;
  if (days !== undefined) {
    if (days <= 3) return 'P0';
    if (days <= 14) return 'P1';
    if (days <= 30) return 'P2';
    return 'P3';
  }
  if (decision.requiresHumanApproval) return 'P1';
  return 'P2';
}

function confidenceFor(decision: DataRoutingDecision): Confidence {
  const score = decision.rationale.destinationConfidence;
  const label: Confidence['label'] =
    score >= 0.8 ? 'high' : score >= 0.5 ? 'medium' : 'low';
  return { label, score } as Confidence;
}

function copyFor(decision: DataRoutingDecision): {
  approveLabel: string;
  declineLabel: string;
  approvalAsk: string;
  suggestedAction: string;
} {
  if (decision.targetModule === 'unknown') {
    return {
      approveLabel: 'Triage now',
      declineLabel: 'Later',
      approvalAsk: 'Want me to open a triage ticket?',
      suggestedAction: `Triage an unrecognised "${decision.datumId}".`,
    };
  }
  if (decision.requiresHumanApproval) {
    return {
      approveLabel: 'Confirm filing',
      declineLabel: 'Edit first',
      approvalAsk: 'File it where I suggested?',
      suggestedAction: `File to ${decision.targetModule}.${decision.targetAction}.`,
    };
  }
  if (decision.need === 'workflow') {
    return {
      approveLabel: 'Start workflow',
      declineLabel: 'Not now',
      approvalAsk: `Start the ${decision.workflowHint ?? 'workflow'}?`,
      suggestedAction: `Run ${decision.workflowHint ?? 'the workflow'} for this item.`,
    };
  }
  return {
    approveLabel: 'Schedule reminder',
    declineLabel: 'Dismiss',
    approvalAsk: 'Want me to remind you?',
    suggestedAction: decision.rationale.summary,
  };
}

function titleFor(severity: Severity, summary: string): string {
  const prefix =
    severity === 'P0'
      ? 'Boss, act now: '
      : severity === 'P1'
        ? 'Boss, heads-up: '
        : 'Boss, FYI: ';
  return `${prefix}${summary}`;
}
