/**
 * Shared helpers for recipe modules. Keeps each recipe file focused on
 * its subject specification rather than on plumbing.
 *
 * Common concerns: subject prompt assembly, dispatcher call, brand
 * scan, watermark embed, audit-chain link. Each seed recipe pulls a
 * subset of these helpers; the dynamic recipe author (Wave 18M) will
 * reuse the same surface.
 *
 * @module @borjie/media-generation/recipes/_helpers
 */

import type {
  BrandSpec,
  MediaArtifact,
  MediaCapability,
  MediaComposeContext,
  MediaProviderAdapter,
  MediaProviderInput,
  MediaRecipe,
  ProviderContext,
  SafetyScanResult,
} from '../types.js';
import { MediaCompositionError } from '../types.js';
import {
  dispatchToProvider,
  reorderForCapabilityAndCost,
} from '../providers/dispatcher.js';
import { scanBrandViolation } from '../safety/brand-violation-scanner.js';
import { scanForNsfw } from '../safety/nsfw-scanner.js';
import { detectDeepfake } from '../safety/deepfake-detector.js';
import { applyContentRatingGate } from '../safety/content-rating-gate.js';
import {
  buildC2paManifest,
  embedC2paManifest,
} from '../watermark/c2pa-embedder.js';
import {
  planVisibleWatermark,
  type VisibleWatermarkPlan,
} from '../watermark/visible-watermark.js';
import { getBrandSpec } from '../brand-lock/brand-spec.js';
import { createClassBudgetTracker } from '../budgets/cost-tracker.js';
import { buildMediaAuditLink } from '../audit/audit-chain-link.js';

export interface RunRecipeArgs {
  readonly recipe: MediaRecipe;
  readonly ctx: MediaComposeContext;
  readonly capability: MediaCapability;
  readonly subject_prompt: string;
  readonly adapters: ReadonlyArray<
    MediaProviderAdapter<MediaProviderInput, MediaArtifact>
  >;
  readonly expect_wordmark: boolean;
}

/**
 * Execute the full Layer 1-2-3-4 pipeline for a recipe. Mirrors the
 * document-templates `buildArtifactFromIRDoc` shape:
 *   1. Validate inputs + consent.
 *   2. Dispatch to provider with fallback path.
 *   3. Run safety scans (NSFW + deepfake + brand violation).
 *   4. Embed C2PA + (caller decides on visible watermark separately).
 *   5. Re-seal audit hash with safety-scan results bundled in.
 *
 * Returns a fully assembled `MediaArtifact`.
 */
export async function runRecipe(args: RunRecipeArgs): Promise<MediaArtifact> {
  assertRequiredInputs(args.recipe, args.ctx);
  assertConsent(args.recipe, args.ctx);

  const brand: BrandSpec = args.ctx.brand_spec ?? getBrandSpec(args.ctx.tenant_id);
  const providerCtx: ProviderContext = {
    tenant_id: args.ctx.tenant_id,
    recipe_id: args.recipe.id,
    recipe_version: args.recipe.version,
    brand_spec: brand,
    cost_tracker: createClassBudgetTracker(args.recipe.class),
    ...(args.ctx.generated_at ? { seed: args.ctx.generated_at } : {}),
  };

  const input: MediaProviderInput = {
    prompt: args.subject_prompt,
    aspect_ratio: args.recipe.target_aspect_ratio,
    ...(args.recipe.target_duration_sec !== undefined
      ? { duration_sec: args.recipe.target_duration_sec }
      : {}),
    format: args.recipe.output_format,
  };

  // Caveat 4 — cost-aware fallback ladder. Capability-eligible
  // adapters get reordered so the cheapest provider that fits the
  // remaining class budget is tried first; over-budget providers are
  // dropped (they would fail the cost-tracker reservation anyway).
  // Canonical capability order acts as the tiebreaker for equal-cost
  // picks so quality preferences are preserved.
  const remaining_budget_cents =
    providerCtx.cost_tracker.budget() -
    (await providerCtx.cost_tracker.spent());
  const ordered = reorderForCapabilityAndCost(
    args.capability,
    args.adapters,
    remaining_budget_cents,
  );
  const { artifact } = await dispatchToProvider({
    capability: args.capability,
    input,
    ctx: providerCtx,
    adapters: ordered,
  });

  const safety = await runSafetyPipeline({
    artifact,
    brand,
    expect_wordmark: args.expect_wordmark,
    recipe_id: args.recipe.id,
  });

  // Caveat 3 — apply the tenant content-rating gate. Generated
  // artefacts whose safety scan exceeds the tenant ceiling are refused
  // regardless of recipe authority tier. The default policy is strict
  // SFW (matches the Borjie MD persona).
  const gate = applyContentRatingGate({
    tenant_id: args.ctx.tenant_id,
    safety_scan: safety,
  });
  if (!gate.ok) {
    throw new MediaCompositionError(
      'SAFETY_REFUSED',
      `content-rating gate refused: ${gate.violations.length} violation(s)`,
      gate.violations,
    );
  }

  // Re-build provenance with the actual safety_scan result.
  const sealedProvenance = {
    ...artifact.provenance,
    safety_scan: safety,
  };

  // Embed the C2PA manifest into the artifact bytes. The manifest is
  // tenant-scoped so regulators can verify provenance against the
  // tenant id (Caveat 1 — tenant-scoped C2PA provenance).
  const manifest = buildC2paManifest({
    recipe_id: args.recipe.id,
    recipe_version: args.recipe.version,
    audit_hash: artifact.audit_hash,
    checksum: artifact.checksum,
    provenance: sealedProvenance,
    generated_at: artifact.generated_at,
    tenant_id: args.ctx.tenant_id,
    brand: brand.brand,
  });
  const bytesWithC2pa = embedC2paManifest({
    bytes: artifact.body,
    manifest,
  });

  // Plan the visible watermark for public-facing variants — Tier-2
  // recipes ALWAYS get the wordmark composited; Tier-0/1 recipes get
  // the plan attached so the caller can render it when promoting to a
  // public surface. Pure planner — actual sharp/ffmpeg invocation
  // lives in the production worker (Caveat 1 — visible watermark
  // wired into the pipeline).
  const visibleWatermarkPlan = args.expect_wordmark
    ? planVisibleWatermark({ format: artifact.format, brand })
    : null;

  // Re-seal the audit hash with the safety-scan result baked in.
  const resealed = buildMediaAuditLink({
    tenant_id: args.ctx.tenant_id,
    recipe: {
      id: args.recipe.id,
      version: args.recipe.version,
      class: args.recipe.class,
      authority_tier: args.recipe.authority_tier,
    },
    format: artifact.format,
    checksum: artifact.checksum,
    provenance: sealedProvenance,
    span_citations: artifact.span_citations,
    generated_at: artifact.generated_at,
  });

  const final: MediaArtifact = {
    ...artifact,
    provenance: sealedProvenance,
    body: bytesWithC2pa,
    audit_hash: resealed.audit_hash,
  };

  // Attach the watermark plan + tenant id via a non-enumerable
  // backchannel so the artifact stays MediaArtifact-shaped (no schema
  // drift) but the caller can still read the plan for rendering.
  if (visibleWatermarkPlan) {
    Object.defineProperty(final, '__visibleWatermarkPlan', {
      value: visibleWatermarkPlan,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return final;
}

/**
 * Read the visible-watermark plan attached to an artifact by
 * `runRecipe`. Returns null when the recipe did not request the
 * wordmark (e.g. internal sketches). Public so callers don't have to
 * touch the non-enumerable backchannel directly.
 */
export function readVisibleWatermarkPlan(
  artifact: MediaArtifact,
): VisibleWatermarkPlan | null {
  const v = (artifact as unknown as { readonly __visibleWatermarkPlan?: VisibleWatermarkPlan })
    .__visibleWatermarkPlan;
  return v ?? null;
}

function assertRequiredInputs(
  recipe: MediaRecipe,
  ctx: MediaComposeContext,
): void {
  const available = new Set(ctx.available_data.map((d) => d.key));
  const missing = recipe.required_prompt_inputs
    .filter((i) => i.required)
    .filter((i) => !available.has(i.key))
    .map((i) => i.key);
  if (missing.length > 0) {
    throw new MediaCompositionError(
      'INPUT_GAP',
      `composer refused: ${missing.length} required prompt input(s) missing`,
      missing,
    );
  }
}

function assertConsent(recipe: MediaRecipe, ctx: MediaComposeContext): void {
  // Per spec §11: never publish media of a real person without
  // explicit consent token. The talking-head + tutorial-lipsync
  // classes always require consent; other classes may carry consent
  // via the context payload.
  const needsConsent =
    recipe.class === 'avatar_talking_head' ||
    recipe.class === 'tutorial_lipsync_video';
  if (!needsConsent) return;
  if (!ctx.consent_token) {
    throw new MediaCompositionError(
      'CONSENT_MISSING',
      `recipe ${recipe.id} requires a consent_token`,
      [recipe.id, recipe.class],
    );
  }
  if (
    ctx.consent_token.scope !== 'all' &&
    ctx.consent_token.scope !== recipe.class
  ) {
    throw new MediaCompositionError(
      'CONSENT_MISSING',
      `consent_token scope mismatch — got ${ctx.consent_token.scope}, need ${recipe.class}`,
      [ctx.consent_token.scope, recipe.class],
    );
  }
}

interface SafetyArgs {
  readonly artifact: MediaArtifact;
  readonly brand: BrandSpec;
  readonly expect_wordmark: boolean;
  readonly recipe_id: string;
}

async function runSafetyPipeline(args: SafetyArgs): Promise<SafetyScanResult> {
  const nsfw = await scanForNsfw({
    artifact_bytes: args.artifact.body,
    format: args.artifact.format,
  });
  const deepfake = await detectDeepfake({
    artifact_url: args.artifact.storage_key,
    format: args.artifact.format,
  });
  const brand = await scanBrandViolation({
    artifact_bytes: args.artifact.body,
    format: args.artifact.format,
    brand: args.brand,
    recipe_id: args.recipe_id,
    expect_wordmark: args.expect_wordmark,
  });
  // Worst-case merge: if the provider adapter already reported a
  // higher NSFW / deepfake probability than the dedicated scanners
  // (e.g. Firefly's commercial-safe content filter), trust the
  // adapter's value. The content-rating gate sees the worst of all
  // sources. Brand violation flags are unioned across sources.
  const adapter = args.artifact.provenance.safety_scan;
  const flag_union = Array.from(
    new Set([...brand.flags, ...adapter.brand_violation_flags]),
  );
  return Object.freeze({
    nsfw_probability: Math.max(nsfw.probability, adapter.nsfw_probability),
    deepfake_probability: Math.max(
      deepfake.probability,
      adapter.deepfake_probability,
    ),
    brand_violation_flags: Object.freeze(flag_union),
  });
}

/**
 * Convenience: pull a typed value out of `ctx.available_data` by key.
 */
export function readData<T = unknown>(
  ctx: MediaComposeContext,
  key: string,
): T | undefined {
  const found = ctx.available_data.find((d) => d.key === key);
  if (found === undefined) return undefined;
  return found.value as T;
}
