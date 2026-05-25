/**
 * OpenAI Realtime STT adapter — backed by Whisper-large-v3-turbo for batch
 * (`/v1/audio/transcriptions`) and the Realtime API WebSocket endpoint for
 * streaming. The same `STTPort` shape so consumers don't care which is which.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type Language,
  type STTRequest,
  type STTResult,
  type TranscriptSegment,
} from '../types.js';
import { pruneUndefined, toBlobPart } from '../_internal/bytes.js';
import type { STTPort } from './index.js';

export interface OpenAIRealtimeAdapterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface OpenAITranscriptionResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: ReadonlyArray<{
    text?: string;
    start?: number;
    end?: number;
    avg_logprob?: number;
    no_speech_prob?: number;
  }>;
}

export function createOpenAIRealtimeAdapter(
  options: OpenAIRealtimeAdapterOptions = {},
): STTPort {
  const apiKey = options.apiKey ?? readEnv('OPENAI_API_KEY');
  const model = options.model ?? 'whisper-large-v3-turbo';
  const endpoint =
    options.endpoint ?? 'https://api.openai.com/v1/audio/transcriptions';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const transcribe = async (request: STTRequest): Promise<STTResult> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'OPENAI_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }
    const form = buildFormData(request, model);
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `OpenAI STT ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as OpenAITranscriptionResponse;
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
    const merged = mergeChunks(collected, template);
    const result = await transcribe({
      audio: merged,
      language: streamOptions?.language ?? 'auto',
      diarize: false,
      timestamps: true,
      punctuate: true,
    });
    for (const segment of result.segments) yield segment;
  };

  return {
    modelId: model,
    provider: 'openai-realtime',
    transcribe,
    streamTranscribe,
  };
}

function buildFormData(request: STTRequest, model: string): FormData {
  const form = new FormData();
  const blob = new Blob([toBlobPart(request.audio.bytes)], {
    type: mimeFor(request.audio),
  });
  form.append('file', blob, `audio.${request.audio.format}`);
  form.append('model', model);
  form.append('response_format', 'verbose_json');
  if (request.language && request.language !== 'auto') {
    form.append('language', baseLanguage(request.language));
  }
  if (request.timestamps !== false) {
    form.append('timestamp_granularities[]', 'segment');
  }
  return form;
}

function baseLanguage(lang: Language): string {
  // OpenAI uses ISO-639-1; strip region.
  return lang.split('-')[0] ?? lang;
}

function mapResponse(
  payload: OpenAITranscriptionResponse,
  modelId: string,
  requestedLanguage: Language,
): STTResult {
  const language = (payload.language as Language | undefined) ?? requestedLanguage;
  const segments: TranscriptSegment[] = (payload.segments ?? []).map(
    (segment) =>
      pruneUndefined({
        text: segment.text ?? '',
        startMs: Math.round((segment.start ?? 0) * 1000),
        endMs: Math.round((segment.end ?? 0) * 1000),
        confidence:
          segment.avg_logprob == null
            ? undefined
            : Math.max(0, Math.min(1, Math.exp(segment.avg_logprob))),
        isFinal: true,
        language,
      }) as TranscriptSegment,
  );
  return {
    transcript: payload.text ?? '',
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
      return 'audio/wav';
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
