/**
 * Whisper.cpp local STT adapter.
 *
 * For air-gapped tenants (NDA-bound estate management, finance), we shell out
 * to a local `whisper` / `whisper-cli` binary. The contract: feed audio bytes
 * to stdin (PCM/WAV) and parse the JSON output. We never trust the binary
 * path from a user-controlled string — the caller must pass `binPath`
 * explicitly and we never execute via `shell: true`.
 */

import {
  AudioCaptureError,
  type AudioChunk,
  type Language,
  type STTRequest,
  type STTResult,
  type TranscriptSegment,
} from '../types.js';
import type { STTPort } from './index.js';

export interface WhisperLocalAdapterOptions {
  readonly binPath: string;
  readonly modelPath?: string;
  readonly threads?: number;
  /** Test seam: swap the spawn function for deterministic tests. */
  readonly spawn?: WhisperSpawn;
}

export interface WhisperSpawn {
  (
    bin: string,
    args: ReadonlyArray<string>,
    stdin: Uint8Array,
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}

interface WhisperJson {
  transcription?: ReadonlyArray<{
    text?: string;
    offsets?: { from?: number; to?: number };
    timestamps?: { from?: string; to?: string };
  }>;
  language?: string;
}

export function createWhisperLocalAdapter(
  options: WhisperLocalAdapterOptions,
): STTPort {
  const bin = options.binPath;
  const modelPath = options.modelPath;
  const threads = options.threads ?? 4;
  const spawnImpl: WhisperSpawn = options.spawn ?? defaultSpawn;

  const runWhisper = async (
    audio: AudioChunk,
    language?: Language,
  ): Promise<WhisperJson> => {
    if (!bin) {
      throw new AudioCaptureError('binPath missing', 'NO_BIN');
    }
    const args = [
      '-f', '-',
      '-otxt', 'json',
      '-t', String(threads),
    ];
    if (modelPath) args.push('-m', modelPath);
    if (language && language !== 'auto') {
      args.push('-l', language.split('-')[0] ?? language);
    }
    const result = await spawnImpl(bin, args, audio.bytes);
    if (result.code !== 0) {
      throw new AudioCaptureError(
        `whisper.cpp exit ${result.code}: ${result.stderr.slice(0, 256)}`,
        'WHISPER_FAILED',
      );
    }
    try {
      return JSON.parse(result.stdout) as WhisperJson;
    } catch (cause) {
      throw new AudioCaptureError(
        'failed to parse whisper.cpp output',
        'WHISPER_PARSE',
        cause,
      );
    }
  };

  const transcribe = async (request: STTRequest): Promise<STTResult> => {
    const json = await runWhisper(request.audio, request.language);
    return mapWhisper(json, modelPath ?? 'whisper-cpp', request.language ?? 'auto');
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
    modelId: modelPath ?? 'whisper-cpp',
    provider: 'whisper-local',
    transcribe,
    streamTranscribe,
  };
}

function mapWhisper(
  json: WhisperJson,
  modelId: string,
  requestedLanguage: Language,
): STTResult {
  const language = (json.language as Language | undefined) ?? requestedLanguage;
  const segments: TranscriptSegment[] = (json.transcription ?? []).map(
    (entry) => ({
      text: entry.text ?? '',
      startMs: entry.offsets?.from ?? 0,
      endMs: entry.offsets?.to ?? 0,
      isFinal: true,
      language,
    }),
  );
  const transcript = segments.map((s) => s.text).join('').trim();
  return {
    transcript,
    segments,
    language,
    durationMs: segments.length > 0
      ? (segments[segments.length - 1]?.endMs ?? 0)
      : 0,
    modelId,
  };
}

async function defaultSpawn(
  bin: string,
  args: ReadonlyArray<string>,
  stdin: Uint8Array,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutParts: Buffer[] = [];
    const stderrParts: Buffer[] = [];
    child.stdout?.on('data', (b: Buffer) => stdoutParts.push(b));
    child.stderr?.on('data', (b: Buffer) => stderrParts.push(b));
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      resolve({
        stdout: Buffer.concat(stdoutParts).toString('utf8'),
        stderr: Buffer.concat(stderrParts).toString('utf8'),
        code: code ?? -1,
      });
    });
    child.stdin?.end(Buffer.from(stdin));
  });
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
