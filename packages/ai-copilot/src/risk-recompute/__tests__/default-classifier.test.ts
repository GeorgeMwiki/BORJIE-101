/**
 * Tests for risk-recompute/default-classifier — Wave 27 Part B.6.
 *
 * Coverage: every event-type branch, payload-key fallbacks, missing-id
 * skip, unknown-event-type returns empty, no cross-contamination across
 * event kinds.
 */

import { describe, it, expect } from 'vitest';
import { defaultRiskEventClassifier } from '../default-classifier.js';

describe('defaultRiskEventClassifier', () => {
  it('returns empty for an unknown event type', () => {
    expect(
      defaultRiskEventClassifier('NoSuchEvent', { customerId: 'c1' }),
    ).toEqual([]);
  });

  it('PaymentReceived dispatches credit_rating + churn_probability', () => {
    const out = defaultRiskEventClassifier('PaymentReceived', {
      customerId: 'cust-1',
    });
    expect(out).toEqual([
      { kind: 'credit_rating', entityId: 'cust-1' },
      { kind: 'churn_probability', entityId: 'cust-1' },
    ]);
  });

  it('PaymentMissed falls back to payerId when customerId is absent', () => {
    const out = defaultRiskEventClassifier('PaymentMissed', {
      payerId: 'cust-2',
    });
    expect(out.map((m) => m.kind)).toEqual([
      'credit_rating',
      'churn_probability',
    ]);
    expect(out.every((m) => m.entityId === 'cust-2')).toBe(true);
  });

  it('PaymentReceived with no id returns nothing', () => {
    expect(defaultRiskEventClassifier('PaymentReceived', {})).toEqual([]);
  });

  it('LeaseSigned dispatches credit_rating, churn_probability, property_grade', () => {
    const out = defaultRiskEventClassifier('LeaseSigned', {
      customerId: 'cust-1',
      propertyId: 'prop-1',
    });
    expect(out.map((m) => m.kind).sort()).toEqual([
      'churn_probability',
      'credit_rating',
      'property_grade',
    ]);
  });

  it('LeaseTerminated falls back to tenantCustomerId', () => {
    const out = defaultRiskEventClassifier('LeaseTerminated', {
      tenantCustomerId: 'cust-2',
      propertyId: 'prop-2',
    });
    expect(out.find((m) => m.kind === 'credit_rating')?.entityId).toBe('cust-2');
    expect(out.find((m) => m.kind === 'property_grade')?.entityId).toBe('prop-2');
  });

  it('LeaseSigned without ids returns empty array', () => {
    expect(defaultRiskEventClassifier('LeaseSigned', {})).toEqual([]);
  });

  it('ArrearsCaseOpened dispatches credit_rating + churn_probability', () => {
    const out = defaultRiskEventClassifier('ArrearsCaseOpened', {
      customerId: 'cust-1',
    });
    expect(out).toEqual([
      { kind: 'credit_rating', entityId: 'cust-1' },
      { kind: 'churn_probability', entityId: 'cust-1' },
    ]);
  });

  it('ArrearsCaseClosed dispatches the same set as ArrearsCaseOpened', () => {
    const out = defaultRiskEventClassifier('ArrearsCaseClosed', {
      customerId: 'c',
    });
    expect(out.map((m) => m.kind)).toEqual([
      'credit_rating',
      'churn_probability',
    ]);
  });

  it('InspectionCompleted dispatches property_grade only', () => {
    const out = defaultRiskEventClassifier('InspectionCompleted', {
      propertyId: 'p1',
    });
    expect(out).toEqual([{ kind: 'property_grade', entityId: 'p1' }]);
  });

  it('PropertyInspectionSurveyAdded also maps to property_grade', () => {
    const out = defaultRiskEventClassifier('PropertyInspectionSurveyAdded', {
      propertyId: 'p1',
    });
    expect(out).toEqual([{ kind: 'property_grade', entityId: 'p1' }]);
  });

  it('WorkOrderClosed dispatches vendor_scorecard + property_grade', () => {
    const out = defaultRiskEventClassifier('WorkOrderClosed', {
      vendorId: 'v1',
      propertyId: 'p1',
    });
    expect(out.map((m) => m.kind).sort()).toEqual([
      'property_grade',
      'vendor_scorecard',
    ]);
  });

  it('WorkOrderResolved with vendor only emits vendor_scorecard', () => {
    const out = defaultRiskEventClassifier('WorkOrderResolved', {
      vendorId: 'v1',
    });
    expect(out).toEqual([{ kind: 'vendor_scorecard', entityId: 'v1' }]);
  });

  it('MessageReceived dispatches tenant_sentiment + churn_probability', () => {
    const out = defaultRiskEventClassifier('MessageReceived', {
      customerId: 'c1',
    });
    expect(out.map((m) => m.kind)).toEqual([
      'tenant_sentiment',
      'churn_probability',
    ]);
  });

  it('TenantChatMessage falls back to fromCustomerId', () => {
    const out = defaultRiskEventClassifier('TenantChatMessage', {
      fromCustomerId: 'c-x',
    });
    expect(out.find((m) => m.kind === 'tenant_sentiment')?.entityId).toBe('c-x');
  });

  it('RenewalConversationUpdated dispatches churn_probability only', () => {
    const out = defaultRiskEventClassifier('RenewalConversationUpdated', {
      customerId: 'c1',
    });
    expect(out).toEqual([{ kind: 'churn_probability', entityId: 'c1' }]);
  });

  it('MaintenancePhotoUploaded dispatches property_grade only', () => {
    const out = defaultRiskEventClassifier('MaintenancePhotoUploaded', {
      propertyId: 'p1',
    });
    expect(out).toEqual([{ kind: 'property_grade', entityId: 'p1' }]);
  });

  it('rejects empty-string ids', () => {
    expect(
      defaultRiskEventClassifier('PaymentReceived', { customerId: '' }),
    ).toEqual([]);
  });

  it('rejects non-string id types', () => {
    expect(
      defaultRiskEventClassifier('PaymentReceived', { customerId: 12345 }),
    ).toEqual([]);
  });
});
