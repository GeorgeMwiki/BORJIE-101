/**
 * Default event → risk classifier — Wave 27 (Part B.6).
 *
 * Maps a domain event type + payload to the set of risk scores that
 * should be recomputed. Each rule is deliberately narrow so an event
 * cannot accidentally recompute every score in the system.
 *
 * Supported triggers (see phM-platform-blueprint Part B.6):
 *   - PaymentReceived / PaymentMissed    → credit_rating + churn_probability
 *   - LeaseSigned / LeaseTerminated      → credit_rating + property_grade
 *   - ArrearsCaseOpened                  → credit_rating + churn_probability
 *   - InspectionCompleted                → property_grade
 *   - WorkOrderClosed                    → vendor_scorecard
 *   - MessageReceived (low sentiment)    → tenant_sentiment + churn_probability
 *   - RenewalConversationUpdated         → churn_probability
 *   - MaintenancePhotoUploaded           → property_grade
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

    case 'LeaseSigned':
    case 'LeaseTerminated': {
      const customerId = str(payload.customerId) ?? str(payload.tenantCustomerId);
      const propertyId = str(payload.propertyId);
      if (customerId) {
        matches.push({ kind: 'credit_rating', entityId: customerId });
        matches.push({ kind: 'churn_probability', entityId: customerId });
      }
      if (propertyId) {
        matches.push({ kind: 'property_grade', entityId: propertyId });
      }
      break;
    }

    case 'ArrearsCaseOpened':
    case 'ArrearsCaseClosed': {
      const customerId = str(payload.customerId);
      if (customerId) {
        matches.push({ kind: 'credit_rating', entityId: customerId });
        matches.push({ kind: 'churn_probability', entityId: customerId });
      }
      break;
    }

    case 'InspectionCompleted':
    case 'PropertyInspectionSurveyAdded': {
      const propertyId = str(payload.propertyId);
      if (propertyId) {
        matches.push({ kind: 'property_grade', entityId: propertyId });
      }
      break;
    }

    case 'WorkOrderClosed':
    case 'WorkOrderResolved': {
      const vendorId = str(payload.vendorId);
      const propertyId = str(payload.propertyId);
      if (vendorId) {
        matches.push({ kind: 'vendor_scorecard', entityId: vendorId });
      }
      if (propertyId) {
        matches.push({ kind: 'property_grade', entityId: propertyId });
      }
      break;
    }

    case 'MessageReceived':
    case 'TenantChatMessage': {
      const customerId = str(payload.customerId) ?? str(payload.fromCustomerId);
      if (customerId) {
        matches.push({ kind: 'tenant_sentiment', entityId: customerId });
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
      const propertyId = str(payload.propertyId);
      if (propertyId) {
        matches.push({ kind: 'property_grade', entityId: propertyId });
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
