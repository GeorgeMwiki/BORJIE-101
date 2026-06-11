/**
 * Modality-arbiter PORTS — exposed for later wiring, NOT wired here.
 *
 * A future modality arbiter (keystone COG-07 / AUT-14) decides when the
 * brain should emit media as an output modality. This module defines the
 * stable contract the arbiter will compose against, plus a pure
 * `decideMediaModality` helper — so the media lane slots in cleanly
 * without this package reaching into central-intelligence.
 *
 * Nothing here imports the brain; this is a one-way port the host wires.
 *
 * @module @borjie/media-engine/arbiter/modality-port
 */

import type { MediaArtifact, MediaRequest } from '../types.js';
import type { MediaModality } from '../types.js';
import { profileForKind } from '../kinds.js';

/**
 * A decision the arbiter can take for the media lane. Mirrors the shape
 * the central-intelligence `Decision` ADT will gain a 7th variant for —
 * defined here so the engine owns its own contract.
 */
export interface GenerateMediaDecision {
  readonly kind: 'generate_media';
  readonly mediaKind: string;
  readonly prompt: string;
  readonly inputs: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly targetAudience: string;
}

/** Acknowledgement the dispatcher returns once a media job is queued. */
export interface MediaQueuedAck {
  readonly kind: 'media_queued';
  readonly jobId: string;
}

/**
 * The port the arbiter calls to actuate a media decision. A host
 * implements this over `createMediaEngine` + an async job store; the
 * arbiter only sees this interface.
 */
export interface MediaModalityPort {
  /** Queue a media generation; returns a job ack. */
  queue(request: MediaRequest): Promise<MediaQueuedAck>;
  /** Fetch a finished artifact for delivery, or null if not ready. */
  result(jobId: string): Promise<MediaArtifact | null>;
}

/**
 * Pure arbiter helper: does this intent call for the media modality?
 * The real arbiter composes richer signals; this gives a deterministic,
 * testable default keyed on whether the requested kind is a known media
 * kind and which modality it maps to.
 */
export function decideMediaModality(
  mediaKind: string,
): { useMedia: boolean; modality: MediaModality | null } {
  const profile = profileForKind(mediaKind);
  if (!profile) return { useMedia: false, modality: null };
  return { useMedia: true, modality: profile.modality };
}
