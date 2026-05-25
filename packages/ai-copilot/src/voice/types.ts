/**
 * Voice AI shared types (Wave 11).
 *
 * Ported from LitFin's voice stack. BORJIE uses voice for:
 *   - Live classroom / Professor sub-persona tutoring
 *   - Tenant call workflows (arrears collection, scheduling)
 *   - Staff training sessions
 *
 * Supports English and Swahili. Kept provider-agnostic — implementations
 * live in `elevenlabs-provider.ts` and `openai-voice-provider.ts`.
 */

export type VoiceLanguage = 'en' | 'sw' | 'mixed';

export interface VoiceProviderTenantContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly sessionId?: string;
  readonly correlationId?: string;
}

export interface TranscribeRequest {
  readonly audio: Uint8Array | ArrayBuffer;
  readonly mimeType?: string; // e.g. 'audio/mpeg', 'audio/wav', 'audio/webm'
  readonly language: VoiceLanguage;
  readonly diarize?: boolean;
  readonly prompt?: string; // Biasing prompt ("property management, arrears…")
}

export interface TranscribeResponse {
  readonly text: string;
  readonly language: VoiceLanguage;
  readonly durationSec: number;
  readonly providerId: string;
  readonly model: string;
}

export interface SynthesizeRequest {
  readonly text: string;
  readonly language: VoiceLanguage;
  /** Voice ID (provider-specific). */
  readonly voiceId?: string;
  /** Output format, e.g. 'mp3_44100_128'. */
  readonly format?: string;
  readonly stability?: number; // 0-1
  readonly similarityBoost?: number; // 0-1
}

export interface SynthesizeResponse {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly providerId: string;
  readonly model: string;
  readonly voiceId: string;
}

export interface VoiceProviderError {
  readonly code:
    | 'PROVIDER_ERROR'
    | 'RATE_LIMIT'
    | 'INVALID_AUDIO'
    | 'TIMEOUT'
    | 'UNSUPPORTED_LANGUAGE'
    | 'MISSING_KEY';
  readonly message: string;
  readonly provider: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}

export type VoiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: VoiceProviderError };

export function vOk<T>(data: T): VoiceResult<T> {
  return { success: true, data };
}
export function vErr<T = never>(error: VoiceProviderError): VoiceResult<T> {
  return { success: false, error };
}

/** Common interface every voice provider implements. */
export interface VoiceProvider {
  readonly providerId: string;
  readonly supportedLanguages: readonly VoiceLanguage[];
  transcribe(
    request: TranscribeRequest
  ): Promise<VoiceResult<TranscribeResponse>>;
  synthesize(
    request: SynthesizeRequest
  ): Promise<VoiceResult<SynthesizeResponse>>;
  supportsLanguage(lang: VoiceLanguage): boolean;
  healthCheck(): Promise<boolean>;
}
