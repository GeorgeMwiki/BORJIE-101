/**
 * Core types for the audio-capture toolkit.
 *
 * Everything here is provider-agnostic. Adapters (Deepgram, ElevenLabs,
 * Cartesia, Hume, …) translate these structures into vendor-specific wire
 * formats. Keeping the shared vocabulary small makes it easy to swap
 * providers without rewriting consumers — e.g. switching STT from Deepgram
 * Nova-3 to a local Whisper.cpp fallback should be a single factory swap.
 *
 * Companion to `services/voice-agent/src/providers/types.ts` — we amplify,
 * not replace. The voice-agent service uses these for the sub-1s realtime
 * pipeline; consumers needing batch STT / TTS / VAD / diarization / cloning
 * use this package directly.
 */

// ---------------------------------------------------------------------------
// Audio primitives
// ---------------------------------------------------------------------------

/**
 * Sample rates we explicitly support. 48 kHz is WebRTC / Opus default;
 * 24 kHz is OpenAI Realtime; 16 kHz is the Whisper sweet spot; 8 kHz is
 * narrowband telephony (Twilio PSTN, USSD-adjacent voice).
 */
export type SampleRate = 8000 | 16000 | 24000 | 44100 | 48000;

/**
 * Container / codec descriptor used by upload + transcribe APIs.
 * `pcm` is raw little-endian 16-bit interleaved PCM.
 */
export type AudioFormat =
  | 'pcm'
  | 'wav'
  | 'mp3'
  | 'opus'
  | 'ogg'
  | 'flac'
  | 'webm'
  | 'aac';

export type ChannelCount = 1 | 2;

/**
 * Chunk of audio bytes flowing through the pipeline. `bytes` is the raw
 * payload in `format`; `durationMs` is the *intended* playback length
 * (best-effort — providers may stream variable-length frames).
 */
export interface AudioChunk {
  readonly bytes: Uint8Array;
  readonly format: AudioFormat;
  readonly sampleRate: SampleRate;
  readonly channels: ChannelCount;
  readonly durationMs?: number;
  readonly sequence?: number;
}

// ---------------------------------------------------------------------------
// Language / locale
// ---------------------------------------------------------------------------

/**
 * BCP-47-ish language tag. We allow the bare language code or a region-
 * qualified variant. The audio-capture toolkit is multilingual-first to
 * match East Africa's polyglot reality (Swahili + English + Sheng + Lingala
 * + Luganda + Kinyarwanda).
 */
export type Language =
  | 'en'
  | 'en-KE'
  | 'en-TZ'
  | 'en-UG'
  | 'sw'
  | 'sw-KE'
  | 'sw-TZ'
  | 'sheng'
  | 'lg'
  | 'lug'
  | 'rw'
  | 'fr'
  | 'fr-FR'
  | 'es'
  | 'pt'
  | 'pt-BR'
  | 'ar'
  | 'zh'
  | 'auto';

// ---------------------------------------------------------------------------
// STT
// ---------------------------------------------------------------------------

export interface STTRequest {
  readonly audio: AudioChunk;
  readonly language?: Language;
  readonly diarize?: boolean;
  readonly timestamps?: boolean;
  readonly punctuate?: boolean;
  /** Hint the provider with vocabulary biases (proper nouns, jargon). */
  readonly keywords?: ReadonlyArray<string>;
}

export interface TranscriptSegment {
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence?: number;
  readonly speakerId?: string;
  readonly isFinal: boolean;
  readonly language?: Language;
}

export interface STTResult {
  readonly transcript: string;
  readonly segments: ReadonlyArray<TranscriptSegment>;
  readonly language: Language;
  readonly durationMs: number;
  readonly modelId: string;
}

// ---------------------------------------------------------------------------
// TTS
// ---------------------------------------------------------------------------

export interface TTSRequest {
  readonly text: string;
  readonly voiceId: string;
  readonly format: AudioFormat;
  readonly sampleRate?: SampleRate;
  readonly emotion?: EmotionHint;
  readonly speed?: number;
  readonly language?: Language;
  /** Inject SSML-like markup. Adapters that don't support it must ignore. */
  readonly ssml?: boolean;
}

export interface TTSResult {
  readonly audio: AudioChunk;
  readonly voiceId: string;
  readonly modelId: string;
  readonly characters: number;
}

export interface EmotionHint {
  readonly tone?:
    | 'neutral'
    | 'cheerful'
    | 'sad'
    | 'angry'
    | 'apologetic'
    | 'empathetic'
    | 'urgent';
  readonly intensity?: number;
}

// ---------------------------------------------------------------------------
// VAD
// ---------------------------------------------------------------------------

export interface VADResult {
  readonly isSpeech: boolean;
  readonly probability: number;
  readonly chunkSequence?: number;
  readonly startMs?: number;
  readonly endMs?: number;
}

// ---------------------------------------------------------------------------
// Diarization
// ---------------------------------------------------------------------------

export interface SpeakerSegment {
  readonly speakerId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly confidence?: number;
}

// ---------------------------------------------------------------------------
// Enhancement
// ---------------------------------------------------------------------------

export type EnhancementTarget =
  | 'denoise'
  | 'dereverb'
  | 'normalize'
  | 'all';

export interface EnhancementSpec {
  readonly audio: AudioChunk;
  readonly target: EnhancementTarget;
  /** Target loudness in LUFS; default -23 per ITU-R BS.1770. */
  readonly targetLoudnessLUFS?: number;
}

// ---------------------------------------------------------------------------
// Emotion
// ---------------------------------------------------------------------------

export interface EmotionScore {
  readonly emotion: string;
  readonly score: number;
  readonly arousal?: number;
  readonly valence?: number;
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

export interface RealtimeSessionOptions {
  readonly language?: Language;
  /** Latency budget for first audio byte from response start. */
  readonly firstByteBudgetMs?: number;
  /** Probability threshold (0..1) for VAD to declare speech. */
  readonly vadSpeechThreshold?: number;
  /** Silence duration (ms) that triggers turn-end. */
  readonly turnEndSilenceMs?: number;
  /** Allow user audio to interrupt model TTS playback. */
  readonly allowInterruptions?: boolean;
}

export interface RealtimeMetrics {
  readonly turns: number;
  readonly interruptions: number;
  readonly firstAudioByteLatencyMs: ReadonlyArray<number>;
  readonly endToEndLatencyMs: ReadonlyArray<number>;
}

export interface RealtimeSession {
  readonly sessionId: string;
  send(chunk: AudioChunk): Promise<void>;
  onTranscript(handler: (segment: TranscriptSegment) => void): () => void;
  onResponse(handler: (text: string) => void): () => void;
  onSpeak(handler: (chunk: AudioChunk) => void): () => void;
  onInterruption(handler: () => void): () => void;
  metrics(): RealtimeMetrics;
  end(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Voice cloning
// ---------------------------------------------------------------------------

export interface VoiceCloneSample {
  readonly audio: AudioChunk;
  readonly language?: Language;
}

export interface VoiceCloneRequest {
  readonly name: string;
  readonly samples: ReadonlyArray<VoiceCloneSample>;
  readonly description?: string;
  readonly languages?: ReadonlyArray<Language>;
}

export interface VoiceClone {
  readonly id: string;
  readonly name: string;
  readonly provider: string;
  readonly supportedLanguages: ReadonlyArray<Language>;
  readonly supportedEmotions: ReadonlyArray<NonNullable<EmotionHint['tone']>>;
  readonly sampleRate: SampleRate;
  readonly createdAtMs: number;
}

// ---------------------------------------------------------------------------
// Brain port — minimal facade the realtime loop calls into.
// ---------------------------------------------------------------------------

export interface BrainPort {
  /**
   * Take a finalized user utterance plus rolling context, return the next
   * spoken response. Implementations may stream tokens — we await the full
   * response and rely on streaming TTS for time-to-first-audio.
   */
  respond(input: { text: string; sessionId: string }): Promise<string>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AudioCaptureError extends Error {
  override readonly name = 'AudioCaptureError';
  readonly code: string;
  override readonly cause?: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}
