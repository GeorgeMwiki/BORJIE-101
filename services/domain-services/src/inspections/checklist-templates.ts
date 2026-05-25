/**
 * Checklist Templates by Inspection Type
 * Each inspection type has a tailored checklist for its specific purpose.
 */

import type { InspectionType } from './types.js';
import {
  LIVING_ROOM_TEMPLATE,
  BEDROOM_TEMPLATE,
  BEDROOM_2_TEMPLATE,
  KITCHEN_TEMPLATE,
  BATHROOM_TEMPLATE,
  BATHROOM_2_TEMPLATE,
  EXTERIOR_TEMPLATE,
  type RoomTemplate,
} from './room-template.js';

// ============================================================================
// Checklist Template Definition
// ============================================================================

export interface InspectionChecklistTemplate {
  readonly type: InspectionType;
  readonly label: string;
  readonly description: string;
  readonly rooms: readonly RoomTemplate[];
  readonly additionalItems?: readonly string[];
}

// ============================================================================
// Move-In Checklist
// Document baseline condition for deposit protection
// ============================================================================

export const MOVE_IN_CHECKLIST_TEMPLATE: InspectionChecklistTemplate = {
  type: 'move_in',
  label: 'Move-In Inspection',
  description: 'Document property condition at tenant move-in for deposit baseline',
  rooms: [
    LIVING_ROOM_TEMPLATE,
    BEDROOM_TEMPLATE,
    BEDROOM_2_TEMPLATE,
    KITCHEN_TEMPLATE,
    BATHROOM_TEMPLATE,
    BATHROOM_2_TEMPLATE,
    EXTERIOR_TEMPLATE,
  ],
  additionalItems: [
    'Meter readings (water, electricity, gas)',
    'Keys received',
    'Gate/access card',
    'Parking permit',
  ],
};

// ============================================================================
// Move-Out Checklist
// Compare with move-in for deposit deductions
// ============================================================================

export const MOVE_OUT_CHECKLIST_TEMPLATE: InspectionChecklistTemplate = {
  type: 'move_out',
  label: 'Move-Out Inspection',
  description: 'Document property condition at tenant move-out for deposit reconciliation',
  rooms: [
    LIVING_ROOM_TEMPLATE,
    BEDROOM_TEMPLATE,
    BEDROOM_2_TEMPLATE,
    KITCHEN_TEMPLATE,
    BATHROOM_TEMPLATE,
    BATHROOM_2_TEMPLATE,
    EXTERIOR_TEMPLATE,
  ],
  additionalItems: [
    'Final meter readings',
    'Keys returned',
    'Gate/access card returned',
    'Cleaning verification',
    'Damage assessment',
  ],
};

// ============================================================================
// Periodic Checklist
// Routine inspection for ongoing maintenance and compliance
// ============================================================================

export const PERIODIC_CHECKLIST_TEMPLATE: InspectionChecklistTemplate = {
  type: 'periodic',
  label: 'Periodic Inspection',
  description: 'Routine property check for maintenance and tenant compliance',
  rooms: [
    LIVING_ROOM_TEMPLATE,
    BEDROOM_TEMPLATE,
    BEDROOM_2_TEMPLATE,
    KITCHEN_TEMPLATE,
    BATHROOM_TEMPLATE,
    BATHROOM_2_TEMPLATE,
    EXTERIOR_TEMPLATE,
  ],
  additionalItems: [
    'Smoke detector status',
    'Fire extinguisher',
    'Leak indicators',
    'Pest signs',
    'Tenant-reported issues',
  ],
};

// ============================================================================
// Maintenance Checklist
// Focus on repair and maintenance items
// ============================================================================

export const MAINTENANCE_CHECKLIST_TEMPLATE: InspectionChecklistTemplate = {
  type: 'maintenance',
  label: 'Maintenance Inspection',
  description: 'Assessment for repairs and maintenance work',
  rooms: [
    LIVING_ROOM_TEMPLATE,
    BEDROOM_TEMPLATE,
    BEDROOM_2_TEMPLATE,
    KITCHEN_TEMPLATE,
    BATHROOM_TEMPLATE,
    BATHROOM_2_TEMPLATE,
    EXTERIOR_TEMPLATE,
  ],
  additionalItems: [
    'Plumbing issues',
    'Electrical issues',
    'HVAC condition',
    'Appliance status',
    'Structural concerns',
  ],
};

// ============================================================================
// Pre-Listing Checklist
// Property readiness for marketing and showing
// ============================================================================

export const PRE_LISTING_CHECKLIST_TEMPLATE: InspectionChecklistTemplate = {
  type: 'pre_listing',
  label: 'Pre-Listing Inspection',
  description: 'Property readiness assessment for marketing and tenant showing',
  rooms: [
    LIVING_ROOM_TEMPLATE,
    BEDROOM_TEMPLATE,
    BEDROOM_2_TEMPLATE,
    KITCHEN_TEMPLATE,
    BATHROOM_TEMPLATE,
    BATHROOM_2_TEMPLATE,
    EXTERIOR_TEMPLATE,
  ],
  additionalItems: [
    'Curb appeal',
    'Photography readiness',
    'Cosmetic touch-ups',
    'Signage/address visibility',
  ],
};

// ============================================================================
// Template Registry
// ============================================================================

export const INSPECTION_CHECKLIST_TEMPLATES: Record<
  InspectionType,
  InspectionChecklistTemplate
> = {
  move_in: MOVE_IN_CHECKLIST_TEMPLATE,
  move_out: MOVE_OUT_CHECKLIST_TEMPLATE,
  periodic: PERIODIC_CHECKLIST_TEMPLATE,
  maintenance: MAINTENANCE_CHECKLIST_TEMPLATE,
  pre_listing: PRE_LISTING_CHECKLIST_TEMPLATE,
};

/** Get checklist template for an inspection type */
export function getChecklistTemplate(
  type: InspectionType
): InspectionChecklistTemplate {
  return INSPECTION_CHECKLIST_TEMPLATES[type];
}
