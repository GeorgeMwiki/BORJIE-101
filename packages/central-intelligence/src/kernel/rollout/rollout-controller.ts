/**
 * Rollout controller — picks the prompt version for a (tenant, capability)
 * tuple based on the current registry state + canary fractions.
 *
 * Central Command Phase D (D5 — Rollout safety). Sits BETWEEN the kernel's
 * sensor-call composition and the prompt registry. Sierra Agent Studio
 * 2.0 ships this as `agent rollout pick`; we wire the same shape so the
 * admin "promote / rollback" API call is one HTTP call away from
 * production traffic.
 *
 * The controller is pure given the registry + canary fractions. The
 * registry is queried via the duck-typed port shape; production wires
 * the Drizzle adapter, tests pass an in-memory fake.
 *
 * IMPORTANT: the controller NEVER throws. A degraded registry → null
 * decision → the kernel falls back to its hard-coded preamble (same
 * shape every prior release shipped). That is the whole point of the
 * Sierra "instant rollback" pattern: every fail mode collapses to the
 * known-good code path.
 */

import { pickVariant, type CanaryRoute } from './canary-router.js';
import { logger } from '../../logger.js';

export type RolloutStatus =
  | 'shadow'
  | 'canary'
  | 'canary-25'
  | 'active'
  | 'degraded'
  | 'archived';

export interface RolloutPromptRow {
  readonly capability: string;
  readonly version: string;
  readonly promptText: string;
  readonly status: RolloutStatus;
}

/**
 * Port shape the controller calls into. The production adapter wraps
 * `kernel-prompt-registry.service.ts`; tests pass an in-memory fake.
 * Duck-typed so this module does not compile-time-depend on
 * @borjie/database.
 */
export interface RolloutRegistryPort {
  findActive(capability: string): Promise<RolloutPromptRow | null>;
  findCanaries(capability: string): Promise<ReadonlyArray<RolloutPromptRow>>;
}

export interface CanaryFractions {
  readonly canary: number; // default 5
  readonly canary25: number; // default 25
}

export const DEFAULT_CANARY_FRACTIONS: CanaryFractions = Object.freeze({
  canary: 5,
  canary25: 25,
});

export interface PickPromptArgs {
  readonly tenantId: string | null;
  readonly capability: string;
}

export interface PickPromptDecision {
  readonly version: string;
  readonly promptText: string;
  readonly variant: 'active' | 'canary' | 'canary-25' | 'fallback';
  readonly bucket: number;
  readonly source: 'registry' | 'fallback';
}

export interface RolloutControllerDeps {
  readonly registry: RolloutRegistryPort;
  readonly fractions?: CanaryFractions;
  /**
   * Optional capability allow-list. When supplied, the controller
   * short-circuits and returns null for any capability NOT in the
   * list — useful for staged production-readiness gating.
   */
  readonly capabilitiesEnabled?: ReadonlySet<string>;
}

export interface RolloutController {
  /**
   * Pick the prompt the kernel should use for the next request. Returns
   * null when the registry has no rows OR the capability is gated off.
   * The kernel must fall back to its hard-coded preamble in that case.
   */
  pickPrompt(args: PickPromptArgs): Promise<PickPromptDecision | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createRolloutController(
  deps: RolloutControllerDeps,
): RolloutController {
  const fractions = deps.fractions ?? DEFAULT_CANARY_FRACTIONS;
  const allowList = deps.capabilitiesEnabled;

  return {
    async pickPrompt(args) {
      if (!args.capability) return null;
      if (allowList && !allowList.has(args.capability)) return null;
      const tenantKey = args.tenantId ?? '__no-tenant__';

      let active: RolloutPromptRow | null = null;
      let canaries: ReadonlyArray<RolloutPromptRow> = [];
      try {
        active = await deps.registry.findActive(args.capability);
        canaries = await deps.registry.findCanaries(args.capability);
      } catch (error) {
        // Registry read failed — kernel falls back to its hard-coded
        // preamble. This is the failure mode that defines the entire
        // rollout-safety pattern: degraded substrate must NOT take
        // production traffic to a poorly-tested prompt.
        logger.error('rollout-controller: registry read failed', { error: error });
        return null;
      }

      if (!active && canaries.length === 0) return null;

      // Compute the canary route. The fallback is the active row; if
      // there is no active row we fall back to the first canary so a
      // brand-new capability can still route somewhere stable.
      const canary25 = canaries.find((c) => c.status === 'canary-25');
      const canary5 = canaries.find((c) => c.status === 'canary');

      const variants: Array<{ version: string; weight: number }> = [];
      if (active) {
        const total =
          (canary25 ? fractions.canary25 : 0) +
          (canary5 ? fractions.canary : 0);
        const activeWeight = Math.max(0, 100 - total);
        variants.push({ version: active.version, weight: activeWeight });
      }
      if (canary25) {
        variants.push({ version: canary25.version, weight: fractions.canary25 });
      }
      if (canary5) {
        variants.push({ version: canary5.version, weight: fractions.canary });
      }

      const fallbackVersion =
        active?.version ?? canaries[0]?.version ?? 'unknown';

      const route: CanaryRoute = {
        variants,
        fallbackVersion,
      };

      const decision = pickVariant(tenantKey, args.capability, route);

      // Resolve the prompt text for the chosen version.
      const rowByVersion = new Map<string, RolloutPromptRow>();
      if (active) rowByVersion.set(active.version, active);
      for (const c of canaries) rowByVersion.set(c.version, c);
      const row = rowByVersion.get(decision.version);
      if (!row) {
        return null;
      }

      return {
        version: row.version,
        promptText: row.promptText,
        variant: decision.variant,
        bucket: decision.bucket,
        source: 'registry',
      };
    },
  };
}
