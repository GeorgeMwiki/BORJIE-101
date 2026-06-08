/**
 * Media engine orchestrator — `createMediaEngine`.
 *
 * Ties the parts together into one `generate(request, context)`:
 *   1. validate the request (zod) + resolve the kind profile,
 *   2. enforce the evidence-required rail for tier-2 (public) kinds,
 *   3. run the prompt-safety gate (block ⇒ `safety_blocked`),
 *   4. select a provider from the registry given which keys are present,
 *   5. reserve estimated cost in the cost guard (cap ⇒ `budget_exceeded`),
 *   6. invoke the provider for REAL bytes (degrade to stub on
 *      `provider_unconfigured`/`provider_failed` via the ladder),
 *   7. stamp provenance (watermark + C2PA digest + SynthID flag),
 *   8. commit cost + return an immutable {@link MediaArtifact}.
 *
 * No process.env reads, no network of its own, no bucket binding — all
 * I/O is injected. The brain is NOT wired here; the engine only exposes
 * ports (see ./arbiter/*) for a future modality arbiter.
 *
 * @module @borjie/media-engine/engine
 */

import { z } from 'zod';
import { promptPrefix, watermarkLabel } from './brand/brand-label.js';
import { createCostGuard } from './cost/cost-guard.js';
import { profileForKind } from './kinds.js';
import type {
  MediaProviderRegistry,
} from './providers/registry.js';
import { createProviderRegistry } from './providers/registry.js';
import type {
  MediaProvider,
  ProviderInvocation,
  ProviderOutput,
} from './providers/port.js';
import { screenPrompt } from './safety/prompt-safety-gate.js';
import { stampProvenance } from './provenance/provenance-stamp.js';
import {
  MediaEngineError,
} from './types.js';
import type {
  MediaArtifact,
  MediaAspectRatio,
  MediaEngineContext,
  MediaKindProfile,
  MediaProviderId,
  MediaRequest,
} from './types.js';

const MediaRequestSchema = z.object({
  kind: z.string().min(1),
  tenantId: z.string().min(1),
  prompt: z.string().min(1).max(4000),
  inputs: z.array(z.object({ key: z.string(), value: z.string() })),
  locale: z.enum(['en', 'sw']),
  aspectRatio: z
    .enum(['1:1', '4:5', '9:16', '16:9', '21:9'])
    .optional(),
  durationSec: z.number().int().positive().max(60).optional(),
  evidenceIds: z.array(z.string()),
  requestId: z.string().optional(),
});

export interface MediaEngine {
  /** The provider registry (host registers real adapters here). */
  readonly registry: MediaProviderRegistry;
  /** Generate one artifact. Throws a typed {@link MediaEngineError}. */
  generate(
    request: MediaRequest,
    context: MediaEngineContext,
  ): Promise<MediaArtifact>;
}

export interface CreateMediaEngineOptions {
  /** Pre-built registry; defaults to a stub-only registry. */
  readonly registry?: MediaProviderRegistry;
  /** Signed-URL TTL passed to the host's delivery layer (seconds). */
  readonly signedUrlTtlSeconds?: number;
}

/** Derive the set of provider ids that have a key present. */
function keyedProviderIds(
  context: MediaEngineContext,
): ReadonlySet<MediaProviderId> {
  const ids = new Set<MediaProviderId>();
  for (const [id, key] of Object.entries(context.providerKeys)) {
    if (key) ids.add(id as MediaProviderId);
  }
  return ids;
}

function resolveAspectRatio(
  request: MediaRequest,
  profile: MediaKindProfile,
): MediaAspectRatio {
  return request.aspectRatio ?? profile.defaultAspectRatio;
}

function resolveDuration(
  request: MediaRequest,
  profile: MediaKindProfile,
): number {
  return request.durationSec ?? profile.defaultDurationSec ?? 0;
}

function deriveRequestId(request: MediaRequest): string {
  return (
    request.requestId ??
    `${request.tenantId}:${request.kind}:${request.prompt.length}`
  );
}

/**
 * Try the selected provider, then fall back down the registry ladder
 * (ultimately the never-fails stub) on `provider_unconfigured` /
 * `provider_failed`. Never fabricates: the stub emits real bytes.
 */
async function invokeWithFallback(
  primary: MediaProvider,
  invocation: ProviderInvocation,
  registry: MediaProviderRegistry,
): Promise<{ output: ProviderOutput; provider: MediaProvider }> {
  try {
    const output = await primary.generate(invocation);
    if (output.body.byteLength === 0) {
      throw new MediaEngineError('provider_failed', 'provider returned 0 bytes');
    }
    return { output, provider: primary };
  } catch (error) {
    const stub = registry.get('stub');
    if (!stub || primary.id === 'stub') throw error;
    invocation.logger.warn(
      { provider: primary.id, fallbackTo: 'stub' },
      'media-engine provider failed; falling back to stub',
    );
    const output = await stub.generate(invocation);
    return { output, provider: stub };
  }
}

export function createMediaEngine(
  options: CreateMediaEngineOptions = {},
): MediaEngine {
  const registry = options.registry ?? createProviderRegistry();

  const generate = async (
    rawRequest: MediaRequest,
    context: MediaEngineContext,
  ): Promise<MediaArtifact> => {
    const parsed = MediaRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      throw new MediaEngineError(
        'invalid_request',
        `invalid media request: ${parsed.error.message}`,
      );
    }
    const request = rawRequest;

    const profile = profileForKind(request.kind);
    if (!profile) {
      throw new MediaEngineError(
        'unknown_kind',
        `unknown media kind: ${request.kind}`,
      );
    }

    // Evidence-required rail: public/tier-2 kinds need a non-empty chain.
    if (profile.requiresApproval && request.evidenceIds.length === 0) {
      throw new MediaEngineError(
        'evidence_required',
        `kind '${request.kind}' is public-facing and requires >=1 evidence id`,
      );
    }

    // Prompt-safety gate.
    const verdict = screenPrompt(request.prompt);
    if (!verdict.allowed) {
      context.logger.warn(
        { kind: request.kind, categories: verdict.matched },
        'media-engine prompt blocked by safety gate',
      );
      throw new MediaEngineError(
        'safety_blocked',
        `prompt blocked by safety gate: ${verdict.matched.join(', ')}`,
      );
    }

    const aspectRatio = resolveAspectRatio(request, profile);
    const durationSec = resolveDuration(request, profile);
    const keyed = keyedProviderIds(context);
    const provider = registry.select(profile.modality, keyed);

    // Cost guard — reserve BEFORE invocation so over-budget never fires.
    const estimate = provider.estimateCostCents(profile.modality, durationSec);
    const guard = createCostGuard(context.budgetCents);
    const reservationId = deriveRequestId(request);
    const reservation = guard.reserve(estimate, reservationId);

    const localePrefix = promptPrefix(profile.domain, request.locale);
    const invocation: ProviderInvocation = {
      modality: profile.modality,
      prompt: `${localePrefix}${request.prompt}`,
      aspectRatio,
      durationSec,
      ...(keyed.has(provider.id)
        ? { apiKey: context.providerKeys[provider.id] }
        : {}),
      ...(context.fetch ? { fetch: context.fetch } : {}),
      logger: context.logger,
      seed: reservationId,
    };

    let result;
    try {
      result = await invokeWithFallback(provider, invocation, registry);
    } catch (error) {
      guard.release(reservation);
      if (error instanceof MediaEngineError) throw error;
      throw new MediaEngineError(
        'provider_failed',
        'media generation failed',
        error,
      );
    }

    // The provider that actually produced bytes determines real cost.
    const actualProvider = result.provider;
    const actualCost = actualProvider.estimateCostCents(
      profile.modality,
      durationSec,
    );
    guard.commit(reservation);

    const stampedAt = context.now().toISOString();
    const provenance = stampProvenance({
      kind: request.kind,
      body: result.output.body,
      synthIdPresent: result.output.synthIdPresent,
      watermarkLabel: watermarkLabel(profile.domain, request.locale),
      stampedAt,
      ...(context.provenanceSigner
        ? { signer: context.provenanceSigner }
        : {}),
    });

    const artifact: MediaArtifact = {
      id: `${reservationId}:${provenance.contentHash.slice(0, 12)}`,
      kind: request.kind,
      modality: profile.modality,
      format: result.output.format,
      aspectRatio,
      body: result.output.body,
      byteLength: result.output.body.byteLength,
      providerId: actualProvider.id,
      provenance,
      approvalState: profile.requiresApproval ? 'pending' : 'auto_published',
      costCents: actualCost,
      evidenceIds: request.evidenceIds,
      createdAt: stampedAt,
    };
    return artifact;
  };

  return { registry, generate };
}
