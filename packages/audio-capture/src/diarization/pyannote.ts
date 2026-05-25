/**
 * pyannote.audio 3.x adapter.
 *
 * pyannote ships as a Python lib; in production we deploy it behind an HTTP
 * service. The adapter POSTs audio bytes + expectedSpeakers and parses the
 * RTTM-style JSON response.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type SpeakerSegment,
} from '../types.js';
import { pruneUndefined, toBodyInit } from '../_internal/bytes.js';
import type { DiarizationPort } from './index.js';

export interface PyannoteAdapterOptions {
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface PyannoteResponse {
  segments?: ReadonlyArray<{
    speaker?: string;
    start?: number;
    end?: number;
    confidence?: number;
  }>;
}

export function createPyannoteAdapter(
  options: PyannoteAdapterOptions = {},
): DiarizationPort {
  const apiKey = options.apiKey ?? readEnv('PYANNOTE_API_KEY');
  const endpoint = options.endpoint ?? 'https://api.pyannote.ai/v1/diarize';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const diarize = async (input: {
    readonly audio: AudioChunk;
    readonly expectedSpeakers?: number;
  }): Promise<ReadonlyArray<SpeakerSegment>> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'PYANNOTE_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const url = new URL(endpoint);
    if (input.expectedSpeakers != null) {
      url.searchParams.set('num_speakers', String(input.expectedSpeakers));
    }
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'audio/wav',
      },
      body: toBodyInit(input.audio.bytes),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Pyannote ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as PyannoteResponse;
    const speakerMap = new Map<string, string>();
    const segments: SpeakerSegment[] = (json.segments ?? []).map((segment) => {
      const rawSpeaker = segment.speaker ?? 'spk_unknown';
      if (!speakerMap.has(rawSpeaker)) {
        speakerMap.set(rawSpeaker, `spk_${speakerMap.size}`);
      }
      const speakerId = speakerMap.get(rawSpeaker) ?? 'spk_unknown';
      return pruneUndefined({
        speakerId,
        startMs: Math.round((segment.start ?? 0) * 1000),
        endMs: Math.round((segment.end ?? 0) * 1000),
        confidence: segment.confidence,
      }) as SpeakerSegment;
    });
    return segments;
  };

  return { provider: 'pyannote', diarize };
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
