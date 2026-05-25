/**
 * Room-based Inspection Template
 * Standard rooms and items to check for property inspections
 */

import type { RoomId } from './types.js';
import { asRoomId } from './types.js';

// ============================================================================
// Room Template Definition
// ============================================================================

export interface RoomTemplateItem {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
}

export interface RoomTemplate {
  readonly id: RoomId;
  readonly name: string;
  readonly order: number;
  readonly items: readonly RoomTemplateItem[];
}

// ============================================================================
// Standard Room Templates
// ============================================================================

export const LIVING_ROOM_TEMPLATE: RoomTemplate = {
  id: asRoomId('room_living'),
  name: 'Living Room',
  order: 1,
  items: [
    { id: 'walls', name: 'Walls', description: 'Paint condition, stains, holes' },
    { id: 'floors', name: 'Flooring', description: 'Carpet, tiles, wood condition' },
    { id: 'ceiling', name: 'Ceiling', description: 'Water stains, cracks' },
    { id: 'windows', name: 'Windows', description: 'Glass, frames, locks' },
    { id: 'doors', name: 'Doors', description: 'Paint, hinges, locks' },
    { id: 'electrical', name: 'Electrical outlets', description: 'Working, cover plates' },
    { id: 'light_fixtures', name: 'Light fixtures', description: 'Working, switches' },
  ],
};

export const BEDROOM_TEMPLATE: RoomTemplate = {
  id: asRoomId('room_bedroom'),
  name: 'Bedroom',
  order: 2,
  items: [
    { id: 'walls', name: 'Walls', description: 'Paint condition, stains, holes' },
    { id: 'floors', name: 'Flooring', description: 'Carpet, tiles, wood condition' },
    { id: 'ceiling', name: 'Ceiling', description: 'Water stains, cracks' },
    { id: 'closet', name: 'Closet', description: 'Shelves, doors, condition' },
    { id: 'windows', name: 'Windows', description: 'Glass, frames, locks' },
    { id: 'doors', name: 'Doors', description: 'Paint, hinges, locks' },
    { id: 'electrical', name: 'Electrical outlets', description: 'Working, cover plates' },
    { id: 'light_fixtures', name: 'Light fixtures', description: 'Working, switches' },
  ],
};

export const KITCHEN_TEMPLATE: RoomTemplate = {
  id: asRoomId('room_kitchen'),
  name: 'Kitchen',
  order: 3,
  items: [
    { id: 'cabinets', name: 'Cabinets', description: 'Condition, hinges, handles' },
    { id: 'countertops', name: 'Countertops', description: 'Cracks, stains, scratches' },
    { id: 'sink', name: 'Sink', description: 'Leaks, drainage, faucet' },
    { id: 'stove', name: 'Stove', description: 'Burners, oven, knobs' },
    { id: 'refrigerator', name: 'Refrigerator', description: 'Working, seals, shelves' },
    { id: 'waste_disposal', name: 'Waste disposal', description: 'If applicable' },
    { id: 'exhaust_fan', name: 'Exhaust fan', description: 'Working, clean' },
    { id: 'flooring', name: 'Flooring', description: 'Tiles, condition' },
    { id: 'walls', name: 'Walls', description: 'Paint, tiles, backsplash' },
  ],
};

export const BEDROOM_2_TEMPLATE: RoomTemplate = {
  id: asRoomId('room_bedroom_2'),
  name: 'Bedroom 2',
  order: 2.5,
  items: [
    { id: 'walls', name: 'Walls', description: 'Paint condition, stains, holes' },
    { id: 'floors', name: 'Flooring', description: 'Carpet, tiles, wood condition' },
    { id: 'ceiling', name: 'Ceiling', description: 'Water stains, cracks' },
    { id: 'closet', name: 'Closet', description: 'Shelves, doors, condition' },
    { id: 'windows', name: 'Windows', description: 'Glass, frames, locks' },
    { id: 'doors', name: 'Doors', description: 'Paint, hinges, locks' },
    { id: 'electrical', name: 'Electrical outlets', description: 'Working, cover plates' },
    { id: 'light_fixtures', name: 'Light fixtures', description: 'Working, switches' },
  ],
};

export const BATHROOM_TEMPLATE: RoomTemplate = {
  id: asRoomId('room_bathroom'),
  name: 'Bathroom',
  order: 4,
  items: [
    { id: 'toilet', name: 'Toilet', description: 'Flush, leaks, seat' },
    { id: 'sink', name: 'Sink', description: 'Faucet, drainage, condition' },
    { id: 'shower_tub', name: 'Shower/Tub', description: 'Caulk, tiles, fixtures' },
    { id: 'tiles', name: 'Tiles', description: 'Grout, cracks, water damage' },
    { id: 'exhaust_fan', name: 'Exhaust fan', description: 'Working, clean' },
    { id: 'mirror', name: 'Mirror', description: 'Condition, mounting' },
    { id: 'towel_racks', name: 'Towel racks', description: 'Stable, condition' },
    { id: 'fixtures', name: 'Fixtures', description: 'Faucets, shower head' },
  ],
};

export const BATHROOM_2_TEMPLATE: RoomTemplate = {
  id: asRoomId('room_bathroom_2'),
  name: 'Bathroom 2',
  order: 4.5,
  items: [
    { id: 'toilet', name: 'Toilet', description: 'Flush, leaks, seat' },
    { id: 'sink', name: 'Sink', description: 'Faucet, drainage, condition' },
    { id: 'shower_tub', name: 'Shower/Tub', description: 'Caulk, tiles, fixtures' },
    { id: 'tiles', name: 'Tiles', description: 'Grout, cracks, water damage' },
    { id: 'exhaust_fan', name: 'Exhaust fan', description: 'Working, clean' },
    { id: 'mirror', name: 'Mirror', description: 'Condition, mounting' },
    { id: 'towel_racks', name: 'Towel racks', description: 'Stable, condition' },
    { id: 'fixtures', name: 'Fixtures', description: 'Faucets, shower head' },
  ],
};

export const EXTERIOR_TEMPLATE: RoomTemplate = {
  id: asRoomId('room_exterior'),
  name: 'Exterior',
  order: 5,
  items: [
    { id: 'front_door', name: 'Front door', description: 'Paint, hinges, locks' },
    { id: 'back_door', name: 'Back door', description: 'Paint, hinges, locks' },
    { id: 'windows', name: 'Windows', description: 'Glass, frames, screens' },
    { id: 'balcony_patio', name: 'Balcony/Patio', description: 'Surface, railings' },
    { id: 'parking_area', name: 'Parking area', description: 'Surface, markings' },
    { id: 'security_features', name: 'Security features', description: 'Locks, intercom' },
  ],
};

// ============================================================================
// Full Template (all rooms)
// ============================================================================

export const INSPECTION_ROOM_TEMPLATES: readonly RoomTemplate[] = [
  LIVING_ROOM_TEMPLATE,
  BEDROOM_TEMPLATE,
  BEDROOM_2_TEMPLATE,
  KITCHEN_TEMPLATE,
  BATHROOM_TEMPLATE,
  BATHROOM_2_TEMPLATE,
  EXTERIOR_TEMPLATE,
] as const;

/** Get template by room name */
export function getRoomTemplateByName(name: string): RoomTemplate | undefined {
  return INSPECTION_ROOM_TEMPLATES.find(
    (t) => t.name.toLowerCase() === name.toLowerCase()
  );
}

/** Get template by room ID */
export function getRoomTemplateById(roomId: RoomId): RoomTemplate | undefined {
  return INSPECTION_ROOM_TEMPLATES.find((t) => t.id === roomId);
}

/** Get all standard item names for a room */
export function getStandardItemsForRoom(roomName: string): readonly string[] {
  const template = getRoomTemplateByName(roomName);
  return template?.items.map((i) => i.name) ?? [];
}
