/**
 * STT provider factory — env-gated REAL speech-to-text for the voice agent.
 *
 * Honest provider pattern (mirrors the M-Pesa payout rail + the
 * `voice-agent-wiring` brain stub): the factory inspects the bootstrap env
 * object and returns ONE of two clearly-typed providers:
 *
 *   1. CONFIGURED — when `STT_API_KEY` (preferred) or `OPENAI_API_KEY` is
 *      present, it returns a REAL `VoiceSttPort` that downloads the turn's
 *      audio and transcribes it through `@borjie/audio-capture`'s OpenAI
 *      Whisper adapter (`createOpenAIRealtimeAdapter`, batch
 *      `/v1/audio/transcriptions`, model `whisper-large-v3-turbo`). Nothing
 *      is fabricated — the transcript is the provider's verbatim output.
 *
 *   2. UNCONFIGURED — when no key is present, it returns a typed
 *      "unconfigured" provider whose `transcribe()` THROWS
 *      `STT_PROVIDER_NOT_CONFIGURED`. It NEVER returns a fake transcript.
 *      The voice agent maps a throw to its `UPSTREAM_ERROR` contract; a
 *      caller that prefers the softer `VOICE_NOT_CONFIGURED` contract can
 *      pass `unconfiguredMode: 'null-port'` to wire `stt: null` instead
 *      (the agent then short-circuits to `VOICE_NOT_CONFIGURED`).
 *
 * Why a composition-level factory (and not just the adapter): the
 * `@borjie/audio-capture` adapters already construct without a key and only
 * throw on USE. That is correct for the package, but the gateway wants a
 * single, auditable boot decision — "is real STT live in this env?" — that
 * downstream wiring can branch on. This factory is that decision point, and
 * it reads the credential from the injected env object (NOT `process.env`
 * at module scope) so it honours the bootstrap-env hard rule and stays
 * unit-testable.
 *
 * Port shape: `@borjie/audio-capture`'s `STTPort` is byte-oriented
 * (`AudioChunk`), whereas the voice agent's `VoiceSttPort` is URL-oriented
 * (`{ audioUrl, languageHint }`). This factory bridges the two: it fetches
 * the audio bytes via an injectable `fetchImpl`, infers the container from
 * the URL/content-type, and maps the `STTResult` back onto the agent's
 * `{ transcript, detectedLanguage, confidence }` shape.
 *
 * Tenant isolation: STT is stateless and tenant-agnostic at the transport
 * layer — the audio URL is already tenant-scoped by the caller that minted
 * it. No tenant data is persisted here.
 *
 * No `console.log` — failures surface as typed errors / structured warnings.
 */

import {
  createOpenAIRealtimeAdapter,
  type AudioChunk,
  type AudioFormat,
  type Language,
  type STTPort,
  type STTResult,
} from '@borjie/audio-capture';
import type { VoiceAgent as VoiceAgentNs } from '@borjie/ai-copilot/ai-native';

/** The voice-agent STT port this factory produces. */
type VoiceSttPort = VoiceAgentNs.VoiceSttPort;

/** Stable error code thrown by the unconfigured provider. */
export const STT_PROVIDER_NOT_CONFIGURED = 'STT_PROVIDER_NOT_CONFIGURED';

/**
 * Typed error raised by the unconfigured provider on use. Carries a stable
 * `.code` so callers / dashboards can branch without string-matching the
 * message.
 */
export class SttProviderNotConfiguredError extends Error {
  override readonly name = 'SttProviderNotConfiguredError';
  readonly code = STT_PROVIDER_NOT_CONFIGURED;
  constructor(
    message = 'STT provider is not configured — set STT_API_KEY or OPENAI_API_KEY to enable speech-to-text',
  ) {
    super(message);
  }
}

/**
 * Minimal env surface the factory reads. Defaults to `process.env` ONLY at
 * call time (never at module scope) — mirrors `getTierCallCap(tier, env)` in
 * `@borjie/mcp-server`.
 */
export type SttEnv = Readonly<Record<string, string | undefined>>;

/**
 * Discriminated result of {@link createSttProvider} so the caller can log /
 * branch on the boot decision and the chosen model. `port` is always a valid
 * `VoiceSttPort` — when `configured` is `false` it is the throwing
 * unconfigured provider (or `null` under `unconfiguredMode: 'null-port'`).
 */
export interface SttProviderResult {
  readonly configured: boolean;
  readonly provider: 'openai-whisper' | 'unconfigured';
  readonly modelId: string | null;
  /** The port to pass to `createVoiceAgent({ stt })`. */
  readonly port: VoiceSttPort | null;
}

export interface CreateSttProviderOptions {
  /** Bootstrap env object. Defaults to `process.env` at call time. */
  readonly env?: SttEnv;
  /**
   * How to represent the "no credential" state to the voice agent:
   *   - `'throwing-port'` (default): a non-null port that throws
   *     `STT_PROVIDER_NOT_CONFIGURED` on use (honest, loud).
   *   - `'null-port'`: `port: null`, letting the agent return its softer
   *     `VOICE_NOT_CONFIGURED` structured result.
   */
  readonly unconfiguredMode?: 'throwing-port' | 'null-port';
  /** Override the Whisper model id (default `whisper-large-v3-turbo`). */
  readonly model?: string;
  /** Injected fetch for audio download + provider HTTP (tests). */
  readonly fetchImpl?: typeof fetch;
  /** Inject a pre-built audio-capture STT port (tests / alternate provider). */
  readonly sttPortOverride?: STTPort;
  /** Optional structured logger (Pino-style). */
  readonly logger?: { warn(meta: object, msg: string): void };
}

/**
 * Resolve the STT credential from the env object. `STT_API_KEY` wins so an
 * operator can scope a dedicated key to STT without sharing the general
 * `OPENAI_API_KEY`. Empty / whitespace strings are treated as absent.
 */
export function resolveSttApiKey(env: SttEnv): string | undefined {
  const candidate = env.STT_API_KEY ?? env.OPENAI_API_KEY;
  if (candidate === undefined) return undefined;
  const trimmed = candidate.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Build the STT provider for the current environment.
 *
 * Pure factory — no module-level state, no `process.env` read at module
 * scope. The credential is read from `options.env` (defaulting to
 * `process.env` at call time only).
 */
export function createSttProvider(
  options: CreateSttProviderOptions = {},
): SttProviderResult {
  const env: SttEnv = options.env ?? process.env;
  const mode = options.unconfiguredMode ?? 'throwing-port';
  const apiKey = resolveSttApiKey(env);

  if (!apiKey && !options.sttPortOverride) {
    if (options.logger) {
      options.logger.warn(
        { port: 'VoiceSttPort', degraded_reason: STT_PROVIDER_NOT_CONFIGURED },
        'STT provider not configured (no STT_API_KEY / OPENAI_API_KEY) — voice transcription disabled',
      );
    }
    return Object.freeze({
      configured: false,
      provider: 'unconfigured' as const,
      modelId: null,
      port:
        mode === 'null-port'
          ? null
          : createUnconfiguredVoiceSttPort(),
    });
  }

  const model = options.model ?? 'whisper-large-v3-turbo';
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sttPort: STTPort =
    options.sttPortOverride ??
    createOpenAIRealtimeAdapter({
      ...(apiKey !== undefined ? { apiKey } : {}),
      model,
      ...(typeof fetchImpl === 'function' ? { fetchImpl } : {}),
    });

  return Object.freeze({
    configured: true,
    provider: 'openai-whisper' as const,
    modelId: sttPort.modelId,
    port: createConfiguredVoiceSttPort(sttPort, fetchImpl),
  });
}

/**
 * The throwing unconfigured provider. Satisfies `VoiceSttPort` structurally
 * but refuses on every call — NEVER returns a fabricated transcript.
 */
export function createUnconfiguredVoiceSttPort(): VoiceSttPort {
  return Object.freeze({
    async transcribe(): Promise<never> {
      throw new SttProviderNotConfiguredError();
    },
  });
}

/**
 * Adapt a byte-oriented `@borjie/audio-capture` `STTPort` into the
 * URL-oriented voice-agent `VoiceSttPort`.
 *
 * Flow: download `audioUrl` → infer container/format → call
 * `sttPort.transcribe({ audio })` → map `STTResult` to the agent shape.
 */
function createConfiguredVoiceSttPort(
  sttPort: STTPort,
  fetchImpl: typeof fetch,
): VoiceSttPort {
  return Object.freeze({
    async transcribe(input: {
      readonly audioUrl: string;
      readonly languageHint?: string;
    }): Promise<{
      readonly transcript: string;
      readonly detectedLanguage: string;
      readonly confidence: number | null;
    } | null> {
      if (typeof fetchImpl !== 'function') {
        throw new SttProviderNotConfiguredError(
          'STT provider configured but no fetch implementation is available in this runtime',
        );
      }

      const audio = await downloadAudioChunk(input.audioUrl, fetchImpl);
      const result: STTResult = await sttPort.transcribe({
        audio,
        ...(input.languageHint
          ? { language: normaliseLanguage(input.languageHint) }
          : { language: 'auto' as Language }),
        timestamps: true,
        punctuate: true,
      });

      return {
        transcript: result.transcript,
        detectedLanguage: result.language,
        confidence: averageConfidence(result),
      };
    },
  });
}

/**
 * Download the audio bytes at `url` and wrap them in an `AudioChunk` whose
 * `format` is inferred from the response `Content-Type` (preferred) or the
 * URL extension (fallback). Sample rate / channels are best-effort metadata —
 * the OpenAI batch endpoint reads the container header itself, so these are
 * advisory only.
 */
async function downloadAudioChunk(
  url: string,
  fetchImpl: typeof fetch,
): Promise<AudioChunk> {
  const res = await fetchImpl(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(
      `STT audio download failed: ${res.status} ${res.statusText} for ${url}`,
    );
  }
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const contentType = res.headers.get('content-type');
  const format = inferAudioFormat(url, contentType);
  return {
    bytes,
    format,
    // Advisory metadata — the container header is authoritative downstream.
    sampleRate: 16000,
    channels: 1,
  };
}

const EXTENSION_FORMATS: Readonly<Record<string, AudioFormat>> = Object.freeze({
  wav: 'wav',
  mp3: 'mp3',
  mpeg: 'mp3',
  m4a: 'aac',
  aac: 'aac',
  opus: 'opus',
  ogg: 'ogg',
  oga: 'ogg',
  flac: 'flac',
  webm: 'webm',
  pcm: 'pcm',
});

const CONTENT_TYPE_FORMATS: ReadonlyArray<
  readonly [match: string, format: AudioFormat]
> = Object.freeze([
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/wave', 'wav'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/aac', 'aac'],
  ['audio/mp4', 'aac'],
  ['audio/m4a', 'aac'],
  ['audio/x-m4a', 'aac'],
  ['audio/opus', 'opus'],
  ['audio/ogg', 'ogg'],
  ['audio/flac', 'flac'],
  ['audio/webm', 'webm'],
] as const);

/** Infer the audio container, preferring the response content-type. */
export function inferAudioFormat(
  url: string,
  contentType: string | null,
): AudioFormat {
  if (contentType) {
    const lower = contentType.toLowerCase();
    for (const [match, format] of CONTENT_TYPE_FORMATS) {
      if (lower.includes(match)) return format;
    }
  }
  const ext = extractExtension(url);
  if (ext && ext in EXTENSION_FORMATS) {
    return EXTENSION_FORMATS[ext] as AudioFormat;
  }
  // Default to wav — OpenAI tolerates a generic container hint and reads the
  // real header. We never guess a transcript; only the wrapper format.
  return 'wav';
}

function extractExtension(url: string): string | null {
  try {
    const pathname = new URL(url, 'http://localhost').pathname;
    const dot = pathname.lastIndexOf('.');
    if (dot === -1 || dot === pathname.length - 1) return null;
    return pathname.slice(dot + 1).toLowerCase();
  } catch {
    return null;
  }
}

const SUPPORTED_LANGUAGES: ReadonlySet<Language> = new Set<Language>([
  'en',
  'en-KE',
  'en-TZ',
  'en-UG',
  'sw',
  'sw-KE',
  'sw-TZ',
  'sheng',
  'lg',
  'lug',
  'rw',
  'fr',
  'fr-FR',
  'es',
  'pt',
  'pt-BR',
  'ar',
  'zh',
  'auto',
]);

/**
 * Coerce a free-text language hint into the audio-capture `Language` union.
 * Unknown hints fall back to `'auto'` (let the provider detect) — never a
 * hard-coded `en`, per the language-neutrality hard rule.
 */
export function normaliseLanguage(hint: string): Language {
  const trimmed = hint.trim();
  if (trimmed === '') return 'auto';
  if (SUPPORTED_LANGUAGES.has(trimmed as Language)) return trimmed as Language;
  const base = trimmed.split('-')[0]?.toLowerCase();
  if (base && SUPPORTED_LANGUAGES.has(base as Language)) {
    return base as Language;
  }
  return 'auto';
}

/**
 * Compute a single confidence figure from the per-segment confidences the
 * provider returned. Returns `null` when no segment carried a confidence —
 * an HONEST "unknown", never a fabricated 1.0.
 */
function averageConfidence(result: STTResult): number | null {
  const scored = result.segments.filter(
    (s): s is typeof s & { confidence: number } =>
      typeof s.confidence === 'number' && Number.isFinite(s.confidence),
  );
  if (scored.length === 0) return null;
  const sum = scored.reduce((acc, s) => acc + s.confidence, 0);
  return sum / scored.length;
}
