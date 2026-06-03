/**
 * Choreography domain types + pure helpers (LP-24b).
 *
 * A `BlackboardChoreography` describes how a streamed artifact unveils
 * over time: which target ids reveal at which millisecond, which voice
 * markers fire (so a TTS layer can speak in sync), and how interaction
 * events reveal more. The engine (`choreography-engine.ts`) runs this as
 * a pure state machine; a React hook adapts it to component state.
 *
 * Reference: LITFIN src/core/smartboard/choreography.ts (types).
 *
 * @module genui/streaming/choreography
 */

/** A timed reveal of one target id. */
export interface RevealCue {
  /** Id of the element/shape to reveal. */
  readonly targetId: string;
  /** Reveal time in ms from choreography start. */
  readonly atMs: number;
}

/** A timed voice marker the TTS layer speaks. */
export interface VoiceMarker {
  /** Fire time in ms from choreography start. */
  readonly atMs: number;
  /** Text to speak (single-language per the active locale). */
  readonly text: string;
}

/** A visual shape on the board. Opaque payload; the renderer interprets it. */
export interface StoryShape {
  readonly id: string;
  readonly kind: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

/** Response to a renderer interaction event. */
export interface InteractionResponse {
  /** Renderer event name that triggers this response. */
  readonly onEvent: string;
  /** Additional reveals to apply. */
  readonly reveal?: ReadonlyArray<RevealCue>;
  /** Shapes to append to the visible set. */
  readonly setShapes?: ReadonlyArray<StoryShape>;
  /** Optional voice marker spoken on this interaction. */
  readonly say?: VoiceMarker;
}

export interface BlackboardChoreography {
  readonly reveals?: ReadonlyArray<RevealCue>;
  readonly voice?: ReadonlyArray<VoiceMarker>;
  readonly shapes?: ReadonlyArray<StoryShape>;
  readonly responses?: ReadonlyArray<InteractionResponse>;
  /**
   * Optional explicit total duration in ms. When omitted, the total is
   * derived from the latest reveal / voice marker time.
   */
  readonly durationMs?: number;
}

/** Pure: reveals sorted ascending by time (stable, non-mutating). */
export function sortRevealsByTime(
  reveals: ReadonlyArray<RevealCue>,
): ReadonlyArray<RevealCue> {
  return [...reveals].sort((a, b) => a.atMs - b.atMs);
}

/** Pure: total choreography duration in ms. */
export function totalChoreographyMs(choreo: BlackboardChoreography): number {
  if (typeof choreo.durationMs === "number" && choreo.durationMs >= 0) {
    return choreo.durationMs;
  }
  let max = 0;
  for (const r of choreo.reveals ?? []) {
    if (r.atMs > max) max = r.atMs;
  }
  for (const v of choreo.voice ?? []) {
    if (v.atMs > max) max = v.atMs;
  }
  return max;
}
