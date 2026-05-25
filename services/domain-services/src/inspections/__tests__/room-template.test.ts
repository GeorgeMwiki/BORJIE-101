/**
 * Room template registry — pure data + lookup helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  LIVING_ROOM_TEMPLATE,
  BEDROOM_TEMPLATE,
  BEDROOM_2_TEMPLATE,
  KITCHEN_TEMPLATE,
  BATHROOM_TEMPLATE,
  BATHROOM_2_TEMPLATE,
  EXTERIOR_TEMPLATE,
  INSPECTION_ROOM_TEMPLATES,
  getRoomTemplateByName,
  getRoomTemplateById,
  getStandardItemsForRoom,
} from '../room-template.js';

describe('Room templates', () => {
  it('exposes the seven standard rooms in INSPECTION_ROOM_TEMPLATES', () => {
    expect(INSPECTION_ROOM_TEMPLATES).toHaveLength(7);
    expect(INSPECTION_ROOM_TEMPLATES).toContain(LIVING_ROOM_TEMPLATE);
    expect(INSPECTION_ROOM_TEMPLATES).toContain(BEDROOM_TEMPLATE);
    expect(INSPECTION_ROOM_TEMPLATES).toContain(BEDROOM_2_TEMPLATE);
    expect(INSPECTION_ROOM_TEMPLATES).toContain(KITCHEN_TEMPLATE);
    expect(INSPECTION_ROOM_TEMPLATES).toContain(BATHROOM_TEMPLATE);
    expect(INSPECTION_ROOM_TEMPLATES).toContain(BATHROOM_2_TEMPLATE);
    expect(INSPECTION_ROOM_TEMPLATES).toContain(EXTERIOR_TEMPLATE);
  });

  it('every standard room has at least one item', () => {
    for (const room of INSPECTION_ROOM_TEMPLATES) {
      expect(room.items.length).toBeGreaterThan(0);
    }
  });

  it('every item carries a stable id and name', () => {
    for (const room of INSPECTION_ROOM_TEMPLATES) {
      for (const item of room.items) {
        expect(item.id).toBeTruthy();
        expect(item.name).toBeTruthy();
      }
    }
  });

  it('rooms have distinct ids', () => {
    const ids = INSPECTION_ROOM_TEMPLATES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('order field is unique per room (handles 2.5 / 4.5 fractional)', () => {
    const orders = INSPECTION_ROOM_TEMPLATES.map((r) => r.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('getRoomTemplateByName', () => {
  it('finds Living Room by exact name', () => {
    const t = getRoomTemplateByName('Living Room');
    expect(t).toBe(LIVING_ROOM_TEMPLATE);
  });

  it('matches case-insensitively', () => {
    expect(getRoomTemplateByName('kitchen')).toBe(KITCHEN_TEMPLATE);
    expect(getRoomTemplateByName('BATHROOM')).toBe(BATHROOM_TEMPLATE);
  });

  it('returns undefined for unknown names', () => {
    expect(getRoomTemplateByName('Office')).toBeUndefined();
    expect(getRoomTemplateByName('')).toBeUndefined();
  });
});

describe('getRoomTemplateById', () => {
  it('finds a room by branded RoomId', () => {
    const t = getRoomTemplateById(LIVING_ROOM_TEMPLATE.id);
    expect(t).toBe(LIVING_ROOM_TEMPLATE);
  });

  it('returns undefined for unknown id', () => {
    const fakeId = 'room_unknown' as unknown as typeof LIVING_ROOM_TEMPLATE.id;
    expect(getRoomTemplateById(fakeId)).toBeUndefined();
  });
});

describe('getStandardItemsForRoom', () => {
  it('returns item names for a known room', () => {
    const items = getStandardItemsForRoom('Kitchen');
    expect(items).toContain('Sink');
    expect(items).toContain('Stove');
    expect(items.length).toBe(KITCHEN_TEMPLATE.items.length);
  });

  it('returns empty array for unknown room', () => {
    expect(getStandardItemsForRoom('NotARoom')).toEqual([]);
  });

  it('case-insensitive lookup', () => {
    expect(getStandardItemsForRoom('bedroom')).toEqual(
      BEDROOM_TEMPLATE.items.map((i) => i.name),
    );
  });
});
