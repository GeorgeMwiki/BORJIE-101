/**
 * Tier Router — standard / pro / enterprise gating.
 *
 * BORJIE SaaS subscriptions map 1:1 to MCP tiers:
 *   standard   — property basics (graph read, case list, letter read)
 *   pro        — writes, ai-cost insights, warehouse, taxonomy, IoT
 *   enterprise — everything, including skill-execution and compliance-plugin
 *                enumeration.
 *
 * Every tool declares a `minimumTier`. The router decides whether a given
 * caller may invoke it, and enforces per-call / per-month spend caps.
 */

import type { McpTier, TierDefinition, McpToolDefinition } from './types.js';

// ============================================================================
// Default tier config
// ============================================================================

export const DEFAULT_TIER_DEFINITIONS: ReadonlyArray<TierDefinition> =
  Object.freeze([
    Object.freeze({
      tier: 'standard' as const,
      displayName: 'Standard',
      description:
        'Read-only access to the property graph, cases, letters, arrears, and occupancy timelines.',
      allowedTools: Object.freeze([
        'query_property_graph',
        'get_tenant_risk_profile',
        'list_maintenance_cases',
        'generate_letter',
        'query_arrears_projection',
        'list_occupancy_timeline',
        'get_maintenance_taxonomy',
      ]),
      maxCostPerCallUsdMicro: 50_000, // $0.05
      monthlyBudgetUsdMicro: 10_000_000, // $10
    }),
    Object.freeze({
      tier: 'pro' as const,
      displayName: 'Pro',
      description:
        'Standard plus writes (create_maintenance_case), warehouse inventory, and AI-cost ledger queries.',
      allowedTools: Object.freeze([
        'query_property_graph',
        'get_tenant_risk_profile',
        'list_maintenance_cases',
        'create_maintenance_case',
        'generate_letter',
        'query_arrears_projection',
        'list_occupancy_timeline',
        'query_ai_cost_summary',
        'get_maintenance_taxonomy',
        'get_warehouse_inventory',
      ]),
      maxCostPerCallUsdMicro: 500_000, // $0.50
      monthlyBudgetUsdMicro: 100_000_000, // $100
    }),
    Object.freeze({
      tier: 'enterprise' as const,
      displayName: 'Enterprise',
      description:
        'Pro plus compliance-plugin enumeration and universal `run_skill` dispatch across every BORJIE copilot.',
      allowedTools: '*' as const,
      maxCostPerCallUsdMicro: 5_000_000, // $5
      monthlyBudgetUsdMicro: 2_000_000_000, // $2 000
    }),
  ]);

// ============================================================================
// Router
// ============================================================================

const TIER_PRIORITY: Readonly<Record<McpTier, number>> = Object.freeze({
  standard: 0,
  pro: 1,
  enterprise: 2,
});

export interface TierDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly errorCode?: string;
}

export interface TierRouter {
  canInvoke(
    tool: McpToolDefinition,
    callerTier: McpTier,
  ): TierDecision;
  canAfford(
    estimatedCostUsdMicro: number,
    callerTier: McpTier,
    monthlySpentUsdMicro: number,
  ): TierDecision;
  getDefinition(tier: McpTier): TierDefinition;
  listTiers(): ReadonlyArray<TierDefinition>;
}

export interface TierRouterConfig {
  readonly definitions?: ReadonlyArray<TierDefinition>;
}

export function createTierRouter(config: TierRouterConfig = {}): TierRouter {
  const defs = config.definitions ?? DEFAULT_TIER_DEFINITIONS;
  const byTier = new Map<McpTier, TierDefinition>();
  for (const d of defs) byTier.set(d.tier, d);

  return {
    canInvoke(tool, callerTier) {
      const callerDef = byTier.get(callerTier);
      if (!callerDef) {
        return {
          allowed: false,
          reason: `Unknown tier: ${callerTier}`,
          errorCode: 'TIER_UNKNOWN',
        };
      }

      // Minimum-tier gate
      if (TIER_PRIORITY[callerTier] < TIER_PRIORITY[tool.minimumTier]) {
        return {
          allowed: false,
          reason: `Tool ${tool.name} requires ${tool.minimumTier} tier or higher. Caller is on ${callerTier}.`,
          errorCode: 'TIER_INSUFFICIENT',
        };
      }

      // Tool-list gate (if tier enumerates its tools)
      if (
        callerDef.allowedTools !== '*' &&
        !callerDef.allowedTools.includes(tool.name)
      ) {
        return {
          allowed: false,
          reason: `Tool ${tool.name} is not available on tier ${callerTier}.`,
          errorCode: 'TIER_TOOL_NOT_ALLOWED',
        };
      }

      return { allowed: true };
    },

    canAfford(estimatedCostUsdMicro, callerTier, monthlySpentUsdMicro) {
      const def = byTier.get(callerTier);
      if (!def) {
        return {
          allowed: false,
          reason: `Unknown tier: ${callerTier}`,
          errorCode: 'TIER_UNKNOWN',
        };
      }
      if (estimatedCostUsdMicro > def.maxCostPerCallUsdMicro) {
        return {
          allowed: false,
          reason: `Call cost ${estimatedCostUsdMicro} exceeds per-call cap ${def.maxCostPerCallUsdMicro} for tier ${callerTier}.`,
          errorCode: 'TIER_PER_CALL_CAP_EXCEEDED',
        };
      }
      if (
        def.monthlyBudgetUsdMicro !== undefined &&
        monthlySpentUsdMicro + estimatedCostUsdMicro >
          def.monthlyBudgetUsdMicro
      ) {
        return {
          allowed: false,
          reason: `Monthly budget ${def.monthlyBudgetUsdMicro} would be exceeded for tier ${callerTier}.`,
          errorCode: 'TIER_MONTHLY_BUDGET_EXCEEDED',
        };
      }
      return { allowed: true };
    },

    getDefinition(tier) {
      const d = byTier.get(tier);
      if (!d) throw new Error(`Unknown tier: ${tier}`);
      return d;
    },

    listTiers() {
      return defs;
    },
  };
}
