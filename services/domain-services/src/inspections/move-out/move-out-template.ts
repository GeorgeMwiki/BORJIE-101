/**
 * MOVE_OUT_TEMPLATE (NEW 19)
 *
 * End-of-tenancy inspection checklist. Mirrors the shape used by
 * existing room/checklist templates and adds move-out-specific sections.
 */

import {
  LIVING_ROOM_TEMPLATE,
  BEDROOM_TEMPLATE,
  BEDROOM_2_TEMPLATE,
  KITCHEN_TEMPLATE,
  BATHROOM_TEMPLATE,
  BATHROOM_2_TEMPLATE,
  EXTERIOR_TEMPLATE,
  type RoomTemplate,
} from '../room-template.js';

export interface MoveOutChecklistSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly string[];
  readonly requiredPhotos?: boolean;
}

export interface MoveOutTemplate {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly rooms: readonly RoomTemplate[];
  readonly closingSections: readonly MoveOutChecklistSection[];
  readonly requiresDualSignature: boolean;
  readonly supportsSelfCheckout: boolean;
}

export const MOVE_OUT_TEMPLATE: MoveOutTemplate = {
  id: 'move_out_v1',
  label: 'End-of-Tenancy (Move-Out) Inspection',
  description:
    'Structured move-out walkthrough with optional self-checkout and dual sign-off.',
  rooms: [
    LIVING_ROOM_TEMPLATE,
    BEDROOM_TEMPLATE,
    BEDROOM_2_TEMPLATE,
    KITCHEN_TEMPLATE,
    BATHROOM_TEMPLATE,
    BATHROOM_2_TEMPLATE,
    EXTERIOR_TEMPLATE,
  ],
  closingSections: [
    {
      id: 'meters',
      title: 'Final Meter Readings',
      items: ['Water meter', 'Electricity meter', 'Gas meter'],
      requiredPhotos: true,
    },
    {
      id: 'keys',
      title: 'Keys & Access',
      items: [
        'Front-door keys',
        'Mailbox key',
        'Parking / gate fob',
        'Access card',
      ],
    },
    {
      id: 'cleaning',
      title: 'Cleaning Verification',
      items: [
        'Kitchen cleaned',
        'Bathrooms cleaned',
        'Floors cleaned',
        'Trash removed',
      ],
      requiredPhotos: true,
    },
    {
      id: 'damage',
      title: 'Damage Assessment',
      items: [
        'Walls / paintwork',
        'Flooring',
        'Appliances',
        'Fixtures & fittings',
      ],
      requiredPhotos: true,
    },
    {
      id: 'forwarding',
      title: 'Forwarding & Reconciliation',
      items: [
        'Forwarding address captured',
        'Deposit reconciliation discussed',
        'Outstanding balance review',
      ],
    },
  ],
  requiresDualSignature: true,
  supportsSelfCheckout: true,
};
