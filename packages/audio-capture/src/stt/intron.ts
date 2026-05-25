/**
 * Intron Health Swahili-first STT adapter.
 *
 * Intron (intron.io) trains African-language ASR models and Swahili is their
 * flagship. We expose the same `STTPort` so callers can swap to Intron when
 * they detect Swahili / Sheng in a session — vital for our Tanzania-first
 * (and East Africa-broadly) deployments where Deepgram's Swahili remains
 * accent-mismatched.
 *
 * Note: endpoint defaults to Intron's documented `/v1/transcribe`; consumers
 * can override for self-hosted deployments.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type Language,
  type STTRequest,
  type STTResult,
  type TranscriptSegment,
} from '../types.js';
import { pruneUndefined, toBodyInit } from '../_internal/bytes.js';
import type { STTPort } from './index.js';

export interface IntronAdapterOptions {
  readonly apiKey?: string;
  readonly apiEndpoint?: string;
  readonly model?: string;
  readonly fetchImpl?: typeof fetch;
}

interface IntronResponse {
  transcript?: string;
  language?: string;
  duration_ms?: number;
  segments?: ReadonlyArray<{
    text?: string;
    start_ms?: number;
    end_ms?: number;
    speaker_id?: string;
    confidence?: number;
  }>;
}

export function createIntronAdapter(
  options: IntronAdapterOptions = {},
): STTPort {
  const apiKey = options.apiKey ?? readEnv('INTRON_API_KEY');
  const endpoint =
    options.apiEndpoint ??
    readEnv('INTRON_API_ENDPOINT') ??
    'https://api.intron.io/v1/transcribe';
  const model = options.model ?? 'intron-swahili-v3';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const transcribe = async (request: STTRequest): Promise<STTResult> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'INTRON_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const url = new URL(endpoint);
    url.searchParams.set('model', model);
    if (request.diarize) url.searchParams.set('diarize', 'true');
    if (request.language && request.language !== 'auto') {
      url.searchParams.set('language', request.language);
    } else {
      url.searchParams.set('language', 'sw');
    }

    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'audio/wav',
      },
      body: toBodyInit(request.audio.bytes),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Intron ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as IntronResponse;
    return mapResponse(json, model, request.language ?? 'sw');
  };

  const streamTranscribe = async function* (
    audio: AsyncIterable<AudioChunk>,
    streamOptions?: { readonly language?: Language; readonly diarize?: boolean },
  ): AsyncIterable<TranscriptSegment> {
    const collected: Uint8Array[] = [];
    let template: AudioChunk | null = null;
    for await (const chunk of audio) {
      collected.push(chunk.bytes);
      template ??= chunk;
    }
    if (!template) return;
    const result = await transcribe({
      audio: mergeChunks(collected, template),
      language: streamOptions?.language ?? 'sw',
      diarize: streamOptions?.diarize ?? false,
      timestamps: true,
      punctuate: true,
    });
    for (const segment of result.segments) yield segment;
  };

  return {
    modelId: model,
    provider: 'intron',
    transcribe,
    streamTranscribe,
  };
}

function mapResponse(
  payload: IntronResponse,
  modelId: string,
  requestedLanguage: Language,
): STTResult {
  const language = (payload.language as Language | undefined) ?? requestedLanguage;
  const segments: TranscriptSegment[] = (payload.segments ?? []).map(
    (segment) =>
      pruneUndefined({
        text: segment.text ?? '',
        startMs: segment.start_ms ?? 0,
        endMs: segment.end_ms ?? 0,
        speakerId: segment.speaker_id,
        confidence: segment.confidence,
        isFinal: true,
        language,
      }) as TranscriptSegment,
  );
  return {
    transcript: payload.transcript ?? '',
    segments,
    language,
    durationMs: payload.duration_ms ?? 0,
    modelId,
  };
}

function mergeChunks(parts: Uint8Array[], template: AudioChunk): AudioChunk {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return { ...template, bytes: out };
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
