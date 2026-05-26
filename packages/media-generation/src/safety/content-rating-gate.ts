/**
 * Per-tenant content rating gate.
 *
 * Caveat 3 (Wave 18X) — every tenant declares a maximum acceptable
 * content rating (SFW / PG / PG-13 / R) and an offensive-content
 * tolerance threshold. Generated artefacts whose safety scan exceeds
 * the tenant's ceiling are refused at the composer boundary —
 * regardless of recipe authority tier. The default tenant policy is
 * strict SFW (matches Borjie's MD persona); tenants that need
 * relaxed ratings (e.g. an investor-update channel that allows
 * controlled showing of dynamite or industrial blasts) ship an
 * override via `registerTenantRatingPolicy`.
 *
 * Pure logic — the gate is wired into `runRecipe` after the NSFW +
 * deepfake + brand-violation scans have run.
 *
 * @module @borjie/media-generation/safety/content-rating-gate
 */

import type { SafetyScanResult } from '../types.js';

export type ContentRating = 'SFW' | 'PG' | 'PG-13' | 'R';

export interface TenantRatingPolicy {
  /** Highest acceptable rating. Default: SFW. */
  readonly max_rating: ContentRating;
  /** NSFW probability ceiling, [0, 1]. Default: 0.2. */
  readonly nsfw_ceiling: number;
  /** Deepfake probability ceiling, [0, 1]. Default: 0.5. */
  readonly deepfake_ceiling: number;
  /**
   * Brand-violation flag list — flags in this set trigger a refusal.
   * Default: empty (every flag is acceptable; only the NSFW + deepfake
   * ceilings gate publication).
   */
  readonly disallowed_brand_violation_flags: ReadonlyArray<string>;
}

const EMPTY_FLAGS: ReadonlyArray<string> = Object.freeze([] as string[]);

export const DEFAULT_TENANT_RATING_POLICY: TenantRatingPolicy = Object.freeze({
  max_rating: 'SFW' as ContentRating,
  nsfw_ceiling: 0.2,
  deepfake_ceiling: 0.5,
  disallowed_brand_violation_flags: EMPTY_FLAGS,
});

/**
 * Per-rating NSFW ceiling — when a tenant declares only a max_rating
 * (no explicit nsfw_ceiling), the gate uses this table to derive the
 * ceiling. Strict SFW means 0.2; PG allows 0.3; PG-13 allows 0.5; R
 * allows 0.8 (still below explicit-content territory).
 */
export const RATING_NSFW_CEILING: Readonly<Record<ContentRating, number>> =
  Object.freeze({
    SFW: 0.2,
    PG: 0.3,
    'PG-13': 0.5,
    R: 0.8,
  });

interface TenantRatingPolicyRegistry {
  readonly get: (tenantId: string) => TenantRatingPolicy;
  readonly register: (
    tenantId: string,
    policy: Partial<TenantRatingPolicy>,
  ) => TenantRatingPolicyRegistry;
  readonly list: () => ReadonlyArray<{
    readonly tenant_id: string;
    readonly policy: TenantRatingPolicy;
  }>;
}

function buildRegistry(
  entries: ReadonlyMap<string, TenantRatingPolicy>,
  fallback: TenantRatingPolicy,
): TenantRatingPolicyRegistry {
  return {
    get(tenantId: string): TenantRatingPolicy {
      return entries.get(tenantId) ?? fallback;
    },
    register(
      tenantId: string,
      policy: Partial<TenantRatingPolicy>,
    ): TenantRatingPolicyRegistry {
      const merged: TenantRatingPolicy = mergeRatingPolicy(fallback, policy);
      const next = new Map(entries);
      next.set(tenantId, merged);
      return buildRegistry(next, fallback);
    },
    list() {
      return Array.from(entries.entries()).map(([tenant_id, policy]) => ({
        tenant_id,
        policy,
      }));
    },
  };
}

/**
 * Merge a partial policy into a base — partials inherit the base's
 * ceilings unless explicit overrides are supplied. The NSFW ceiling
 * is back-derived from `max_rating` if not specified.
 */
export function mergeRatingPolicy(
  base: TenantRatingPolicy,
  override: Partial<TenantRatingPolicy>,
): TenantRatingPolicy {
  const max_rating = override.max_rating ?? base.max_rating;
  const nsfw_ceiling =
    override.nsfw_ceiling ??
    (override.max_rating !== undefined
      ? RATING_NSFW_CEILING[max_rating]
      : base.nsfw_ceiling);
  return Object.freeze({
    max_rating,
    nsfw_ceiling,
    deepfake_ceiling: override.deepfake_ceiling ?? base.deepfake_ceiling,
    disallowed_brand_violation_flags: Object.freeze([
      ...(override.disallowed_brand_violation_flags ??
        base.disallowed_brand_violation_flags),
    ]),
  });
}

export function createTenantRatingPolicyRegistry(
  fallback: TenantRatingPolicy = DEFAULT_TENANT_RATING_POLICY,
): TenantRatingPolicyRegistry {
  return buildRegistry(new Map(), fallback);
}

let activePolicyRegistry: TenantRatingPolicyRegistry =
  createTenantRatingPolicyRegistry();

export function registerTenantRatingPolicy(
  tenantId: string,
  policy: Partial<TenantRatingPolicy>,
): TenantRatingPolicyRegistry {
  if (tenantId.trim().length === 0) {
    throw new Error('registerTenantRatingPolicy: tenantId must be non-empty');
  }
  activePolicyRegistry = activePolicyRegistry.register(tenantId, policy);
  return activePolicyRegistry;
}

export function getTenantRatingPolicy(tenantId: string): TenantRatingPolicy {
  return activePolicyRegistry.get(tenantId);
}

export function snapshotTenantRatingPolicyRegistry(): TenantRatingPolicyRegistry {
  return activePolicyRegistry;
}

export function setActiveTenantRatingPolicyRegistry(
  registry: TenantRatingPolicyRegistry,
): void {
  activePolicyRegistry = registry;
}

export type { TenantRatingPolicyRegistry };

// ---------------------------------------------------------------------------
// Gate evaluation
// ===========================================================================

export interface RatingGateResult {
  readonly ok: boolean;
  readonly violations: ReadonlyArray<string>;
  readonly policy: TenantRatingPolicy;
}

export interface RatingGateInput {
  readonly tenant_id: string;
  readonly safety_scan: SafetyScanResult;
  /** Caller-supplied override — production wires per-recipe overrides
   *  through here; tests inject explicit policies. */
  readonly policy_override?: TenantRatingPolicy;
}

/**
 * Apply the tenant's content rating gate to a finished safety scan.
 * Returns ok=false + a violation list when any ceiling is exceeded.
 * The composer caller raises `MediaCompositionError('SAFETY_REFUSED')`
 * on ok=false.
 */
export function applyContentRatingGate(
  input: RatingGateInput,
): RatingGateResult {
  const policy = input.policy_override ?? getTenantRatingPolicy(input.tenant_id);
  const violations: string[] = [];

  if (input.safety_scan.nsfw_probability > policy.nsfw_ceiling) {
    violations.push(
      `nsfw_above_ceiling:${input.safety_scan.nsfw_probability.toFixed(3)}>${policy.nsfw_ceiling.toFixed(3)}`,
    );
  }
  if (input.safety_scan.deepfake_probability > policy.deepfake_ceiling) {
    violations.push(
      `deepfake_above_ceiling:${input.safety_scan.deepfake_probability.toFixed(3)}>${policy.deepfake_ceiling.toFixed(3)}`,
    );
  }
  const disallowed = new Set(policy.disallowed_brand_violation_flags);
  for (const flag of input.safety_scan.brand_violation_flags) {
    if (disallowed.has(flag)) {
      violations.push(`disallowed_brand_flag:${flag}`);
    }
  }

  return {
    ok: violations.length === 0,
    violations: Object.freeze([...violations]),
    policy,
  };
}
