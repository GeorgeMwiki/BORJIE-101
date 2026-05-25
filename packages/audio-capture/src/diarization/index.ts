/**
 * Diarization port + adapters.
 *
 * Speaker IDs are *anonymized* — we emit `spk_0`, `spk_1`, … rather than
 * real-world identifiers so the layer stays GDPR-safe. The mapping from
 * anon ID → tenant identity is done by the consumer in domain-services.
 */

import type { AudioChunk, SpeakerSegment } from '../types.js';

export interface DiarizationPort {
  readonly provider: string;
  diarize(input: {
    readonly audio: AudioChunk;
    readonly expectedSpeakers?: number;
  }): Promise<ReadonlyArray<SpeakerSegment>>;
}

export { createPyannoteAdapter } from './pyannote.js';
export { createMockDiarization } from './mock.js';
