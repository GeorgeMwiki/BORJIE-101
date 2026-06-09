/**
 * DiscoveryCard → Recommendation adapter.
 *
 * The scientific-discovery loop emits a `DiscoveryCard` (a verified
 * causal hypothesis + DAG + refutation + recommended action). The
 * worker's existing delivery plumbing speaks `Recommendation` (the
 * proactive-intel chat-workspace entity). This pure adapter renders the
 * card into an anomaly-type `Recommendation` so a discovery surfaces
 * through the SAME sink as a fired trigger.
 *
 * Pure function. No I/O. Immutable output.
 */
import type { AnomalyKind, Recommendation } from '@borjie/proactive-intel';
import type { DiscoveryCard } from '@borjie/scientific-discovery';

export interface CardToRecommendationInput {
  readonly tenantId: string;
  readonly card: DiscoveryCard;
  /** The recurring anomaly kind that seeded this discovery round. */
  readonly sourceKind: AnomalyKind;
  /** Originating anomaly event id, for traceability. */
  readonly sourceEventId: string;
  readonly nowIso: string;
}

/**
 * Confidence is derived from the card's risk score (risk is the inverse
 * of evidence strength): low risk → high confidence.
 */
function confidenceFromRisk(risk: number): Recommendation['confidence'] {
  const score = clamp01(1 - risk);
  const label: 'low' | 'medium' | 'high' =
    score >= 0.66 ? 'high' : score >= 0.33 ? 'medium' : 'low';
  return { label, score };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function cardToRecommendation(
  input: CardToRecommendationInput,
): Recommendation {
  const { card, tenantId, sourceKind, sourceEventId, nowIso } = input;
  const confidence = confidenceFromRisk(card.riskScore);

  // Discovery cards are insight-class, not act-now — surface at P2 so
  // they land in the digest rather than interrupting the chat with a P0.
  const severity = 'P2' as const;

  const summary = `Causal discovery: ${card.title}`;
  const suggestedAction = card.recommendedAction;
  const approvalAsk = 'Want me to draft a plan to validate this discovery?';

  return Object.freeze({
    type: 'anomaly',
    kind: sourceKind,
    id: `discovery-${card.id}`,
    tenantId,
    scope: 'tenant',
    confidence,
    severity,
    projectedImpactUsdCents: 0,
    suggestedAction,
    approvalAsk,
    summary,
    agUiPart: Object.freeze({
      kind: 'ag-ui.ApprovalDialog.v1' as const,
      title: card.title,
      body: `${summary}. ${suggestedAction}`,
      approveLabel: 'Draft validation plan',
      declineLabel: 'Dismiss',
      correlationId: `discovery-${card.id}`,
    }),
    createdAt: nowIso,
    sourceEventId,
  });
}
