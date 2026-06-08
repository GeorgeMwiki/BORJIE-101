/**
 * @borjie/media-engine — core contracts.
 *
 * A standalone media-generation ENGINE. Pure types + ports; all I/O is
 * injected so the engine runs hermetically with zero API keys (the
 * default deterministic stub provider) and degrades-or-throws — never
 * fabricates — when a real provider is unconfigured.
 *
 * Everything here is immutable (`readonly` throughout) per coding-style.
 *
 * @module @borjie/media-engine/types
 */

// ---------------------------------------------------------------------------
// Modality — the three families this engine arbitrates over.
// ---------------------------------------------------------------------------

/**
 * Output modality. `image` = a single still; `short_video` = an MP4
 * clip (Sora-2 / Veo-3 / Seedance-2 class); `gif` = an animated
 * GIF/WebP (post-processed from a short video, no frontier "GIF model").
 */
export type MediaModality = 'image' | 'short_video' | 'gif';

/** Concrete output container per modality. */
export type MediaFormat = 'png' | 'jpeg' | 'webp' | 'mp4' | 'gif';

/** Aspect ratios the engine accepts (closed set; mirrors 0020 CHECK). */
export type MediaAspectRatio = '1:1' | '4:5' | '9:16' | '16:9' | '21:9';

// ---------------------------------------------------------------------------
// Typed media-request kinds — Borjie mining-estate AND BN real-estate.
// Closed-set discriminator so a new kind requires an explicit extension.
// ---------------------------------------------------------------------------

/** Borjie mining-estate request kinds. */
export type BorjieMediaKind =
  | 'mining_site_map'
  | 'equipment_process_diagram'
  | 'marketplace_listing_hero'
  | 'investor_brand_video';

/** BN real-estate request kinds. */
export type RealEstateMediaKind =
  | 'property_hero'
  | 'virtual_staging'
  | 'neighbourhood_reel';

/** Every typed media-request kind the engine understands. */
export type MediaRequestKind = BorjieMediaKind | RealEstateMediaKind;

/** Which product surface a kind belongs to. */
export type MediaDomain = 'mining_estate' | 'real_estate';

/**
 * Static profile for a request kind: which modality it produces, which
 * surface owns it, the default aspect ratio, and whether it is a
 * public-facing asset that always requires owner approval before
 * publication (authority tier 2).
 */
export interface MediaKindProfile {
  readonly kind: MediaRequestKind;
  readonly domain: MediaDomain;
  readonly modality: MediaModality;
  readonly defaultAspectRatio: MediaAspectRatio;
  /** True when the asset is public-facing and must be owner-approved. */
  readonly requiresApproval: boolean;
  /** Default clip length for video/gif kinds, in seconds. */
  readonly defaultDurationSec?: number;
}

// ---------------------------------------------------------------------------
// Provider identity + capability.
// ---------------------------------------------------------------------------

/**
 * Known provider ids. `stub` is the in-repo deterministic provider that
 * needs no keys. The rest are real HTTP adapters behind injected config.
 */
export type MediaProviderId =
  | 'stub'
  | 'imagen'
  | 'flux'
  | 'seedream'
  | 'sora'
  | 'veo'
  | 'seedance'
  | 'gif_transcoder';

/** A provider declares which modalities it can produce. */
export type MediaCapability = 'image' | 'short_video' | 'gif';

// ---------------------------------------------------------------------------
// Localisation — EN/SW absolute toggle (hard rail). Prompt prefixes and
// any owner-facing copy honour the active locale; never mixed.
// ---------------------------------------------------------------------------

export type MediaLocale = 'en' | 'sw';

// ---------------------------------------------------------------------------
// Request / context.
// ---------------------------------------------------------------------------

/** A single structured input fed to a recipe (key/value, immutable). */
export interface MediaInput {
  readonly key: string;
  readonly value: string;
}

/**
 * Caller-supplied request. The engine resolves `kind` → profile →
 * modality → provider via the registry. `prompt` is the human/agent
 * brief; `inputs` are structured facts (e.g. site coordinates, listing
 * price). `tenantId` is required for storage scoping + RLS-scoped
 * persistence by downstream adapters.
 */
export interface MediaRequest {
  readonly kind: MediaRequestKind;
  readonly tenantId: string;
  readonly prompt: string;
  readonly inputs: ReadonlyArray<MediaInput>;
  readonly locale: MediaLocale;
  /** Optional override; otherwise the kind's default is used. */
  readonly aspectRatio?: MediaAspectRatio;
  /** Optional override for video/gif length. */
  readonly durationSec?: number;
  /**
   * Evidence ids backing this request. Public-facing (tier-2) kinds are
   * rejected with an empty chain — evidence-required AI output hard rail.
   */
  readonly evidenceIds: ReadonlyArray<string>;
  /** Idempotency hint; if absent the engine derives a deterministic key. */
  readonly requestId?: string;
}

/**
 * Per-call context the host injects (never read from process.env here).
 * Keys, logger, clock, fetch, and cost budget all arrive through this
 * object so the engine stays pure and testable.
 */
export interface MediaEngineContext {
  /** Provider api-keys keyed by provider id. Absent ⇒ provider degrades. */
  readonly providerKeys: Readonly<Partial<Record<MediaProviderId, string>>>;
  /** Per-tenant remaining media budget, in integer cents. */
  readonly budgetCents: number;
  readonly logger: MediaLogger;
  /** Injected clock for deterministic tests. */
  readonly now: () => Date;
  /** Injected fetch for real HTTP adapters; absent in stub-only hosts. */
  readonly fetch?: FetchLike;
  /** Brand/provenance signing material, injected at bootstrap. */
  readonly provenanceSigner?: ProvenanceSigner;
}

/** Minimal fetch signature so we never depend on a concrete client. */
export type FetchLike = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

// ---------------------------------------------------------------------------
// Logger — Pino-shaped (no console in services). NOOP for tests.
// ---------------------------------------------------------------------------

export interface MediaLogger {
  info(obj: Readonly<Record<string, unknown>>, msg?: string): void;
  warn(obj: Readonly<Record<string, unknown>>, msg?: string): void;
  error(obj: Readonly<Record<string, unknown>>, msg?: string): void;
}

export const NOOP_LOGGER: MediaLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

// ---------------------------------------------------------------------------
// Provenance.
// ---------------------------------------------------------------------------

/**
 * Provenance stamp attached to every produced artifact: a visible
 * watermark plan, a C2PA-style manifest digest (hard binding), and a
 * SynthID-present flag for providers that embed it (Veo / Imagen class).
 */
export interface MediaProvenance {
  /** sha256 of the bytes the manifest is bound to. */
  readonly contentHash: string;
  /** C2PA-style manifest digest (COSE/X.509 done by an injected signer). */
  readonly manifestDigest: string;
  /** Visible-watermark plan (executed by a host-side renderer). */
  readonly watermark: WatermarkPlan;
  /** True when the provider embeds an invisible SynthID watermark. */
  readonly synthIdPresent: boolean;
  /** Signer identity (e.g. brand cert subject) or 'unsigned' stub. */
  readonly signer: string;
  /** ISO timestamp the stamp was produced. */
  readonly stampedAt: string;
}

/** Visible watermark plan — host renders it with sharp/ffmpeg. */
export interface WatermarkPlan {
  readonly text: string;
  readonly position: 'bottom_right' | 'bottom_left' | 'top_right' | 'top_left';
  readonly opacity: number;
}

/**
 * Injected provenance signer. The host supplies real COSE/X.509 signing
 * at bootstrap; when absent the engine falls back to an unsigned digest
 * stamp (clearly marked) rather than fabricating a signature.
 */
export interface ProvenanceSigner {
  readonly subject: string;
  /** Sign a manifest payload, returning an opaque signature digest. */
  sign(payload: string): string;
}

// ---------------------------------------------------------------------------
// Artifact + result.
// ---------------------------------------------------------------------------

export type MediaApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'auto_published';

/**
 * The produced artifact. `body` are the real bytes; downstream adapters
 * upload them and persist a `media_artifacts` row. The engine itself
 * never binds to a bucket — delivery is via the storage PORT.
 */
export interface MediaArtifact {
  readonly id: string;
  readonly kind: MediaRequestKind;
  readonly modality: MediaModality;
  readonly format: MediaFormat;
  readonly aspectRatio: MediaAspectRatio;
  readonly body: Uint8Array;
  readonly byteLength: number;
  readonly providerId: MediaProviderId;
  readonly provenance: MediaProvenance;
  readonly approvalState: MediaApprovalState;
  readonly costCents: number;
  readonly evidenceIds: ReadonlyArray<string>;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Errors — typed, so callers branch on `code` not message strings.
// ---------------------------------------------------------------------------

export type MediaErrorCode =
  | 'unknown_kind'
  | 'no_provider'
  | 'provider_unconfigured'
  | 'provider_failed'
  | 'safety_blocked'
  | 'budget_exceeded'
  | 'evidence_required'
  | 'invalid_request';

export class MediaEngineError extends Error {
  readonly code: MediaErrorCode;
  override readonly cause: unknown;
  constructor(code: MediaErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MediaEngineError';
    this.code = code;
    this.cause = cause;
  }
}
