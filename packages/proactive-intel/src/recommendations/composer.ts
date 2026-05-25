/**
 * Recommendation composer.
 *
 * Pure function: `DetectorEvent -> Recommendation`. Looks up copy via
 * action-copy.ts, packages an ag-ui ApprovalDialog spec, and emits the
 * Recommendation entity. Idempotent — same event in yields the same
 * recommendation (id derives from source event id).
 */
import type {
  AnomalyEvent,
  OpportunityEvent,
  DetectorEvent,
} from '../contracts/events.js';
import {
  copyForAnomaly,
  copyForOpportunity,
} from './action-copy.js';
import type {
  AnomalyRecommendation,
  OpportunityRecommendation,
  Recommendation,
  AgUiApprovalDialogPart,
} from './recommendation-types.js';

export function compose(event: DetectorEvent): Recommendation {
  if (event.type === 'anomaly') return composeAnomaly(event);
  return composeOpportunity(event);
}

function composeAnomaly(ev: AnomalyEvent): AnomalyRecommendation {
  const copy = copyForAnomaly(ev.kind);
  const correlationId = `rec:${ev.id}`;
  const summary = ev.headline;
  const body = `${ev.headline} ${copy.approvalAsk}`;
  const agUiPart: AgUiApprovalDialogPart = {
    kind: 'ag-ui.ApprovalDialog.v1',
    title: titleFor(ev.severity, summary),
    body,
    approveLabel: copy.approveLabel,
    declineLabel: copy.declineLabel,
    correlationId,
    ...(copy.estimatedDuration !== undefined
      ? { estimatedDuration: copy.estimatedDuration }
      : {}),
  };
  return {
    type: 'anomaly',
    kind: ev.kind,
    id: correlationId,
    tenantId: ev.tenantId,
    scope: ev.scope,
    confidence: ev.confidence,
    severity: ev.severity,
    projectedImpactUsdCents: 0,
    suggestedAction: copy.suggestedAction,
    approvalAsk: copy.approvalAsk,
    summary,
    agUiPart,
    createdAt: ev.detectedAt,
    sourceEventId: ev.id,
  };
}

function composeOpportunity(ev: OpportunityEvent): OpportunityRecommendation {
  const copy = copyForOpportunity(ev.kind);
  const correlationId = `rec:${ev.id}`;
  const summary = ev.headline;
  const body = `${ev.headline} ${copy.approvalAsk}`;
  const agUiPart: AgUiApprovalDialogPart = {
    kind: 'ag-ui.ApprovalDialog.v1',
    title: titleFor(ev.severity, summary),
    body,
    approveLabel: copy.approveLabel,
    declineLabel: copy.declineLabel,
    correlationId,
    ...(copy.estimatedDuration !== undefined
      ? { estimatedDuration: copy.estimatedDuration }
      : {}),
  };
  return {
    type: 'opportunity',
    kind: ev.kind,
    id: correlationId,
    tenantId: ev.tenantId,
    scope: ev.scope,
    confidence: ev.confidence,
    severity: ev.severity,
    projectedImpactUsdCents: ev.projectedImpactUsdCents,
    suggestedAction: copy.suggestedAction,
    approvalAsk: copy.approvalAsk,
    summary,
    agUiPart,
    createdAt: ev.detectedAt,
    sourceEventId: ev.id,
  };
}

function titleFor(severity: string, summary: string): string {
  const prefix =
    severity === 'P0'
      ? 'Boss, act now: '
      : severity === 'P1'
        ? 'Boss, heads-up: '
        : 'Boss, FYI: ';
  return `${prefix}${summary}`;
}
