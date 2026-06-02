/**
 * Default event → risk classifier — Wave 27 (Part B.6).
 *
 * Maps a domain event type + payload to the set of risk scores that
 * should be recomputed. Each rule is deliberately narrow so an event
 * cannot accidentally recompute every score in the system.
 *
 * Supported triggers (see phM-platform-blueprint Part B.6):
 *   - PaymentReceived / PaymentMissed    → credit_rating + churn_probability
 *   - OfftakeSigned / OfftakeTerminated  → credit_rating + asset_grade
 *   - OutstandingRoyaltiesCaseOpened     → credit_rating + churn_probability
 *   - InspectionCompleted                → asset_grade
 *   - WorkOrderClosed                    → vendor_scorecard
 *   - MessageReceived (low sentiment)    → buyer_sentiment + churn_probability
 *   - RenewalConversationUpdated         → churn_probability
 *   - MaintenancePhotoUploaded           → asset_grade
 *
 * NOTE: the `eventType` case labels + `payload.*Id` keys mirror the
 * platform event-bus contract emitted by other packages and are read
 * verbatim (with additive mining-key fallbacks) so the matcher keeps
 * firing while emitters migrate in lockstep.
 */

import type { RiskEventClassifier, RiskTriggerMatch } from './types.js';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export const defaultRiskEventClassifier: RiskEventClassifier = (
  eventType,
  payload,
) => {
  const matches: RiskTriggerMatch[] = [];

  switch (eventType) {
    case 'PaymentReceived':
    case 'PaymentMissed': {
      const customerId = str(payload.customerId) ?? str(payload.payerId);
      if (customerId) {
        matches.push({ kind: 'credit_rating', entityId: customerId });
        matches.push({ kind: 'churn_probability', entityId: customerId });
      }
      break;
    }

    case 'OfftakeSigned':
    case 'OfftakeTerminated': {
      const customerId = str(payload.customerId) ?? str(payload.tenantCustomerId);
      const assetId = str(payload.assetId) ?? str(payload.propertyId);
      if (customerId) {
        matches.push({ kind: 'credit_rating', entityId: customerId });
        matches.push({ kind: 'churn_probability', entityId: customerId });
      }
      if (assetId) {
        matches.push({ kind: 'asset_grade', entityId: assetId });
      }
      break;
    }

    case 'OutstandingRoyaltiesCaseOpened':
    case 'ArrearsCaseClosed': {
      const customerId = str(payload.customerId);
      if (customerId) {
        matches.push({ kind: 'credit_rating', entityId: customerId });
        matches.push({ kind: 'churn_probability', entityId: customerId });
      }
      break;
    }

    case 'InspectionCompleted':
    case 'SiteInspectionSurveyAdded': {
      const assetId = str(payload.assetId) ?? str(payload.propertyId);
      if (assetId) {
        matches.push({ kind: 'asset_grade', entityId: assetId });
      }
      break;
    }

    case 'WorkOrderClosed':
    case 'WorkOrderResolved': {
      const vendorId = str(payload.vendorId);
      const assetId = str(payload.assetId) ?? str(payload.propertyId);
      if (vendorId) {
        matches.push({ kind: 'vendor_scorecard', entityId: vendorId });
      }
      if (assetId) {
        matches.push({ kind: 'asset_grade', entityId: assetId });
      }
      break;
    }

    case 'MessageReceived':
    case 'CounterpartyChatMessage': {
      const customerId = str(payload.customerId) ?? str(payload.fromCustomerId);
      if (customerId) {
        matches.push({ kind: 'buyer_sentiment', entityId: customerId });
        matches.push({ kind: 'churn_probability', entityId: customerId });
      }
      break;
    }

    case 'RenewalConversationUpdated': {
      const customerId = str(payload.customerId);
      if (customerId) {
        matches.push({ kind: 'churn_probability', entityId: customerId });
      }
      break;
    }

    case 'MaintenancePhotoUploaded': {
      const assetId = str(payload.assetId) ?? str(payload.propertyId);
      if (assetId) {
        matches.push({ kind: 'asset_grade', entityId: assetId });
      }
      break;
    }

    default:
      // Unknown event — skip. Callers can extend with a wrapping
      // classifier that delegates here for its fallback branch.
      break;
  }

  return matches;
};
