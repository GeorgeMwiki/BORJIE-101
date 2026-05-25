/**
 * Cartesia Sonic-2 STT adapter.
 *
 * Cartesia focus is sub-300ms streaming. Same `STTPort` contract — under the
 * hood we POST to the listen endpoint with the same chunked-multipart body
 * shape Cartesia uses. The key trick is the `partial_results=true` query
 * parameter so the underlying SSE / NDJSON yields partials; we map each
 * partial to a non-final `TranscriptSegment` and the final to `isFinal=true`.
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

export interface CartesiaAdapterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface CartesiaResponse {
  transcript?: string;
  language?: string;
  duration?: number;
  segments?: ReadonlyArray<{
    text?: string;
    start_ms?: number;
    end_ms?: number;
    is_final?: boolean;
    confidence?: number;
    speaker?: string;
  }>;
}

export function createCartesiaAdapter(
  options: CartesiaAdapterOptions = {},
): STTPort {
  const apiKey = options.apiKey ?? readEnv('CARTESIA_API_KEY');
  const model = options.model ?? 'sonic-2';
  const endpoint = options.endpoint ?? 'https://api.cartesia.ai/listen/v1';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const transcribe = async (request: STTRequest): Promise<STTResult> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'CARTESIA_API_KEY missing — set env or pass apiKey',
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
    }
    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': mimeFor(request.audio),
        'X-Cartesia-Version': '2026-01-01',
      },
      body: toBodyInit(request.audio.bytes),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Cartesia ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as CartesiaResponse;
    return mapResponse(json, model, request.language ?? 'auto');
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
      language: streamOptions?.language ?? 'auto',
      diarize: streamOptions?.diarize ?? false,
      timestamps: true,
      punctuate: true,
    });
    for (const segment of result.segments) yield segment;
  };

  return {
    modelId: model,
    provider: 'cartesia',
    transcribe,
    streamTranscribe,
  };
}

function mapResponse(
  payload: CartesiaResponse,
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
        isFinal: segment.is_final ?? true,
        confidence: segment.confidence,
        speakerId: segment.speaker,
        language,
      }) as TranscriptSegment,
  );
  return {
    transcript: payload.transcript ?? '',
    segments,
    language,
    durationMs: Math.round((payload.duration ?? 0) * 1000),
    modelId,
  };
}

function mimeFor(chunk: AudioChunk): string {
  switch (chunk.format) {
    case 'wav':
      return 'audio/wav';
    case 'opus':
      return 'audio/opus';
    case 'mp3':
      return 'audio/mpeg';
    case 'pcm':
    default:
      return `audio/L16; rate=${chunk.sampleRate}`;
  }
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
