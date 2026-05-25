/**
 * Public types for @borjie/audio-logics-litfin.
 *
 * This package AUGMENTS `@borjie/audio-capture` (which already ships STT,
 * TTS, VAD, diarization, voice-clone, realtime). We add the LITFIN-parity
 * logics that audio-capture deliberately did not cover:
 *
 *   1. Audio fingerprinting (Shazam-style chromaprint)
 *   2. Voice biometrics (enrollment + verification + liveness)
 *   3. Compliance recording (per-jurisdiction consent + notice)
 *   4. Evidence chain-of-custody (C2PA-signed manifests)
 *   5. WhatsApp voice intake bridge (Meta Cloud API audio webhook)
 *   6. Emotion-based escalation triggers
 *   7. Waveform UI helpers (data-only, no React deps)
 *   8. Per-minute talk-time metering
 *   9. Audio quality scoring (PESQ-like)
 *
 * Provider-agnostic: every subsystem ships a deterministic reference
 * implementation plus an adapter port for production replacement
 * (ACRCloud, Amazon Voice ID, Pindrop, Hume EVI 3, …).
 */

// ---------------------------------------------------------------------------
// Audio primitive (mirrors audio-capture/AudioChunk for zero coupling)
// ---------------------------------------------------------------------------

/**
 * Sample rate values we explicitly support. 8 kHz narrowband (PSTN),
 * 16 kHz Whisper sweet spot, 24 kHz OpenAI Realtime, 48 kHz WebRTC default.
 */
export type SampleRateHz = 8000 | 16000 | 24000 | 44100 | 48000;

/**
 * Minimal audio frame the LITFIN logics operate on. Mirrors
 * `AudioChunk` in `@borjie/audio-capture` but is duplicated here so
 * this package has zero compile-time coupling — callers convert at the
 * edge with a one-line spread.
 */
export interface AudioSample {
  readonly bytes: Uint8Array;
  readonly format: 'pcm' | 'wav' | 'mp3' | 'opus' | 'ogg' | 'flac' | 'webm' | 'aac';
  readonly sampleRate: SampleRateHz;
  readonly channels: 1 | 2;
  readonly durationMs?: number;
}

// ---------------------------------------------------------------------------
// 1. Audio fingerprinting
// ---------------------------------------------------------------------------

/**
 * Deterministic content-derived fingerprint. Same audio bytes → same
 * fingerprint hash. Inspired by Shazam's chromaprint / AcoustID model.
 */
export interface AudioFingerprint {
  readonly hash: string; // hex
  readonly algorithm: 'chromaprint-stub' | 'chromaprint' | 'acoustid' | 'acrcloud';
  readonly durationMs: number;
  readonly sampleRate: SampleRateHz;
  /** 12-bin chroma vector × N frames, base64-encoded for storage. */
  readonly compactSignature: string;
  readonly createdAtIso: string;
}

export interface FingerprintMatchResult {
  readonly matched: boolean;
  readonly confidence: number; // 0..1
  readonly hammingDistance: number;
  readonly thresholdUsed: number;
}

// ---------------------------------------------------------------------------
// 2. Voice biometrics
// ---------------------------------------------------------------------------

export interface VoiceBiometricEnrollment {
  readonly enrollmentId: string;
  readonly userId: string;
  /** Hash of the concatenated voiceprint vectors — not the raw audio. */
  readonly voiceprintHash: string;
  /** Number of distinct samples averaged into the template. */
  readonly sampleCount: number;
  /** Threshold (0..1) below which verification REJECTS. */
  readonly verificationThreshold: number;
  readonly enrolledAtIso: string;
  readonly provider: 'mock' | 'amazon-connect-voice-id' | 'azure-speaker-recognition' | 'pindrop';
}

export interface VoiceVerificationResult {
  readonly matched: boolean;
  readonly score: number; // 0..1
  readonly thresholdUsed: number;
  readonly livenessCheck: LivenessCheckResult;
  readonly verifiedAtIso: string;
}

export interface LivenessCheckResult {
  /** Pass requires successful random-phrase repetition and no replay traits. */
  readonly passed: boolean;
  readonly checks: ReadonlyArray<{
    readonly name: 'random-phrase' | 'spectral-flatness' | 'silence-distribution';
    readonly passed: boolean;
    readonly detail?: string;
  }>;
}

// ---------------------------------------------------------------------------
// 3. Compliance recording
// ---------------------------------------------------------------------------

/**
 * ISO-3166-1 alpha-2 OR composite codes for sub-jurisdictions.
 * `US-1P` = US 1-party-consent states (default federal rule).
 * `US-2P` = US 2-party / all-party-consent states (CA, FL, IL, MD, MA, MI, MT, NV, NH, PA, WA).
 */
export type Jurisdiction =
  | 'TZ'
  | 'KE'
  | 'UG'
  | 'RW'
  | 'NG'
  | 'ZA'
  | 'EU'
  | 'GB'
  | 'US-1P'
  | 'US-2P';

export interface RecordingNoticeSpec {
  readonly jurisdiction: Jurisdiction;
  /** Text to read OR display before recording begins. */
  readonly noticeText: string;
  /** Whether the notice MUST be played audibly (vs displayed visually). */
  readonly mustBeAudible: boolean;
  /** Whether explicit affirmative consent is REQUIRED (vs implicit/notice-only). */
  readonly requiresExplicitConsent: boolean;
  /** Whether biometric voice data falls under a stricter regime (e.g., GDPR Art.9). */
  readonly biometricSpecialCategory: boolean;
  /** Citation URLs for the underlying statutes (for audit). */
  readonly statutoryCitations: ReadonlyArray<string>;
}

export interface ConsentRecord {
  readonly consentId: string;
  readonly tenantId: string;
  readonly callerId: string;
  readonly channel: 'phone' | 'whatsapp' | 'sms' | 'web-rtc' | 'in-person';
  readonly jurisdiction: Jurisdiction;
  /** ISO timestamp of the FIRST audible second of the recording. */
  readonly audioSampleStartIso: string;
  readonly consentGiven: boolean;
  readonly noticePlayed: boolean;
  /** Hash of the notice text shown / spoken — for non-repudiation. */
  readonly noticeHash: string;
  readonly capturedAtIso: string;
}

export interface ConsentVerification {
  readonly canStore: boolean;
  readonly mustDelete?: boolean;
  readonly reason?: string;
  readonly jurisdiction: Jurisdiction;
}

// ---------------------------------------------------------------------------
// 4. Evidence chain
// ---------------------------------------------------------------------------

export interface EvidenceClaim {
  readonly key: string;
  readonly value: string;
}

export interface AudioEvidenceManifest {
  readonly version: '1.0';
  readonly audioHash: string; // sha256 of original audio bytes
  readonly captureTimestampIso: string;
  readonly captureDeviceFingerprint: string;
  readonly tenantId: string;
  readonly transcriptionHash?: string;
  readonly consentId?: string;
  readonly claims: ReadonlyArray<EvidenceClaim>;
  readonly claimSignature: string; // hmac-sha256:<keyId>:<hex>
  readonly signedAtIso: string;
  readonly signerKeyId: string;
}

export interface EvidenceVerifyResult {
  readonly valid: boolean;
  readonly reason?:
    | 'missing-signature'
    | 'malformed-signature'
    | 'unknown-key'
    | 'manifest-tampered'
    | 'audio-tampered';
  readonly claims: ReadonlyArray<EvidenceClaim>;
  readonly signedBy?: string;
  readonly signedAtIso?: string;
}

// ---------------------------------------------------------------------------
// 5. WhatsApp voice intake
// ---------------------------------------------------------------------------

export interface WhatsAppVoiceMessage {
  readonly messageId: string;
  readonly waPhoneNumberE164: string;
  readonly mediaId: string;
  readonly mimeType: 'audio/ogg' | 'audio/opus' | 'audio/mp4' | 'audio/aac' | 'audio/amr';
  /** Auto-transcript Meta sometimes provides (Cloud API only). */
  readonly autoTranscript?: string;
  readonly receivedAtIso: string;
  readonly tenantId?: string;
}

// ---------------------------------------------------------------------------
// 6. Emotion escalation
// ---------------------------------------------------------------------------

export interface EmotionEvidence {
  readonly timestampMs: number;
  readonly emotion: 'anger' | 'distress' | 'sadness' | 'crying' | 'fear' | 'calm' | 'joy';
  readonly score: number; // 0..1
  readonly detail?: string;
}

export interface EmotionEscalation {
  readonly shouldEscalate: boolean;
  readonly urgency: 'low' | 'medium' | 'high' | 'critical';
  readonly primaryEmotion: EmotionEvidence['emotion'];
  readonly evidence: ReadonlyArray<EmotionEvidence>;
  /** Per-trigger reason codes for the escalation queue. */
  readonly triggers: ReadonlyArray<
    | 'anger-sustained'
    | 'distress-spike'
    | 'crying-detected'
    | 'profanity-burst'
    | 'fear-detected'
  >;
}

// ---------------------------------------------------------------------------
// 7. Waveform UI
// ---------------------------------------------------------------------------

export interface WaveformSpec {
  /** Peak amplitudes 0..1 — one entry per visual bucket. */
  readonly peaks: ReadonlyArray<number>;
  readonly bucketCount: number;
  readonly durationMs: number;
  readonly sampleRate: SampleRateHz;
}

export interface SpeakerTimelineSegment {
  readonly speakerId: string;
  readonly speakerLabel: string;
  readonly startMs: number;
  readonly endMs: number;
  /** Stable per-speaker color hex (e.g. `#3B82F6`). */
  readonly colorHex: string;
}

// ---------------------------------------------------------------------------
// 8. Talk-time metering
// ---------------------------------------------------------------------------

export interface TalkTimeReading {
  readonly tenantId: string;
  readonly tenantTalkSeconds: number;
  readonly agentTalkSeconds: number;
  readonly silenceSeconds: number;
  readonly totalSeconds: number;
  readonly periodStartIso: string;
  readonly periodEndIso: string;
}

export interface TalkTimeObservation {
  readonly tenantId: string;
  readonly agentId: string;
  readonly audioMs: number;
  readonly isSpeech: boolean;
  readonly speaker: 'tenant' | 'agent';
  readonly observedAtIso: string;
}

// ---------------------------------------------------------------------------
// 9. Audio summarization
// ---------------------------------------------------------------------------

export interface AudioSummary {
  readonly summaryText: string;
  readonly keyPoints: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<{
    readonly text: string;
    readonly startMs: number;
    readonly endMs: number;
  }>;
  readonly model: string;
  readonly generatedAtIso: string;
}

// ---------------------------------------------------------------------------
// 10. Quality scoring
// ---------------------------------------------------------------------------

export interface QualityScore {
  /** Composite 0..5 (POLQA-style MOS scale). */
  readonly mosLike: number;
  /** Signal-to-noise ratio in dB. */
  readonly snrDb: number;
  /** Fraction of samples clipped (0..1). */
  readonly clippingFraction: number;
  /** Effective bandwidth in Hz (16 kHz wideband, 8 kHz narrowband, etc.). */
  readonly bandwidthHz: number;
  /** Whether the audio is intelligible enough for evidence storage. */
  readonly acceptableForEvidence: boolean;
  readonly issues: ReadonlyArray<
    'low-snr' | 'heavy-clipping' | 'narrowband-only' | 'silent' | 'mono-channel-loss'
  >;
}

// ---------------------------------------------------------------------------
// Shared minimal brain port (for emotion-escalation + audio-summary)
// ---------------------------------------------------------------------------

export interface BrainAnalysisInput {
  readonly text: string;
  readonly audioMs?: number;
}

export interface LitfinBrainPort {
  /** Coarse emotion analysis fallback when no Hume-style adapter is wired. */
  readonly analyzeEmotion?: (
    input: BrainAnalysisInput,
  ) => Promise<ReadonlyArray<EmotionEvidence>>;
  /** Summarization fallback (e.g. Claude Citations). */
  readonly summarize?: (input: { transcriptText: string }) => Promise<AudioSummary>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AudioLogicsLitfinError extends Error {
  override readonly name = 'AudioLogicsLitfinError';
  readonly code: string;
  override readonly cause?: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}
