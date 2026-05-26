/**
 * Anthropic Voice (Claude 4.7 voice) STT adapter.
 *
 * Anthropic's preview Voice API exposes audio transcription as part of the
 * messages endpoint with a multimodal audio input. We POST audio + a system
 * prompt that asks Claude to transcribe verbatim with timestamps, then parse
 * the structured JSON response.
 *
 * This is a *first-party* fallback: when the primary streaming STT misroutes
 * a Swahili/Sheng mix, Claude's instruction-following lets us coax a clean
 * transcript with code-switching preserved.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type Language,
  type STTRequest,
  type STTResult,
  type TranscriptSegment,
} from '../types.js';
import { pruneUndefined } from '../_internal/bytes.js';
import type { STTPort } from './index.js';

export interface AnthropicVoiceAdapterOptions {
  readonly apiKey?: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

interface ClaudeResponse {
  content?: ReadonlyArray<{ type?: string; text?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface InlineTranscript {
  transcript: string;
  language?: Language;
  segments?: ReadonlyArray<{
    text: string;
    startMs: number;
    endMs: number;
    speakerId?: string;
  }>;
}

export function createAnthropicVoiceAdapter(
  options: AnthropicVoiceAdapterOptions = {},
): STTPort {
  const apiKey = options.apiKey ?? readEnv('ANTHROPIC_API_KEY');
  const model = options.model ?? 'claude-opus-4-7-voice';
  const endpoint = options.endpoint ?? 'https://api.anthropic.com/v1/messages';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  const transcribe = async (request: STTRequest): Promise<STTResult> => {
    if (!apiKey) {
      throw new AudioCaptureError(
        'ANTHROPIC_API_KEY missing — set env or pass apiKey',
        'NO_API_KEY',
      );
    }
    if (typeof fetchImpl !== 'function') {
      throw new AudioCaptureError('fetch missing', 'NO_FETCH');
    }

    const body = {
      model,
      max_tokens: 2048,
      system:
        'You are a verbatim transcriber. Return a single JSON object with shape ' +
        '{"transcript": string, "language": string, "segments": [{"text": string, "startMs": number, "endMs": number, "speakerId"?: string}]}. ' +
        'Preserve code-switching (e.g. English ↔ Swahili). Do NOT include any commentary.',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'audio',
              source: {
                type: 'base64',
                media_type: mimeFor(request.audio),
                data: toBase64(request.audio.bytes),
              },
            },
            {
              type: 'text',
              text:
                request.language && request.language !== 'auto'
                  ? `Language hint: ${request.language}.`
                  : 'Detect language automatically.',
            },
          ],
        },
      ],
    };

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2025-10-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new AudioCaptureError(
        `Anthropic ${res.status}: ${await res.text().catch(() => '')}`,
        'UPSTREAM_FAILURE',
      );
    }
    const json = (await res.json()) as ClaudeResponse;
    const inline = parseInline(json);
    return mapInline(inline, model, request.language ?? 'auto');
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
    provider: 'anthropic-voice',
    transcribe,
    streamTranscribe,
  };
}

function parseInline(json: ClaudeResponse): InlineTranscript {
  const text = json.content?.find((c) => c.type === 'text')?.text ?? '{}';
  try {
    return JSON.parse(text) as InlineTranscript;
  } catch {
    // Fallback — treat the entire text as the transcript with no segments.
    return { transcript: text };
  }
}

function mapInline(
  inline: InlineTranscript,
  modelId: string,
  requestedLanguage: Language,
): STTResult {
  const language = inline.language ?? requestedLanguage;
  const segments: TranscriptSegment[] = (inline.segments ?? []).map(
    (segment) =>
      pruneUndefined({
        text: segment.text,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId,
        isFinal: true,
        language,
      }) as TranscriptSegment,
  );
  return {
    transcript: inline.transcript,
    segments,
    language,
    durationMs:
      segments.length > 0
        ? (segments[segments.length - 1]?.endMs ?? 0)
        : 0,
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
    case 'flac':
      return 'audio/flac';
    case 'webm':
      return 'audio/webm';
    case 'aac':
      return 'audio/aac';
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

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const g = globalThis as unknown as { btoa?: (data: string) => string };
  return typeof g.btoa === 'function' ? g.btoa(binary) : '';
}

function readEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}
