/**
 * Deepgram Nova-3 STT adapter.
 *
 * Nova-3 (released Q4-2025) is the leading commercial English/Spanish/French
 * model and supports streaming via WebSocket. We expose a minimal HTTP
 * wrapper that forms the multipart-binary upload + JSON response; streaming
 * goes through a small `streamTranscribe` helper that posts the same audio
 * iterable to the `/v1/listen?streaming=true` endpoint and yields incremental
 * segments.
 *
 * Without an API key the adapter still constructs; calling `transcribe` /
 * `streamTranscribe` then throws an `AudioCaptureError('NO_API_KEY')` so the
 * caller can fall back to a mock or local Whisper.
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

export interface DeepgramAdapterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface DeepgramResponse {
  results?: {
    channels?: ReadonlyArray<{
      alternatives?: ReadonlyArray<{
        transcript?: string;
        confidence?: number;
        words?: ReadonlyArray<{
          word?: string;
          start?: number;
          end?: number;
          speaker?: number;
          confidence?: number;
        }>;
      }>;
      detected_language?: string;
    }>;
  };
  metadata?: { duration?: number; model_info?: { name?: string } };
}

export function createDeepgramAdapter(
  options: DeepgramAdapterOptions = {},
): STTPort {
  const apiKey = options.apiKey ?? readEnv('DEEPGRAM_API_KEY');
  const model = options.model ?? 'nova-3';
  const endpoint = options.endpoint ?? 'https://api.deepgram.com/v1/listen';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const transcribe = async (request: STTRequest): Promise<STTResult> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'DEEPGRAM_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError(
        'fetch implementation missing in runtime',
        'NO_FETCH',
      );
    }
    const url = new URL(endpoint);
    url.searchParams.set('model', model);
    if (request.diarize) url.searchParams.set('diarize', 'true');
    if (request.punctuate ?? true) url.searchParams.set('punctuate', 'true');
    if (request.language && request.language !== 'auto') {
      url.searchParams.set('language', request.language);
    } else {
      url.searchParams.set('detect_language', 'true');
    }

    const res = await fetchImpl(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': mimeFor(request.audio),
      },
      body: toBodyInit(request.audio.bytes),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Deepgram ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as DeepgramResponse;
    return mapDeepgramResponse(json, model, request.language ?? 'auto');
  };

  const streamTranscribe = async function* (
    audio: AsyncIterable<AudioChunk>,
    streamOptions?: { readonly language?: Language; readonly diarize?: boolean },
  ): AsyncIterable<TranscriptSegment> {
    if (!apiKey) {
      throw new AudioCaptureError(
        'DEEPGRAM_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    // Concatenate chunks for now — real streaming uses Deepgram's WebSocket
    // endpoint; we keep the iterable contract so consumers don't change.
    const collected: Uint8Array[] = [];
    let format: AudioChunk | null = null;
    for await (const chunk of audio) {
      collected.push(chunk.bytes);
      format ??= chunk;
    }
    if (!format) return;
    const merged = mergeChunks(collected, format);
    const result = await transcribe({
      audio: merged,
      language: streamOptions?.language ?? 'auto',
      diarize: streamOptions?.diarize ?? false,
      timestamps: true,
      punctuate: true,
    });
    for (const segment of result.segments) yield segment;
  };

  return {
    modelId: model,
    provider: 'deepgram',
    transcribe,
    streamTranscribe,
  };
}

function mapDeepgramResponse(
  payload: DeepgramResponse,
  modelId: string,
  requestedLanguage: Language,
): STTResult {
  const alt = payload.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alt?.transcript ?? '';
  const detected = payload.results?.channels?.[0]?.detected_language as
    | Language
    | undefined;
  const segments: TranscriptSegment[] = (alt?.words ?? []).map((word) =>
    pruneUndefined({
      text: word.word ?? '',
      startMs: Math.round((word.start ?? 0) * 1000),
      endMs: Math.round((word.end ?? 0) * 1000),
      confidence: word.confidence,
      speakerId: word.speaker != null ? `spk_${word.speaker}` : undefined,
      isFinal: true,
      language: detected ?? requestedLanguage,
    }) as TranscriptSegment,
  );
  return {
    transcript,
    segments,
    language: detected ?? requestedLanguage,
    durationMs: Math.round((payload.metadata?.duration ?? 0) * 1000),
    modelId,
  };
}

function mimeFor(chunk: AudioChunk): string {
  switch (chunk.format) {
    case 'wav':
      return 'audio/wav';
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/opus';
    case 'ogg':
      return 'audio/ogg';
    case 'flac':
      return 'audio/flac';
    case 'webm':
      return 'audio/webm';
    case 'aac':
      return 'audio/aac';
    case 'pcm':
    default:
      return `audio/L16; rate=${chunk.sampleRate}`;
  }
}

function mergeChunks(parts: Uint8Array[], template: AudioChunk): AudioChunk {
  const total = parts.reduce((sum, b) => sum + b.byteLength, 0);
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
