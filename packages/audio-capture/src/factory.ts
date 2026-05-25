/**
 * Top-level `createAudioCapture` factory.
 *
 * Bundles every subsystem behind a single instantiation so consumers wire
 * once and select capabilities by presence (`capture.realtime` is `null` if
 * `stt`, `tts`, `vad`, and `brain` aren't all supplied).
 */

import { createRealtimeSession } from './realtime/index.js';
import type {
  BrainPort,
  RealtimeSession,
  RealtimeSessionOptions,
} from './types.js';
import type { STTPort } from './stt/index.js';
import type { TTSPort } from './tts/index.js';
import type { VADPort } from './vad/index.js';
import type { DiarizationPort } from './diarization/index.js';
import type { EnhancementPort } from './enhancement/index.js';

export interface CreateAudioCaptureOptions {
  readonly stt?: STTPort;
  readonly tts?: TTSPort;
  readonly vad?: VADPort;
  readonly diarization?: DiarizationPort;
  readonly enhancement?: EnhancementPort;
  readonly brain?: BrainPort;
  readonly defaultVoiceId?: string;
}

export interface AudioCapture {
  readonly stt: STTPort | null;
  readonly tts: TTSPort | null;
  readonly vad: VADPort | null;
  readonly diarization: DiarizationPort | null;
  readonly enhancement: EnhancementPort | null;
  readonly brain: BrainPort | null;
  startRealtimeSession(options?: RealtimeSessionOptions): RealtimeSession;
}

export function createAudioCapture(
  options: CreateAudioCaptureOptions = {},
): AudioCapture {
  const stt = options.stt ?? null;
  const tts = options.tts ?? null;
  const vad = options.vad ?? null;
  const diarization = options.diarization ?? null;
  const enhancement = options.enhancement ?? null;
  const brain = options.brain ?? null;
  const voiceId = options.defaultVoiceId ?? 'default';

  const startRealtimeSession = (
    sessionOptions?: RealtimeSessionOptions,
  ): RealtimeSession => {
    if (!stt || !tts || !vad || !brain) {
      throw new Error(
        'startRealtimeSession requires stt + tts + vad + brain to be provided',
      );
    }
    const deps = {
      stt,
      tts,
      vad,
      brain,
      voiceId,
      ...(enhancement ? { enhancement } : {}),
      ...(sessionOptions ? { options: sessionOptions } : {}),
    };
    return createRealtimeSession(deps);
  };

  return {
    stt,
    tts,
    vad,
    diarization,
    enhancement,
    brain,
    startRealtimeSession,
  };
}
