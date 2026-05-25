/**
 * Move-in ↔ Move-out photo comparator (NEW 19)
 *
 * Stub implementation: groups photos by (room, item) keys and emits a
 * side-by-side comparison manifest. The actual visual diff is a follow-up
 * for the AI persona.
 */

import type { InspectionItem } from '../types.js';

export interface PhotoPair {
  readonly roomName: string;
  readonly itemName: string;
  readonly moveInPhotos: readonly string[];
  readonly moveOutPhotos: readonly string[];
  /**
   * Placeholder similarity score (0..1). Currently always `null` until an
   * AI vision model is wired in.
   */
  readonly similarity: number | null;
  /**
   * AI-provided narrative comparing the two photo sets. Null until wired.
   */
  readonly aiNarrative: string | null;
}

export interface PhotoComparisonManifest {
  readonly pairs: readonly PhotoPair[];
  readonly generatedAt: string;
  /** True if any (room,item) has move-in photos but no move-out photos. */
  readonly missingMoveOutPhotos: boolean;
  /** True if any (room,item) has move-out photos but no move-in photos. */
  readonly missingMoveInPhotos: boolean;
}

/**
 * Build a comparison manifest from two item lists.
 *
 * Follow-up KI-007 (Docs/TODO_BACKLOG.md): wire to AI persona — feed each `PhotoPair`'s URL set
 *   through a vision model to compute `similarity` and `aiNarrative`.
 *   See Docs/KNOWN_ISSUES.md#ki-007.
 */
export function compareMoveInMoveOutPhotos(
  moveInItems: readonly InspectionItem[],
  moveOutItems: readonly InspectionItem[]
): PhotoComparisonManifest {
  const byKey = new Map<
    string,
    { moveIn: readonly string[]; moveOut: readonly string[]; room: string; item: string }
  >();

  for (const i of moveInItems) {
    const key = `${i.roomName}|${i.itemName}`;
    byKey.set(key, {
      moveIn: i.photos,
      moveOut: byKey.get(key)?.moveOut ?? [],
      room: i.roomName,
      item: i.itemName,
    });
  }
  for (const i of moveOutItems) {
    const key = `${i.roomName}|${i.itemName}`;
    const prev = byKey.get(key);
    byKey.set(key, {
      moveIn: prev?.moveIn ?? [],
      moveOut: i.photos,
      room: i.roomName,
      item: i.itemName,
    });
  }

  const pairs: PhotoPair[] = Array.from(byKey.values()).map((entry) => ({
    roomName: entry.room,
    itemName: entry.item,
    moveInPhotos: entry.moveIn,
    moveOutPhotos: entry.moveOut,
    similarity: null,
    aiNarrative: null,
  }));

  const missingMoveOutPhotos = pairs.some(
    (p) => p.moveInPhotos.length > 0 && p.moveOutPhotos.length === 0
  );
  const missingMoveInPhotos = pairs.some(
    (p) => p.moveOutPhotos.length > 0 && p.moveInPhotos.length === 0
  );

  return {
    pairs,
    generatedAt: new Date().toISOString(),
    missingMoveOutPhotos,
    missingMoveInPhotos,
  };
}
