/**
 * Choreography Engine (LP-24b).
 *
 * Runs a `BlackboardChoreography` over time as a PURE state machine:
 *   - schedules reveals (which targetIds have unveiled by each tick),
 *   - reports voice markers as they fire (so a TTS layer speaks in sync),
 *   - applies interaction responses when the renderer signals an event.
 *
 * Framework-agnostic: no timers, no DOM. A caller drives it by passing
 * the next elapsed-ms on each animation frame; a React hook adapts this
 * to component state.
 *
 * Reference: LITFIN src/core/smartboard/choreography-engine.ts.
 *
 * @module genui/streaming/choreography-engine
 */

import {
  sortRevealsByTime,
  totalChoreographyMs,
  type BlackboardChoreography,
  type RevealCue,
  type StoryShape,
  type VoiceMarker,
} from "./choreography";

export interface ChoreographyState {
  /** Elapsed time in milliseconds. */
  readonly elapsedMs: number;
  /** Ids already revealed. */
  readonly revealed: ReadonlySet<string>;
  /** Voice-marker indexes already fired. */
  readonly spokenIndexes: ReadonlySet<number>;
  /** Shapes currently visible (interaction responses can extend this). */
  readonly shapes: ReadonlyArray<StoryShape>;
  /** Whether the engine has reached end-of-choreography. */
  readonly finished: boolean;
}

export interface ChoreographyTickEvent {
  readonly newlyRevealed: ReadonlyArray<RevealCue>;
  readonly newlySpoken: ReadonlyArray<VoiceMarker>;
}

const EMPTY_EVENTS: ChoreographyTickEvent = {
  newlyRevealed: [],
  newlySpoken: [],
};

/** Initial state for a choreography (shapes pre-seeded, clock at 0). */
export function initChoreographyState(
  choreo: BlackboardChoreography,
): ChoreographyState {
  return {
    elapsedMs: 0,
    revealed: new Set<string>(),
    spokenIndexes: new Set<number>(),
    shapes: choreo.shapes ?? [],
    finished: false,
  };
}

/**
 * Pure tick: given the next elapsed time, return the new state + the
 * side-effect events (reveals / voice) that fired since the previous
 * state. Returns the SAME state reference when nothing changed so a
 * React consumer can bail on identity.
 */
export function tickChoreography(
  prev: ChoreographyState,
  choreo: BlackboardChoreography,
  nextElapsedMs: number,
): { readonly state: ChoreographyState; readonly events: ChoreographyTickEvent } {
  const total = totalChoreographyMs(choreo);
  const cappedElapsed = Math.min(nextElapsedMs, total);
  const finished = cappedElapsed >= total;

  const reveals = choreo.reveals ?? [];
  const voice = choreo.voice ?? [];

  let newlyRevealed: RevealCue[] | null = null;
  for (const cue of reveals) {
    if (cue.atMs > cappedElapsed) continue;
    if (prev.revealed.has(cue.targetId)) continue;
    (newlyRevealed ??= []).push(cue);
  }

  let newlySpoken: VoiceMarker[] | null = null;
  for (let i = 0; i < voice.length; i += 1) {
    const marker = voice[i];
    if (marker === undefined) continue;
    if (marker.atMs > cappedElapsed) continue;
    if (prev.spokenIndexes.has(i)) continue;
    (newlySpoken ??= []).push(marker);
  }

  if (
    !newlyRevealed &&
    !newlySpoken &&
    prev.elapsedMs === cappedElapsed &&
    prev.finished === finished
  ) {
    return { state: prev, events: EMPTY_EVENTS };
  }

  const revealedSet = newlyRevealed
    ? (() => {
        const s = new Set(prev.revealed);
        for (const cue of sortRevealsByTime(newlyRevealed)) {
          s.add(cue.targetId);
        }
        return s;
      })()
    : prev.revealed;

  const spokenSet = newlySpoken
    ? (() => {
        const s = new Set(prev.spokenIndexes);
        for (let i = 0; i < voice.length; i += 1) {
          const m = voice[i];
          if (m !== undefined && m.atMs <= cappedElapsed) s.add(i);
        }
        return s;
      })()
    : prev.spokenIndexes;

  return {
    state: {
      elapsedMs: cappedElapsed,
      revealed: revealedSet,
      spokenIndexes: spokenSet,
      shapes: prev.shapes.length > 0 ? prev.shapes : choreo.shapes ?? [],
      finished,
    },
    events: {
      newlyRevealed: newlyRevealed ?? EMPTY_EVENTS.newlyRevealed,
      newlySpoken: newlySpoken ?? EMPTY_EVENTS.newlySpoken,
    },
  };
}

/**
 * Apply a renderer interaction event — returns updated state plus any
 * voice marker the response speaks. No-op (same reference) when no
 * response matches the event name.
 */
export function applyInteraction(
  prev: ChoreographyState,
  choreo: BlackboardChoreography,
  eventName: string,
): { readonly state: ChoreographyState; readonly spoke?: VoiceMarker } {
  const response = (choreo.responses ?? []).find(
    (r) => r.onEvent === eventName,
  );
  if (!response) return { state: prev };

  const revealedSet = new Set(prev.revealed);
  for (const cue of response.reveal ?? []) {
    revealedSet.add(cue.targetId);
  }

  const nextShapes: ReadonlyArray<StoryShape> = response.setShapes
    ? [...prev.shapes, ...response.setShapes]
    : prev.shapes;

  return {
    state: {
      ...prev,
      revealed: revealedSet,
      shapes: nextShapes,
    },
    ...(response.say !== undefined ? { spoke: response.say } : {}),
  };
}
