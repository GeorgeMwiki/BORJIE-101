/**
 * Shared provider contracts for the voice-agent pipeline.
 *
 * Real implementations open a WebSocket / gRPC stream against the upstream
 * vendor; the stubs in this directory return deterministic placeholders that
 * are exercised by the unit tests. The interface is intentionally minimal —
 * just enough to let the routers wire STT and TTS providers together at
 * runtime without leaking vendor specifics into the persona / route layer.
 */

// UNIV-4: LanguageTag union hardcodes EA + NG launch language set including
// TZ-launch sw-TZ. When adding new jurisdictions, type this as a string-derived
// union from @borjie/language-packs registry installed-pack list. Tracked
// gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
export type LanguageTag =
  | 'en'
  | 'en-KE'
  | 'sw'
  | 'sw-TZ'
  | 'sheng'
  | 'lug'
  | 'lg'
  | 'yo'
  | 'ig'
  | 'ha';

/** PCM/Opus chunk pushed up from the caller. Provider-agnostic byte view. */
export interface AudioChunk {
  readonly bytes: Uint8Array;
  readonly mimeType: 'audio/pcm' | 'audio/opus' | 'audio/wav';
  readonly sampleRate: 8000 | 16000 | 24000 | 48000;
}

/** Streaming STT event the upstream pipeline emits. */
export interface PartialTranscript {
  readonly sessionId: string;
  readonly text: string;
  readonly isFinal: boolean;
  /** Confidence 0..1 if the provider exposes it; undefined otherwise. */
  readonly confidence?: number;
  readonly language: LanguageTag;
}

/** Streaming TTS event the upstream pipeline emits. */
export interface PartialAudio {
  readonly sessionId: string;
  readonly audio: AudioChunk;
  readonly isFinal: boolean;
}

/**
 * Every provider stub returns a SessionHandle. The handle exposes async
 * iterables for partial transcripts (STT) or partial audio (TTS); calling
 * `close()` releases upstream resources.
 */
export interface SttSessionHandle {
  readonly sessionId: string;
  readonly provider: ProviderName;
  pushAudio(chunk: AudioChunk): Promise<void>;
  transcripts(): AsyncIterable<PartialTranscript>;
  close(): Promise<void>;
}

export interface TtsSessionHandle {
  readonly sessionId: string;
  readonly provider: ProviderName;
  speak(text: string): Promise<void>;
  audio(): AsyncIterable<PartialAudio>;
  close(): Promise<void>;
}

export type ProviderName =
  | 'gpt-realtime-2'
  | 'elevenlabs-v3'
  | 'cartesia-sonic-2'
  | 'lelapa-vulavula'
  | 'spitch';

/** Configuration knobs shared by all start-session calls. */
export interface StartSessionOptions {
  readonly tenantId: string;
  readonly language: LanguageTag;
  /** Optional voice id / persona key the TTS provider should render. */
  readonly voiceId?: string;
}

export interface SttProvider {
  readonly name: ProviderName;
  startSession(options: StartSessionOptions): Promise<SttSessionHandle>;
}

export interface TtsProvider {
  readonly name: ProviderName;
  startSession(options: StartSessionOptions): Promise<TtsSessionHandle>;
}

/**
 * Some providers (gpt-realtime-2) handle both STT and TTS in a single duplex
 * session. We model that as a tagged union so the routers can return whichever
 * shape applies without forcing two parallel sessions on duplex providers.
 */
export interface DuplexSessionHandle {
  readonly sessionId: string;
  readonly provider: ProviderName;
  pushAudio(chunk: AudioChunk): Promise<void>;
  speak(text: string): Promise<void>;
  transcripts(): AsyncIterable<PartialTranscript>;
  audio(): AsyncIterable<PartialAudio>;
  close(): Promise<void>;
}
