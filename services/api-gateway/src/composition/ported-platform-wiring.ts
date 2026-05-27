/**
 * Borjie ported-platform composition helper (Batch 3).
 *
 * Structure inherited from a pre-fork lineage; evolved independently as
 * part of Borjie.
 *
 * Wires 5 platform-domain packages onto `ServiceRegistry`:
 *
 *   - `@borjie/security-hardening`: WebAuthn + TOTP + headers +
 *     rate-limit + anomaly + credential-stuffing detector + HIBP.
 *     Pre-wired via `createSecurityHardening({ headersEnv })` — the
 *     headers env is bound to NODE_ENV. WebAuthn + HIBP are NOT
 *     auto-constructed because they need an injected adapter
 *     (`@simplewebauthn/server` shim or `fetch` shim) that the caller
 *     is best placed to wire; the namespace export exposes them for
 *     follow-up wirings.
 *
 *   - `@borjie/document-ai`: 5 OCR adapters + chat-with-doc +
 *     form extraction + multilingual + e-signature + accessibility.
 *     Pre-wired via `createDocumentAI()` (mock OCR + mock e-sig as
 *     ports-default). Production swap: pass Anthropic / DocuSign
 *     ports via `createDocumentAI({ brain, eSignature, ocr })`.
 *
 *   - `@borjie/progressive-intelligence`: entity resolution +
 *     active learning + live coaching + streaming + profile
 *     unification + personalization. Pre-wired via
 *     `createProgressiveIntelligence()` with deterministic mock
 *     embedder (no brain — coaching / streaming endpoints stay
 *     dormant until a brain port is bound).
 *
 *   - `@borjie/document-quality-guarantor`: multi-engine
 *     fallback + 7 quality gates + retry queue + escalation +
 *     audit-chain. The full facade requires intake / output
 *     orchestrators that need per-tenant brain ports; we expose
 *     the namespace + a pre-wired in-memory audit chain so
 *     consumers can call `replayOperation` without re-instantiation.
 *     Per-tenant guarantor instantiation happens at request time.
 *
 *   - `@borjie/audio-capture`: STT + TTS + VAD + diarization +
 *     enhancement + voice-clone + realtime. Pre-wired via
 *     `createAudioCapture()` with no ports — every adapter slot is
 *     null until provider creds land; consumers gate on
 *     `audioCapture.stt !== null` before calling `startRealtimeSession`.
 */

import * as SecurityHardeningNs from '@borjie/security-hardening';
import * as DocumentAINs from '@borjie/document-ai';
import * as ProgressiveIntelligenceNs from '@borjie/progressive-intelligence';
import * as DocumentQualityGuarantorNs from '@borjie/document-quality-guarantor';
import * as AudioCaptureNs from '@borjie/audio-capture';
import {
  createSecurityHardening,
  type SecurityHardening,
  type SecurityHeaderEnv,
} from '@borjie/security-hardening';
import { createDocumentAI, type DocumentAI } from '@borjie/document-ai';
import {
  createProgressiveIntelligence,
  createDeterministicMockEmbedder,
  type ProgressiveIntelligence,
} from '@borjie/progressive-intelligence';
import {
  createInMemoryAuditChainStore,
  type AuditChainStore,
} from '@borjie/document-quality-guarantor';
import { createAudioCapture, type AudioCapture } from '@borjie/audio-capture';

export interface PortedPlatformBundle {
  /** WebAuthn + TOTP + headers + rate-limit + anomaly namespace. */
  readonly securityHardening: typeof SecurityHardeningNs;
  /** Document AI namespace (OCR + chat-with-doc + form extraction + e-sig). */
  readonly documentAI: typeof DocumentAINs;
  /** Progressive Intelligence namespace (entity res + active learning + coach). */
  readonly progressiveIntelligence: typeof ProgressiveIntelligenceNs;
  /** Document Quality Guarantor namespace (gates + retry + escalation + audit). */
  readonly documentQualityGuarantor: typeof DocumentQualityGuarantorNs;
  /** Audio capture namespace (STT/TTS/VAD/diarization/voice-clone/realtime). */
  readonly audioCapture: typeof AudioCaptureNs;

  /**
   * Pre-wired security hardening facade. `headersEnv` is bound to
   * NODE_ENV so middleware is environment-aware out of the box.
   * Default rate limiter omitted (per-route limits land in the
   * Hono middleware composition root). WebAuthn + HIBP are NOT
   * auto-constructed — bind them via the namespace export when the
   * `@simplewebauthn/server` shim + `fetch` shim are wired.
   */
  readonly securityHardeningInstance: SecurityHardening;

  /** Pre-wired Document AI facade with mock OCR + mock e-sig. Swap
   *  by passing concrete ports at composition time. */
  readonly documentAIInstance: DocumentAI;

  /** Pre-wired Progressive Intelligence facade with deterministic
   *  mock embedder (no brain — gates that need a brain return
   *  dormant results until a brain port is bound). */
  readonly progressiveIntelligenceInstance: ProgressiveIntelligence;

  /** Pre-wired in-memory audit chain store for DQG.replayAudit
   *  callers. Per-tenant guarantor facades are instantiated at
   *  request time because intake/output orchestrators bind to
   *  per-tenant brain + format-registry ports. */
  readonly dqgAuditStore: AuditChainStore;

  /** Pre-wired Audio Capture facade with no ports — every adapter
   *  slot is null until provider creds (Deepgram / ElevenLabs /
   *  OpenAI Whisper) land. Consumers gate on
   *  `audioCaptureInstance.stt !== null` before calling
   *  `startRealtimeSession`. */
  readonly audioCaptureInstance: AudioCapture;
}

/**
 * Pick the security headers env from NODE_ENV. Defaults to
 * `development` so local dev doesn't accidentally inherit prod CSP.
 */
function resolveSecurityHeadersEnv(): SecurityHeaderEnv {
  const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  if (env === 'production' || env === 'prod') return 'production';
  if (env === 'staging' || env === 'stage') return 'staging';
  return 'development';
}

/**
 * Build the ported-platform bundle. Always non-null in both degraded
 * and live modes; all 5 facades have safe in-memory / mock-port
 * defaults so the gateway boots without external creds.
 */
export function createPortedPlatformBundle(): PortedPlatformBundle {
  return Object.freeze({
    securityHardening: SecurityHardeningNs,
    documentAI: DocumentAINs,
    progressiveIntelligence: ProgressiveIntelligenceNs,
    documentQualityGuarantor: DocumentQualityGuarantorNs,
    audioCapture: AudioCaptureNs,
    securityHardeningInstance: createSecurityHardening({
      headersEnv: resolveSecurityHeadersEnv(),
    }),
    documentAIInstance: createDocumentAI(),
    progressiveIntelligenceInstance: createProgressiveIntelligence({
      embedder: createDeterministicMockEmbedder(),
    }),
    dqgAuditStore: createInMemoryAuditChainStore(),
    audioCaptureInstance: createAudioCapture(),
  });
}
