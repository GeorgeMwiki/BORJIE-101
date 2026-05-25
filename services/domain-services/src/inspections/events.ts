/**
 * Inspection Domain Events
 * Published when significant inspection lifecycle events occur.
 */

import type { DomainEvent } from '../common/events.js';
import type {
  InspectionId,
  InspectionType,
  InspectionStatus,
  DamageComparison,
} from './types.js';

// ============================================================================
// Inspection Events
// ============================================================================

export interface InspectionScheduledEvent extends DomainEvent {
  readonly eventType: 'InspectionScheduled';
  readonly payload: {
    readonly inspectionId: InspectionId;
    readonly propertyId: string;
    readonly unitId: string;
    readonly type: InspectionType;
    readonly scheduledDate: string;
    readonly tenantId: string;
  };
}

export interface InspectionCompletedEvent extends DomainEvent {
  readonly eventType: 'InspectionCompleted';
  readonly payload: {
    readonly inspectionId: InspectionId;
    readonly propertyId: string;
    readonly unitId: string;
    readonly type: InspectionType;
    readonly completedAt: string;
    readonly status: InspectionStatus;
    readonly roomCount: number;
    readonly itemCount: number;
  };
}

export interface InspectionSignedEvent extends DomainEvent {
  readonly eventType: 'InspectionSigned';
  readonly payload: {
    readonly inspectionId: InspectionId;
    readonly propertyId: string;
    readonly unitId: string;
    readonly signerId: string;
    readonly signerRole: 'tenant' | 'inspector' | 'manager';
    readonly signedAt: string;
  };
}

export interface DamageIdentifiedEvent extends DomainEvent {
  readonly eventType: 'DamageIdentified';
  readonly payload: {
    readonly moveInId: InspectionId;
    readonly moveOutId: InspectionId;
    readonly propertyId: string;
    readonly unitId: string;
    readonly damages: readonly DamageComparison[];
    readonly totalDamagedItems: number;
    readonly estimatedDeduction: number | null;
  };
}
