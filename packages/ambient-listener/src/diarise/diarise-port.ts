/**
 * Diarisation port — given a voice span, returns the per-speaker
 * intervals. Order is wall-clock ascending.
 *
 * Concrete impls injected at the host boundary:
 *   - pyannote.audio 3.4 (primary)        https://huggingface.co/pyannote/speaker-diarization-3.1
 *   - Nvidia NeMo Sortformer (peer)       https://docs.nvidia.com/nemo-framework/user-guide/latest/nemotoolkit/asr/speaker_diarization/sortformer.html
 *   - AWS Transcribe Diarization (managed) https://docs.aws.amazon.com/transcribe/latest/dg/diarization.html
 *   - AssemblyAI Universal-2              https://www.assemblyai.com/blog/universal-2
 *
 * The `speaker_id` returned by impls should be a salted hash (so it is
 * unlinkable cross-tenant); this package does not enforce that.
 */

export {
  type DiarisePort,
  type DiariseSpan,
} from '../types.js';

import type {
  AudioPayload,
  DiarisePort,
  DiariseSpan,
  VadHit,
} from '../types.js';

/**
 * Single-speaker diariser — collapses the entire VAD hit into a single
 * span. For chat (one user, one channel) this is the correct default.
 */
export function createSingleSpeakerDiarise(
  speakerId: string = 'speaker-1',
): DiarisePort {
  return {
    diarise(
      _audio: AudioPayload,
      hit: VadHit,
    ): Promise<ReadonlyArray<DiariseSpan>> {
      return Promise.resolve([
        {
          speaker_id: speakerId,
          start_ms: hit.start_ms,
          end_ms: hit.end_ms,
        },
      ]);
    },
  };
}
