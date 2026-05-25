/**
 * Inspection domain model
 * Property and unit inspection management
 */

import type { Brand, TenantId, UserId, EntityMetadata, ISOTimestamp } from '../common/types';
import type { PropertyId } from '../property/property';
import type { UnitId } from '../property/unit';

export type InspectionId = Brand<string, 'InspectionId'>;

export function asInspectionId(id: string): InspectionId {
  return id as InspectionId;
}

/** Inspection type */
export type InspectionType =
  | 'move_in'
  | 'move_out'
  | 'routine'
  | 'annual'
  | 'pre_lease'
  | 'maintenance_followup'
  | 'complaint';

/** Inspection status */
export type InspectionStatus =
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'missed';

/** Overall condition rating */
export type ConditionRating = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

/** Inspection area/item */
export interface InspectionItem {
  readonly area: string; // e.g., "Kitchen", "Master Bedroom"
  readonly item: string; // e.g., "Sink", "Walls"
  readonly condition: ConditionRating;
  readonly notes: string | null;
  readonly requiresAction: boolean;
  readonly photoUrls: readonly string[];
}

/** Inspection checklist template */
export interface InspectionChecklist {
  readonly area: string;
  readonly items: readonly string[];
}

/** Standard inspection checklist */
export const STANDARD_INSPECTION_CHECKLIST: InspectionChecklist[] = [
  {
    area: 'Living Room',
    items: ['Walls', 'Ceiling', 'Flooring', 'Windows', 'Doors', 'Electrical outlets', 'Light fixtures'],
  },
  {
    area: 'Kitchen',
    items: ['Cabinets', 'Countertops', 'Sink', 'Faucet', 'Stove', 'Oven', 'Refrigerator', 'Dishwasher', 'Exhaust fan', 'Flooring'],
  },
  {
    area: 'Bathroom',
    items: ['Toilet', 'Sink', 'Shower/Tub', 'Faucets', 'Tiles', 'Exhaust fan', 'Mirror', 'Towel racks'],
  },
  {
    area: 'Bedroom',
    items: ['Walls', 'Ceiling', 'Flooring', 'Closet', 'Windows', 'Doors', 'Electrical outlets', 'Light fixtures'],
  },
  {
    area: 'Exterior',
    items: ['Front door', 'Back door', 'Windows', 'Balcony/Patio', 'Parking area', 'Security features'],
  },
  {
    area: 'Systems',
    items: ['HVAC', 'Water heater', 'Electrical panel', 'Smoke detectors', 'Carbon monoxide detectors'],
  },
];

/**
 * Inspection entity
 */
export interface Inspection extends EntityMetadata {
  readonly id: InspectionId;
  readonly tenantId: TenantId;
  readonly inspectionNumber: string; // e.g., "INS-2024-0001"
  readonly propertyId: PropertyId;
  readonly unitId: UnitId;
  readonly type: InspectionType;
  readonly status: InspectionStatus;
  readonly scheduledDate: ISOTimestamp;
  readonly scheduledTimeSlot: string | null;
  readonly assignedTo: UserId;
  readonly startedAt: ISOTimestamp | null;
  readonly completedAt: ISOTimestamp | null;
  readonly overallCondition: ConditionRating | null;
  readonly items: readonly InspectionItem[];
  readonly summary: string | null;
  readonly recommendations: string | null;
  readonly followUpRequired: boolean;
  readonly followUpNotes: string | null;
  readonly customerPresent: boolean;
  readonly customerSignatureUrl: string | null;
  readonly inspectorSignatureUrl: string | null;
  readonly reportUrl: string | null;
}

/** Create a new inspection */
export function createInspection(
  id: InspectionId,
  data: {
    tenantId: TenantId;
    inspectionNumber: string;
    propertyId: PropertyId;
    unitId: UnitId;
    type: InspectionType;
    scheduledDate: ISOTimestamp;
    scheduledTimeSlot?: string;
    assignedTo: UserId;
  },
  createdBy: UserId
): Inspection {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    inspectionNumber: data.inspectionNumber,
    propertyId: data.propertyId,
    unitId: data.unitId,
    type: data.type,
    status: 'scheduled',
    scheduledDate: data.scheduledDate,
    scheduledTimeSlot: data.scheduledTimeSlot ?? null,
    assignedTo: data.assignedTo,
    startedAt: null,
    completedAt: null,
    overallCondition: null,
    items: [],
    summary: null,
    recommendations: null,
    followUpRequired: false,
    followUpNotes: null,
    customerPresent: false,
    customerSignatureUrl: null,
    inspectorSignatureUrl: null,
    reportUrl: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

/** Start inspection */
export function startInspection(
  inspection: Inspection,
  updatedBy: UserId
): Inspection {
  return {
    ...inspection,
    status: 'in_progress',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Add inspection item */
export function addInspectionItem(
  inspection: Inspection,
  item: InspectionItem,
  updatedBy: UserId
): Inspection {
  return {
    ...inspection,
    items: [...inspection.items, item],
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Complete inspection */
export function completeInspection(
  inspection: Inspection,
  data: {
    overallCondition: ConditionRating;
    summary: string;
    recommendations?: string;
    followUpRequired?: boolean;
    followUpNotes?: string;
    customerPresent?: boolean;
    customerSignatureUrl?: string;
    inspectorSignatureUrl?: string;
  },
  updatedBy: UserId
): Inspection {
  const now = new Date().toISOString();

  return {
    ...inspection,
    status: 'completed',
    completedAt: now,
    overallCondition: data.overallCondition,
    summary: data.summary,
    recommendations: data.recommendations ?? null,
    followUpRequired: data.followUpRequired ?? false,
    followUpNotes: data.followUpNotes ?? null,
    customerPresent: data.customerPresent ?? false,
    customerSignatureUrl: data.customerSignatureUrl ?? null,
    inspectorSignatureUrl: data.inspectorSignatureUrl ?? null,
    updatedAt: now,
    updatedBy,
  };
}

/** Calculate items requiring action */
export function getItemsRequiringAction(inspection: Inspection): InspectionItem[] {
  return inspection.items.filter((item) => item.requiresAction);
}

/** Calculate condition summary */
export function getConditionSummary(inspection: Inspection): Record<ConditionRating, number> {
  const summary: Record<ConditionRating, number> = {
    excellent: 0,
    good: 0,
    fair: 0,
    poor: 0,
    critical: 0,
  };

  for (const item of inspection.items) {
    summary[item.condition]++;
  }

  return summary;
}

/** Generate inspection number */
export function generateInspectionNumber(year: number, sequence: number): string {
  return `INS-${year}-${String(sequence).padStart(4, '0')}`;
}
