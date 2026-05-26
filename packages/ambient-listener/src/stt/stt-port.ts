/**
 * STT port. Production stack per spec §4:
 *
 *   - Primary    Gemini Live           https://ai.google.dev/gemini-api/docs/live-api
 *   - Fallback   AssemblyAI Universal-2 https://www.assemblyai.com/docs/concepts/supported-languages
 *   - Sensitive  Whisper.cpp (local)   https://github.com/ggerganov/whisper.cpp
 *   - Backup     Vosk Swahili (local)  https://alphacephei.com/vosk/models
 *
 * The pipeline chooses the impl by injected `chooseStt(consent)` — for
 * standard consent Gemini Live; for `sensitivity='highly-sensitive'`
 * the local Whisper impl. Sensitivity tagging lives on the
 * cognitive-memory cell, not on the consent row — the pipeline reads
 * it via the injected `chooseStt` callback.
 */

export {
  type SttPort,
  type SttArgs,
  type SttResult,
} from '../types.js';

import type { SttArgs, SttPort } from '../types.js';

/**
 * Fixed-transcript STT — for tests. Returns the configured `transcript`
 * for every call, ignoring the audio payload.
 */
export function createFixedTranscriptStt(
  transcript: string,
  provider: string = 'fixed-test',
): SttPort {
  return {
    transcribe(_args: SttArgs) {
      return Promise.resolve({ transcript, provider });
    },
  };
}

/**
 * STT that ALWAYS throws — used to test the silent-disable path on
 * provider failure.
 */
export function createFailingStt(message: string = 'stt provider down'): SttPort {
  return {
    transcribe(_args: SttArgs) {
      return Promise.reject(new Error(message));
    },
  };
}
