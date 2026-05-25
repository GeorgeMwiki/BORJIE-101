/**
 * VoiceAudioPort — abstract port over a browser-native audio I/O surface.
 *
 * The shape is intentionally minimal so the kernel persona system stays
 * the source of truth for *what* gets said; this layer just handles
 * *how* the user hears it and how their voice becomes text.
 *
 * Implementations in this package:
 *   - `createWebSpeechAudioPort` (Web Speech API, browser-only, no key)
 *
 * Other adapters (Whisper, Deepgram, Cartesia, ElevenLabs) can be added
 * later by another team without touching call sites.
 */

export interface SpeechToTextResult {
  /** The recognised text. May be partial when `isFinal=false`. */
  readonly transcript: string;
  /** True only on the last result for the current utterance. */
  readonly isFinal: boolean;
  /** 0..1 confidence (browser-supplied; 0 if unknown). */
  readonly confidence: number;
}

export interface SpeakOptions {
  /** Aborting the signal cancels in-flight playback (rejects the promise). */
  readonly signal?: AbortSignal;
  /** Voice id (matches `voices()[i].id`). Falls back to system default. */
  readonly voice?: string;
  /** 0..2 — speech pitch. 1 = neutral. */
  readonly pitch?: number;
  /** 0.1..10 — speech rate. 1 = normal. */
  readonly rate?: number;
}

export interface VoiceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly lang: string;
  readonly default: boolean;
}

export interface ListeningHandle {
  /** Stop the current listening session. Idempotent. */
  stop(): void;
}

export interface VoiceAudioPort {
  /** True when speech-to-text is available in this environment. */
  readonly sttSupported: boolean;
  /** True when text-to-speech is available in this environment. */
  readonly ttsSupported: boolean;
  /**
   * Begin a single utterance recording. The callback fires with interim
   * + final results as the browser produces them. Returns a handle whose
   * `stop()` ends the session. Throws if `sttSupported=false`.
   */
  startListening(onResult: (r: SpeechToTextResult) => void): ListeningHandle;
  /**
   * Speak the given text. Resolves when playback finishes.
   * Cancellable via `opts.signal` (AbortSignal) or `cancelSpeech()`.
   */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /** Stop any currently-playing speech immediately. */
  cancelSpeech(): void;
  /**
   * Return the list of available system voices. Some browsers populate
   * voices asynchronously, so this returns a Promise.
   */
  voices(): Promise<ReadonlyArray<VoiceDescriptor>>;
}
