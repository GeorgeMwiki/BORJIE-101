/**
 * compareMoveInMoveOutPhotos — pure photo manifest comparator (NEW 19).
 *
 * Wave-4 D1: pure-function tests; no IO or AI mocking required.
 */

import { describe, it, expect } from 'vitest';
import { compareMoveInMoveOutPhotos } from '../photo-comparator.js';
import type { InspectionItem } from '../../types.js';
import { asInspectionItemId, asRoomId } from '../../types.js';
import { asUserId } from '@borjie/domain-models';

const userId = asUserId('usr_inspector');

function makeItem(
  roomName: string,
  itemName: string,
  photos: readonly string[],
  id = `${roomName}-${itemName}-${photos.length}`,
): InspectionItem {
  return {
    id: asInspectionItemId(id),
    room: roomName,
    item: itemName,
    condition: 'good',
    notes: null,
    photos,
    roomId: asRoomId(`room_${roomName}`),
    roomName,
    itemName,
    addedAt: '2026-05-08T00:00:00Z' as never,
    addedBy: userId,
  };
}

describe('compareMoveInMoveOutPhotos', () => {
  it('returns empty manifest for empty inputs', () => {
    const m = compareMoveInMoveOutPhotos([], []);
    expect(m.pairs).toEqual([]);
    expect(m.missingMoveInPhotos).toBe(false);
    expect(m.missingMoveOutPhotos).toBe(false);
  });

  it('pairs photos by roomName + itemName', () => {
    const moveIn = [makeItem('Kitchen', 'Sink', ['mi1.jpg'])];
    const moveOut = [makeItem('Kitchen', 'Sink', ['mo1.jpg'])];
    const m = compareMoveInMoveOutPhotos(moveIn, moveOut);
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0].roomName).toBe('Kitchen');
    expect(m.pairs[0].itemName).toBe('Sink');
    expect(m.pairs[0].moveInPhotos).toEqual(['mi1.jpg']);
    expect(m.pairs[0].moveOutPhotos).toEqual(['mo1.jpg']);
  });

  it('flags missingMoveOutPhotos when move-in has photos but move-out empty', () => {
    const moveIn = [makeItem('Bathroom', 'Toilet', ['mi.jpg'])];
    const m = compareMoveInMoveOutPhotos(moveIn, []);
    expect(m.missingMoveOutPhotos).toBe(true);
    expect(m.missingMoveInPhotos).toBe(false);
    expect(m.pairs[0].moveOutPhotos).toEqual([]);
  });

  it('flags missingMoveInPhotos when move-out has photos but move-in empty', () => {
    const moveOut = [makeItem('Bathroom', 'Toilet', ['mo.jpg'])];
    const m = compareMoveInMoveOutPhotos([], moveOut);
    expect(m.missingMoveInPhotos).toBe(true);
    expect(m.missingMoveOutPhotos).toBe(false);
  });

  it('does not flag when neither side has photos', () => {
    const moveIn = [makeItem('Kitchen', 'Sink', [])];
    const moveOut = [makeItem('Kitchen', 'Sink', [])];
    const m = compareMoveInMoveOutPhotos(moveIn, moveOut);
    expect(m.missingMoveOutPhotos).toBe(false);
    expect(m.missingMoveInPhotos).toBe(false);
  });

  it('similarity and aiNarrative remain null until AI wired', () => {
    const moveIn = [makeItem('Kitchen', 'Sink', ['mi.jpg'])];
    const moveOut = [makeItem('Kitchen', 'Sink', ['mo.jpg'])];
    const m = compareMoveInMoveOutPhotos(moveIn, moveOut);
    expect(m.pairs[0].similarity).toBeNull();
    expect(m.pairs[0].aiNarrative).toBeNull();
  });

  it('handles multiple distinct (room, item) pairs', () => {
    const moveIn = [
      makeItem('Kitchen', 'Sink', ['k1.jpg']),
      makeItem('Bedroom', 'Bed', ['b1.jpg']),
    ];
    const moveOut = [
      makeItem('Kitchen', 'Sink', ['k2.jpg']),
      makeItem('Bedroom', 'Bed', ['b2.jpg']),
    ];
    const m = compareMoveInMoveOutPhotos(moveIn, moveOut);
    expect(m.pairs).toHaveLength(2);
  });

  it('treats same item in different rooms as separate pairs', () => {
    const moveIn = [
      makeItem('Bathroom 1', 'Sink', ['a.jpg']),
      makeItem('Bathroom 2', 'Sink', ['b.jpg']),
    ];
    const m = compareMoveInMoveOutPhotos(moveIn, []);
    expect(m.pairs).toHaveLength(2);
  });

  it('emits ISO timestamp in generatedAt', () => {
    const m = compareMoveInMoveOutPhotos([], []);
    expect(() => new Date(m.generatedAt).toISOString()).not.toThrow();
  });

  it('does not duplicate pairs when both sides have same key', () => {
    const moveIn = [makeItem('Kitchen', 'Sink', ['a.jpg'])];
    const moveOut = [makeItem('Kitchen', 'Sink', ['b.jpg', 'c.jpg'])];
    const m = compareMoveInMoveOutPhotos(moveIn, moveOut);
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0].moveInPhotos).toHaveLength(1);
    expect(m.pairs[0].moveOutPhotos).toHaveLength(2);
  });
});
