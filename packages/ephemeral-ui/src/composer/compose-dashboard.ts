/**
 * `compose-dashboard.ts` — the central composer.
 *
 * Pure. Given a manifest, a function output, and the user context,
 * emits a `ComposeResult`. Validates output shape, recalls memory (no-op
 * here; passed through), composes an archetype payload, runs the brand-
 * lock pass, retries up to three times, returns a result.
 *
 * The package emits a *recipe hash* + an `EphemeralDashboard` record.
 * The full `TabRecipe` is assembled by the caller from this hash and
 * the archetype payload — keeping `@borjie/ephemeral-ui` decoupled
 * from the renderer-specific TabRecipe wiring so this package stays
 * unit-testable without spinning up a renderer.
 */
import { createHash } from 'node:crypto';
import type {
  EphemeralDashboard,
  FunctionUIManifest,
  UserContext,
} from '../types.js';
import { validateFunctionUIManifest } from '../manifests/manifest-validator.js';
import { renderArchetype } from './archetype-renderer.js';
import { brandLockPass } from './brand-lock-pass.js';

const MAX_BRAND_LOCK_RETRIES = 3;

/**
 * Compose result with attached payload — exposed for callers that
 * want both the hash and the archetype payload to thread through to
 * the dynamic-ui renderer. Since `ComposeResult` is a discriminated
 * union, we cannot `extends` it as an interface; we widen each branch
 * with an optional `payload` field.
 */
export type ComposeResultWithPayload =
  | {
      readonly ok: true;
      readonly recipe_hash: string;
      readonly dashboard: import('../types.js').EphemeralDashboard;
      readonly payload: ReturnType<typeof renderArchetype>;
    }
  | {
      readonly ok: false;
      readonly failure: import('../types.js').ComposeFailure;
    };

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable user-context hash. The composer's cache key contains this; any
 * change here must be cache-key-invalidating.
 */
export function hashUserContext(ctx: UserContext): string {
  const projection = {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    scope: ctx.scope,
    recent_turns_len: ctx.recent_turns.length,
    memory_recall_hashes: ctx.memory_recall.map((m) => m.recipe_hash ?? null),
    brand_tokens_version: ctx.brand_dna.tokens_version,
    mastery_tier: ctx.mastery_tier,
    locale: ctx.locale,
  };
  return sha256(JSON.stringify(projection));
}

/**
 * Deterministic recipe-shape fingerprint. Two structurally identical
 * payloads must share the same fingerprint regardless of cosmetic
 * variation in their cell contents.
 */
export function hashRecipeShape(input: {
  readonly function_id: string;
  readonly archetype: string;
  readonly section_kinds: ReadonlyArray<string>;
  readonly allowed_action_ids: ReadonlyArray<string>;
}): string {
  const projection = {
    f: input.function_id,
    a: input.archetype,
    s: [...input.section_kinds].sort(),
    x: [...input.allowed_action_ids].sort(),
  };
  return sha256(JSON.stringify(projection));
}

/**
 * The composer. Pure. Returns a discriminated outcome.
 *
 * `function_output` is checked against `manifest.output_shape`. On
 * mismatch returns a `manifest_schema_mismatch` failure.
 *
 * Brand-lock pass runs after archetype rendering; rejected pass causes
 * a retry. After `MAX_BRAND_LOCK_RETRIES` the composer returns a
 * `brand_lock_exhausted` failure.
 *
 * The function does not write any cache entry or telemetry row — those
 * concerns live in `lifecycle/cache-policy.ts` and
 * `storage/telemetry-repository.ts`. Composition is the pure core.
 */
export function composeDashboardForFunction(input: {
  readonly manifest: FunctionUIManifest;
  readonly function_output: unknown;
  readonly user_context: UserContext;
}): ComposeResultWithPayload {
  const { manifest, function_output, user_context } = input;

  // Defensive: re-validate the manifest. Throws via assertion if wholly
  // malformed; lets the registry catch most invariants.
  const validation = validateFunctionUIManifest(manifest);
  if (!validation.ok) {
    return {
      ok: false,
      failure: {
        kind: 'manifest_schema_mismatch',
        issues: validation.issues,
      },
    };
  }

  // Validate the function output against the manifest's Zod schema.
  const outputCheck = manifest.output_shape.safeParse(function_output);
  if (!outputCheck.success) {
    return {
      ok: false,
      failure: {
        kind: 'manifest_schema_mismatch',
        issues: outputCheck.error.issues.map(
          (issue) => `${issue.path.join('.')}: ${issue.message}`,
        ),
      },
    };
  }

  // Compose with retries on brand-lock.
  let composeFallback = false;
  let lastOffenders: ReadonlyArray<string> = [];

  for (let attempt = 0; attempt < MAX_BRAND_LOCK_RETRIES; attempt++) {
    const payload = renderArchetype(
      manifest.dashboard_archetype,
      outputCheck.data,
      manifest.ui_hints,
    );

    const stylingStrings = payload.sections.flatMap((s) => {
      const colors = s.payload['colors'];
      return Array.isArray(colors) ? (colors as string[]) : [];
    });

    const bl = brandLockPass({
      hints: manifest.ui_hints,
      stylingStrings,
    });
    if (bl.ok) {
      const recipeHash = hashRecipeShape({
        function_id: manifest.function_id,
        archetype: manifest.dashboard_archetype,
        section_kinds: payload.sections.map((s) => s.kind),
        allowed_action_ids: (manifest.allowed_actions ?? []).map(
          (a) => a.action_id,
        ),
      });

      const dashboard: EphemeralDashboard = {
        recipe_hash: recipeHash,
        archetype: manifest.dashboard_archetype,
        composed_at: Date.now(),
        cache_ttl_seconds: manifest.cache_ttl_seconds,
        was_cache_hit: false,
        brand_lock_retries: attempt,
        compose_fallback: composeFallback,
      };

      void user_context; // currently unused beyond hashing; reserved for Phase 2 recall.
      return {
        ok: true,
        recipe_hash: recipeHash,
        dashboard,
        payload,
      };
    }

    lastOffenders = bl.offenders;
    composeFallback = true; // future retry should use the stricter constraint
  }

  return {
    ok: false,
    failure: {
      kind: 'brand_lock_exhausted',
      offenders: lastOffenders,
    },
  };
}
