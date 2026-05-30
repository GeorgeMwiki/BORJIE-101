/**
 * Micro-learning tile primitives.
 *
 * Ported from LITFIN's micro-learning shape (which delivered 60-90s
 * borrower-literacy tiles). For Borjie the tile catalogue is the
 * mining-corpus: a single short lesson the brain can serve mid-flow
 * during chat (e.g. "What does a 7% royalty rate mean for your
 * shift?").
 *
 * A tile is a self-contained learning unit:
 *   - skillCode it advances
 *   - one of {video, photo-walkthrough, voice-note, sw-text-quiz,
 *     en-text-quiz, field-task}
 *   - estimated 60-180 second completion
 *   - one mandatory evidence check at the end
 *
 * Pure functions. Tiles are content-addressable so the same tile can
 * be referenced from many advisor lessons + persona prompts.
 */

export type TileMedium =
  | "video"
  | "photo-walkthrough"
  | "voice-note"
  | "sw-text-quiz"
  | "en-text-quiz"
  | "field-task";

export interface MicroLearningTile {
  readonly tileId: string;
  readonly skillCode: string;
  readonly title: { readonly sw: string; readonly en: string };
  readonly medium: TileMedium;
  readonly estimatedSeconds: number;
  readonly evidenceCheck: {
    readonly question: { readonly sw: string; readonly en: string };
    readonly answerKey: ReadonlyArray<string>;
  };
  readonly mineralCodes?: ReadonlyArray<string>;
  readonly jurisdictionCodes?: ReadonlyArray<string>;
}

export interface TileLibrary {
  readonly tiles: ReadonlyArray<MicroLearningTile>;
}

/**
 * Pick the next tile to serve a learner. Filters by skill match and
 * optional mineral / jurisdiction context, then prefers the shortest
 * tile that hasn't been served in the recent history.
 */
export function pickNextTile(args: {
  readonly library: TileLibrary;
  readonly skillCode: string;
  readonly mineralCode?: string;
  readonly jurisdictionCode?: string;
  readonly recentlyServedTileIds: ReadonlyArray<string>;
}): MicroLearningTile | null {
  const skillMatches = args.library.tiles.filter(
    (t) => t.skillCode === args.skillCode,
  );
  const contextMatches = skillMatches.filter((t) => {
    if (args.mineralCode && t.mineralCodes && t.mineralCodes.length > 0) {
      if (!t.mineralCodes.includes(args.mineralCode)) return false;
    }
    if (args.jurisdictionCode && t.jurisdictionCodes && t.jurisdictionCodes.length > 0) {
      if (!t.jurisdictionCodes.includes(args.jurisdictionCode)) return false;
    }
    return true;
  });
  const fresh = contextMatches.filter(
    (t) => !args.recentlyServedTileIds.includes(t.tileId),
  );
  const candidates = fresh.length > 0 ? fresh : contextMatches;
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort(
    (a, b) => a.estimatedSeconds - b.estimatedSeconds,
  );
  return sorted[0] ?? null;
}

/**
 * Grade a learner's response against the tile's evidence check. Case-
 * insensitive whitespace-trimmed match. Returns {passed, normalised}.
 */
export function gradeResponse(args: {
  readonly tile: MicroLearningTile;
  readonly response: string;
}): { readonly passed: boolean; readonly normalised: string } {
  const normalised = args.response.trim().toLowerCase();
  const passed = args.tile.evidenceCheck.answerKey.some(
    (k) => k.trim().toLowerCase() === normalised,
  );
  return { passed, normalised };
}
