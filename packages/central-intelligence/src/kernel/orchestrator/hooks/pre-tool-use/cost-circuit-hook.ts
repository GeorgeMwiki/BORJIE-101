/**
 * PreToolUse: cost-circuit hook — denies a tool call when the per-tenant
 * USD spend in the rolling window would breach the configured ceiling.
 *
 * Mirrors the existing `cost-circuit-breaker.ts` semantics in
 * `@borjie/ai-copilot/security` but lives at the orchestrator layer
 * so the hook can short-circuit BEFORE the tool runs (the existing
 * breaker is post-hoc accounting). The breaker port is injectable so
 * this package stays dep-free.
 */

import type { Decision } from '../../decision.js';
import type { HookContext, HookResult, PreToolUseHook } from '../../hook-chain.js';
import type { RiskTier } from '../../../risk-tier.js';

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface CostCircuitPort {
  /** Returns the projected spend including this call's estimate. */
  project(args: {
    readonly tenantId: string;
    readonly estimatedCostUsd: number;
  }): Promise<{ readonly projectedUsd: number; readonly ceilingUsd: number }>;
}

export interface CostCircuitHookDeps {
  readonly breaker: CostCircuitPort;
  /**
   * H2 — risk-tier resolver. Used to decide whether a tool with no
   * `estimatedCostUsd` should be denied (mutate / destroy / external-
   * comm / billing) or allowed through (read). When omitted, the hook
   * conservatively assumes `mutate` for any tool that lacks an
   * estimate, which is the safe default.
   */
  readonly toolRiskTier?: (toolName: string) => RiskTier;
  /**
   * H2 — sentinel cost used for unknown tools that supply no
   * `estimatedCostUsd` AND whose risk tier is not `read`. Set to a
   * conservative ceiling so the circuit denies them by default.
   * Default $1.00.
   */
  readonly unknownToolCostSentinelUsd?: number;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_UNKNOWN_TOOL_SENTINEL_USD = 1.0;

export function createCostCircuitHook(
  deps: CostCircuitHookDeps,
): PreToolUseHook {
  const resolveRiskTier = deps.toolRiskTier ?? ((): RiskTier => 'mutate');
  const sentinel =
    deps.unknownToolCostSentinelUsd ?? DEFAULT_UNKNOWN_TOOL_SENTINEL_USD;
  return {
    name: 'cost-circuit',
    stage: 'pre-tool-use',
    async fn(ctx: HookContext, decision: Decision): Promise<HookResult> {
      if (decision.kind !== 'tool_call') return { kind: 'allow' };
      const tenantId =
        ctx.scope.kind === 'platform' ? '_platform' : ctx.scope.tenantId;
      const rawEstimate = decision.call.estimatedCostUsd;
      const riskTier = resolveRiskTier(decision.call.toolName);

      // H2 — Asymmetric-default fix. A tool with no explicit cost
      // estimate AND a non-read risk tier is treated as the sentinel
      // amount so it cannot silently slip past the ceiling. Read-tier
      // tools with no estimate stay at $0 (purely observational).
      const estimate =
        rawEstimate ?? (riskTier === 'read' ? 0 : sentinel);

      // H2 — Defence-in-depth: an explicit `$0` estimate on a non-read
      // tier is itself suspicious — either the caller forgot to fill
      // it in, or the tool genuinely costs nothing and should be
      // tagged `read`. We deny rather than silently allow.
      if (rawEstimate === 0 && riskTier !== 'read') {
        return {
          kind: 'deny',
          code: 'cost-estimate-missing',
          reason: `tool '${decision.call.toolName}' has riskTier=${riskTier} but estimatedCostUsd=0; require explicit cost estimate or downgrade tier`,
        };
      }

      const projection = await deps.breaker.project({
        tenantId,
        estimatedCostUsd: estimate,
      });
      if (projection.projectedUsd <= projection.ceilingUsd) {
        return { kind: 'allow' };
      }
      return {
        kind: 'deny',
        code: 'cost-ceiling-breach',
        reason: `tool '${decision.call.toolName}' would push spend to $${projection.projectedUsd.toFixed(2)} (ceiling $${projection.ceilingUsd.toFixed(2)})`,
      };
    },
  };
}
