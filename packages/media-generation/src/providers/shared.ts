/**
 * Shared provider helpers — pulled out so each provider adapter file
 * stays focused on its API contract.
 *
 * Common concerns: fetch with timeout, env-key resolution, artifact
 * assembly (checksum + provenance + audit hash in one step), brand-lock
 * application, cost-budget reservation, graceful degradation when env
 * keys are absent.
 *
 * @module @borjie/media-generation/providers/shared
 */

import { randomUUID } from 'node:crypto';
import { buildMediaAuditLink, sha256Hex } from '../audit/audit-chain-link.js';
import {
  buildBrandedPrompt,
  buildNegativePrompt,
} from '../brand-lock/prompt-prefix-builder.js';
import type {
  AdapterResult,
  ApprovalState,
  AuthorityTier,
  BrandSpec,
  MediaArtifact,
  MediaCapability,
  MediaClass,
  MediaFormat,
  MediaLogger,
  MediaProviderId,
  MediaProvenance,
  SafetyScanResult,
  SpanCitation,
} from '../types.js';
import { NOOP_LOGGER } from '../types.js';

// ---------------------------------------------------------------------------
// Env-key resolution — never throws; returns undefined when absent
// ===========================================================================

export function readEnvKey(name: string): string | undefined {
  // eslint-disable-next-line no-process-env -- adapter intentionally reads env
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return undefined;
  return raw.trim();
}

// ---------------------------------------------------------------------------
// Fetch with timeout + safe error envelope
// ===========================================================================

export interface SafeFetchOptions {
  readonly url: string;
  readonly init?: RequestInit;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface SafeFetchSuccess {
  readonly ok: true;
  readonly status: number;
  readonly bodyText: string;
}

export interface SafeFetchFailure {
  readonly ok: false;
  readonly status: number;
  readonly reason: 'timeout' | 'network' | 'http_error';
  readonly message: string;
}

export type SafeFetchResult = SafeFetchSuccess | SafeFetchFailure;

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch with timeout. Returns a discriminated union; never throws.
 * Adapters call this to keep failure modes uniform.
 */
export async function safeFetch(
  options: SafeFetchOptions,
): Promise<SafeFetchResult> {
  const f = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const init: RequestInit = {
      ...(options.init ?? {}),
      signal: controller.signal,
    };
    const res = await f(options.url, init);
    const bodyText = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        reason: 'http_error',
        message: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    return { ok: true, status: res.status, bodyText };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network';
    const message = err instanceof Error ? err.message : 'unknown error';
    return { ok: false, status: 0, reason, message };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

// ---------------------------------------------------------------------------
// Brand-lock application — shared `applyBrandLock` for every adapter
// ===========================================================================

export function applyBrandLock(prompt: string, brand: BrandSpec): string {
  return buildBrandedPrompt(brand, prompt);
}

export function negativePromptFor(brand: BrandSpec): string {
  return buildNegativePrompt(brand);
}

// ---------------------------------------------------------------------------
// Artifact assembly — every provider adapter calls this on success
// ===========================================================================

export interface AssembleArtifactArgs {
  readonly tenant_id: string;
  readonly recipe: {
    readonly id: string;
    readonly version: number;
    readonly class: MediaClass;
    readonly authority_tier: AuthorityTier;
    readonly approval_required: boolean;
  };
  readonly format: MediaFormat;
  readonly bytes: Buffer;
  readonly thumb_bytes?: Buffer;
  readonly provider_id: MediaProviderId;
  readonly model_id: string;
  readonly model_version: string;
  readonly prompt_text: string;
  readonly prompt_image_refs?: ReadonlyArray<string>;
  readonly seed: string;
  readonly safety_scan: SafetyScanResult;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly storage_bucket?: string;
  readonly generated_at: string;
}

export function assembleArtifact(args: AssembleArtifactArgs): MediaArtifact {
  const id = randomUUID();
  const checksum = sha256Hex(args.bytes);
  const provenance: MediaProvenance = Object.freeze({
    model_id: args.model_id,
    model_version: args.model_version,
    model_provider: args.provider_id,
    prompt_text: args.prompt_text,
    prompt_image_refs: args.prompt_image_refs ?? [],
    seed: args.seed,
    safety_scan: args.safety_scan,
    cost_usd_cents: args.cost_usd_cents,
    duration_ms: args.duration_ms,
  });

  const link = buildMediaAuditLink({
    tenant_id: args.tenant_id,
    recipe: {
      id: args.recipe.id,
      version: args.recipe.version,
      class: args.recipe.class,
      authority_tier: args.recipe.authority_tier,
    },
    format: args.format,
    checksum,
    provenance,
    span_citations: args.span_citations,
    generated_at: args.generated_at,
  });

  const storageBucket = args.storage_bucket ?? `borjie-media-${args.recipe.class}`;
  const extension = formatExtension(args.format);
  const storage_key = `${storageBucket}/${id}.${extension}`;
  const thumb_storage_key = `${storageBucket}/${id}.thumb.jpg`;

  const approval_state: ApprovalState = args.recipe.approval_required
    ? 'pending'
    : initialApprovalForTier(args.recipe.authority_tier);

  return {
    id,
    recipe_id: args.recipe.id,
    recipe_version: args.recipe.version,
    format: args.format,
    storage_key,
    thumb_storage_key,
    checksum,
    provenance,
    span_citations: args.span_citations,
    audit_hash: link.audit_hash,
    approval_state,
    body: args.bytes,
    generated_at: args.generated_at,
  };
}

export function initialApprovalForTier(tier: AuthorityTier): ApprovalState {
  return tier === 2 ? 'pending' : 'auto_published';
}

function formatExtension(format: MediaFormat): string {
  switch (format) {
    case 'image':
      return 'png';
    case 'short_video':
      return 'mp4';
    case 'lipsync_video':
      return 'mp4';
  }
}

// ---------------------------------------------------------------------------
// Empty / placeholder safety scan — overwritten by the safety pipeline
// ===========================================================================

export function permissiveSafetyScan(): SafetyScanResult {
  return {
    nsfw_probability: 0,
    deepfake_probability: 0,
    brand_violation_flags: [],
  };
}

// ---------------------------------------------------------------------------
// Logger fallback — never throws, prefers caller-supplied logger
// ===========================================================================

export function pickLogger(logger?: MediaLogger): MediaLogger {
  return logger ?? NOOP_LOGGER;
}

// ---------------------------------------------------------------------------
// Capability + cost adapter-meta sentinel
// ===========================================================================

export interface AdapterMeta {
  readonly capabilities: ReadonlyArray<MediaCapability>;
  readonly cost_per_unit_usd_cents: number;
}

/**
 * Wrap the adapter invocation in a budget-reserve + commit/release
 * pattern. Adapters call this so the failure handling is uniform.
 */
export interface BudgetGateArgs {
  readonly cost_tracker: import('../types.js').CostTracker;
  readonly estimated_cents: number;
  readonly logger: MediaLogger;
  readonly adapter: string;
}

export async function reserveBudget(args: BudgetGateArgs): Promise<boolean> {
  const ok = await args.cost_tracker.tryReserve(args.estimated_cents);
  if (!ok) {
    args.logger.warn(`${args.adapter}: budget exceeded, refusing call`);
  }
  return ok;
}

/**
 * Build a synthetic `null` adapter result with a logged reason. Used
 * when env keys are missing.
 */
export function noKey<T extends AdapterResult>(
  adapter: string,
  envKey: string,
  logger: MediaLogger,
): T {
  logger.warn(`${adapter}: ${envKey} missing, returning null (graceful degradation)`);
  return null as T;
}
