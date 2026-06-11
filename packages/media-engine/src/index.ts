/**
 * @borjie/media-engine — public surface.
 *
 * A standalone media-generation ENGINE: a ProviderPort over IMAGE,
 * SHORT-VIDEO, and GIF providers; a registry with a zero-keys
 * deterministic stub default; real HTTP adapters behind injected config;
 * a prompt-safety gate; watermark + C2PA provenance stamping; an async
 * job model; a storage PORT for signed-URL delivery; and cost guards.
 *
 * Ports are exposed for later modality-arbiter wiring; the engine is NOT
 * wired into the brain here.
 *
 * @module @borjie/media-engine
 */

// Core types + errors.
export type {
  BorjieMediaKind,
  FetchLike,
  FetchResponseLike,
  MediaApprovalState,
  MediaArtifact,
  MediaAspectRatio,
  MediaCapability,
  MediaDomain,
  MediaEngineContext,
  MediaErrorCode,
  MediaFormat,
  MediaInput,
  MediaKindProfile,
  MediaLocale,
  MediaLogger,
  MediaModality,
  MediaProvenance,
  MediaProviderId,
  MediaRequest,
  MediaRequestKind,
  ProvenanceSigner,
  RealEstateMediaKind,
  WatermarkPlan,
} from './types.js';
export { MediaEngineError, NOOP_LOGGER } from './types.js';

// Kind catalogue.
export {
  MEDIA_KIND_PROFILES,
  allMediaKinds,
  profileForKind,
} from './kinds.js';

// Engine orchestrator.
export { createMediaEngine } from './engine.js';
export type {
  CreateMediaEngineOptions,
  MediaEngine,
} from './engine.js';

// Provider port + registry + stub.
export type {
  MediaProvider,
  ProviderInvocation,
  ProviderOutput,
} from './providers/port.js';
export { providerServes } from './providers/port.js';
export {
  createProviderRegistry,
} from './providers/registry.js';
export type { MediaProviderRegistry } from './providers/registry.js';
export { createStubProvider } from './providers/stub-provider.js';

// Real HTTP adapters (behind injected config).
export { createHttpProvider } from './providers/http-adapter.js';
export type {
  CostModel,
  HttpProviderSpec,
} from './providers/http-adapter.js';
export {
  createFluxProvider,
  createImagenProvider,
  createSeedreamProvider,
} from './providers/image-adapters.js';
export type { ImageAdapterConfig } from './providers/image-adapters.js';
export {
  createSeedanceProvider,
  createSoraProvider,
  createVeoProvider,
} from './providers/video-adapters.js';
export type { VideoAdapterConfig } from './providers/video-adapters.js';
export { createGifTranscoderProvider } from './providers/gif-adapter.js';
export type { GifAdapterConfig } from './providers/gif-adapter.js';

// Safety gate.
export { screenPrompt } from './safety/prompt-safety-gate.js';
export type {
  SafetyCategory,
  SafetyVerdict,
} from './safety/prompt-safety-gate.js';

// Provenance.
export {
  hashBytes,
  stampProvenance,
} from './provenance/provenance-stamp.js';
export type { StampInput } from './provenance/provenance-stamp.js';

// Cost guard.
export { createCostGuard } from './cost/cost-guard.js';
export type {
  CostGuard,
  CostReservation,
} from './cost/cost-guard.js';

// Storage PORT + in-memory adapter.
export {
  tenantScopedKey,
} from './storage/storage-port.js';
export type {
  MediaStoragePort,
  SignedDelivery,
  StoredObject,
} from './storage/storage-port.js';
export { createInMemoryStorage } from './storage/in-memory-storage.js';
export type {
  InMemoryStorage,
  InMemoryStorageOptions,
} from './storage/in-memory-storage.js';

// Async job model.
export { createInMemoryJobStore } from './job/async-job.js';
export type {
  JobStatus,
  MediaJob,
  MediaJobStore,
} from './job/async-job.js';

// Brand / locale labels.
export {
  promptPrefix,
  watermarkLabel,
} from './brand/brand-label.js';

// Modality-arbiter ports (exposed, NOT wired into the brain).
export { decideMediaModality } from './arbiter/modality-port.js';
export type {
  GenerateMediaDecision,
  MediaModalityPort,
  MediaQueuedAck,
} from './arbiter/modality-port.js';

// Read-only Drizzle refs for the EXISTING media tables (no migration).
export {
  MEDIA_APPROVAL_STATES,
  MEDIA_ARTIFACT_FORMATS,
  mediaArtifacts,
  mediaSafetyScans,
} from './persistence/media-schema.js';
export type {
  MediaArtifactInsert,
  MediaArtifactRow,
  MediaSafetyScanInsert,
  MediaSafetyScanRow,
} from './persistence/media-schema.js';
