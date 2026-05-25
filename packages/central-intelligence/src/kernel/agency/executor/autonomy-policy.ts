/**
 * Agency — autonomy-policy port.
 *
 * Decides whether the brain may invoke a given tool autonomously, or
 * whether the action must route through the four-eye approval gate.
 *
 * The kernel does NOT bake the decision in — the production adapter
 * reads per-tenant autonomy policies (migration 0080) and can be
 * configured per-stake-level / per-tool. Tests pass a hand-rolled port.
 */
import type { ActionToolStakes } from '../action-tools/types.js';

export interface AutonomyPolicyDecideArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly toolName: string;
  readonly stakes: ActionToolStakes;
}

export interface AutonomyPolicyDecision {
  readonly authorized: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

export interface AutonomyPolicyPort {
  decide(args: AutonomyPolicyDecideArgs): Promise<AutonomyPolicyDecision>;
}

/**
 * Default-allow-low-stakes policy. Used by tests + dev composition
 * roots when no real policy adapter is wired. Production uses the
 * Drizzle-backed adapter in @borjie/database (autonomy.schema —
 * migration 0080).
 */
export function createDefaultAllowLowStakesPolicy(): AutonomyPolicyPort {
  return {
    async decide({ stakes }) {
      if (stakes === 'low') {
        return {
          authorized: true,
          requiresApproval: false,
          reason: 'low-stakes default-allow',
        };
      }
      return {
        authorized: true,
        requiresApproval: true,
        reason: `${stakes}-stakes requires four-eye approval`,
      };
    },
  };
}
