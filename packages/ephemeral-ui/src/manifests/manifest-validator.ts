/**
 * `manifest-validator.ts` — Zod schema for `FunctionUIManifest`.
 *
 * Pure. Returns a discriminated outcome. Used at registry-time
 * (`registerFunctionUIManifest` calls in domain packages) and at
 * compose-time (`composeDashboardForFunction` re-validates defensively).
 */
import { z } from 'zod';
import type { FunctionUIManifest } from '../types.js';
import { DASHBOARD_ARCHETYPES } from '../types.js';

const archetypeSchema = z.enum(
  DASHBOARD_ARCHETYPES as readonly [string, ...string[]],
);

const tierSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

const labelSchema = z.object({
  en: z.string().min(1),
  sw: z.string().min(1),
});

const actionDescriptorSchema = z.object({
  action_id: z.string().min(1),
  authority_tier: tierSchema,
  label: labelSchema,
});

const uiHintsSchema = z.object({
  preferred_size: z.enum(['inline', 'tab', 'fullscreen', 'modal']),
  preferred_colors: z.array(z.string()).readonly(),
  preferred_layout: z.enum(['cards', 'table', 'split', 'tabs']),
  emphasis: z.enum(['data_density', 'narrative', 'actionable']),
  mobile_strategy: z.enum(['reflow', 'stack', 'simplify', 'hide_secondary']),
});

const contextRequirementSchema = z.object({
  kind: z.enum([
    'scope',
    'recent_turns',
    'memory_recall',
    'brand_dna',
    'mastery_tier',
    'locale',
  ]),
  required: z.boolean(),
});

/**
 * Structural schema. `output_shape` is `unknown` here because we cannot
 * reflect on an opaque Zod schema; the runtime check verifies its
 * presence + `.safeParse` shape separately.
 */
const manifestStructuralSchema = z.object({
  function_id: z.string().min(1),
  version: z.number().int().nonnegative(),
  dashboard_archetype: archetypeSchema,
  required_context: z.array(contextRequirementSchema).readonly(),
  ui_hints: uiHintsSchema,
  authority_tier: tierSchema,
  ephemeral_by_default: z.boolean(),
  cache_ttl_seconds: z.number().int().nonnegative(),
  allowed_actions: z.array(actionDescriptorSchema).readonly().optional(),
});

export type ManifestValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: ReadonlyArray<string> };

/**
 * Validates a manifest's structural shape and the presence of a valid
 * Zod output_shape (with a working `.safeParse`).
 */
export function validateFunctionUIManifest(
  candidate: unknown,
): ManifestValidationResult {
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, issues: ['manifest must be an object'] };
  }

  const result = manifestStructuralSchema.safeParse(candidate);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }

  const maybeOutputShape = (candidate as { output_shape?: unknown }).output_shape;
  if (
    !maybeOutputShape ||
    typeof maybeOutputShape !== 'object' ||
    typeof (maybeOutputShape as { safeParse?: unknown }).safeParse !== 'function'
  ) {
    return {
      ok: false,
      issues: ['output_shape must be a Zod schema with a safeParse method'],
    };
  }

  return { ok: true };
}

/**
 * Convenience guard — throws on invalid. Composers that don't want a
 * discriminated outcome can use this.
 */
export function assertValidManifest(
  candidate: unknown,
): asserts candidate is FunctionUIManifest {
  const r = validateFunctionUIManifest(candidate);
  if (!r.ok) {
    throw new Error(
      `Invalid FunctionUIManifest: ${r.issues.join('; ')}`,
    );
  }
}
